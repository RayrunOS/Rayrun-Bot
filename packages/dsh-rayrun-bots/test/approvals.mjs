/**
 * Approval request/decision protocol checks.
 *
 *   node test/approvals.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DEFAULT_BACKGROUND_TTL_MS, actionHashFor, openApprovalStore,
} from '../lib/approvals.js'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'

const errors = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-approvals-'))
  roots.push(root)
  const bots = openBotStore(root)
  const bot = bots.create({ name: 'Weekly Watch', label: 'Watches the numbers' })
  return { root, bots, bot, approvals: openApprovalStore(root) }
}

function requestFor(bot, overrides = {}) {
  return {
    botId: bot.id,
    actionId: 'act-1',
    action: { kind: 'send-message', target: '#weekly', text: 'hello' },
    risk: ['outside', 'irreversible'],
    origin: 'chat',
    ...overrides,
  }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

function readJson(filename) {
  return JSON.parse(readFileSync(filename, 'utf8'))
}

check('createRequest persists a bound request and audits without the action', () => {
  const { root, bot, approvals } = setup()
  const created = approvals.createRequest(requestFor(bot), { now: '2026-11-22T10:00:00.000Z' })
  assert.equal(created.state, 'pending')
  assert.equal(created.expiresAt, null)
  assert.equal(Object.hasOwn(created, 'nonce'), false)
  assert.equal(Object.hasOwn(created, 'actionHash'), false)

  const raw = readJson(path.join(root, 'bots', bot.id, 'approvals', `req-${created.id}.json`))
  assert.equal(raw.schema, 1)
  assert.equal(raw.botId, bot.id)
  assert.match(raw.nonce, /^[A-Za-z0-9_-]{32,128}$/)
  assert.match(raw.actionHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(raw.risk, ['outside', 'irreversible'])

  const audit = readFileSync(path.join(root, 'logs', 'audit.log'), 'utf8')
  assert.match(audit, /"event":"request"/)
  assert.match(audit, new RegExp(created.id))
  assert.doesNotMatch(audit, /send-message|#weekly|hello/)
})

check('canonical action hashes ignore key order and whitespace', () => {
  const args = {
    botId: 'weekly-watch',
    actionId: 'act-1',
    risk: ['outside'],
    origin: 'chat',
    expiresAt: null,
  }
  const first = actionHashFor({ ...args, action: { b: 2, a: 1, nested: { z: true, y: 'x' } } })
  const second = actionHashFor({ ...args, action: { nested: { y: 'x', z: true }, a: 1, b: 2 } })
  assert.equal(first, second)
  assert.notEqual(first, actionHashFor({ ...args, action: { a: 1, b: 3 } }))
  assert.match(first, /^[a-f0-9]{64}$/)

  const unicodeFirst = actionHashFor({ ...args, action: { é: '你好', a: 'x' } })
  const unicodeSecond = actionHashFor({ ...args, action: { a: 'x', é: '你好' } })
  assert.equal(unicodeFirst, unicodeSecond)
})

check('a decision binds the request, is idempotent and refuses a different decision', () => {
  const { root, bot, approvals } = setup()
  const created = approvals.createRequest(requestFor(bot), { now: '2026-11-22T10:00:00.000Z' })
  const rawRequest = readJson(path.join(root, 'bots', bot.id, 'approvals', `req-${created.id}.json`))

  const first = approvals.decide(bot.id, created.id, 'approve', { now: '2026-11-22T10:01:00.000Z' })
  assert.equal(first.approval.state, 'approved')
  assert.equal(first.idempotent, false)
  assert.equal(first.execution.available, false)
  assert.equal(first.execution.reason, 'platform_isolation_pending')

  const rawDecision = readJson(path.join(root, 'bots', bot.id, 'approvals', `res-${created.id}.json`))
  assert.equal(rawDecision.id, rawRequest.id)
  assert.equal(rawDecision.botId, rawRequest.botId)
  assert.equal(rawDecision.actionId, rawRequest.actionId)
  assert.equal(rawDecision.nonce, rawRequest.nonce)
  assert.equal(rawDecision.actionHash, rawRequest.actionHash)
  assert.equal(rawDecision.decision, 'approve')
  assert.match(rawDecision.decisionId, /^dec-/)

  const again = approvals.decide(bot.id, created.id, 'approve', { now: '2026-11-22T10:02:00.000Z' })
  assert.equal(again.idempotent, true)
  assert.equal(again.approval.decision.decisionId, first.approval.decision.decisionId)
  expectCode(() => approvals.decide(bot.id, created.id, 'deny'), ERROR_CODES.approvalReplay)

  const audit = readFileSync(path.join(root, 'logs', 'audit.log'), 'utf8')
  assert.match(audit, /"event":"decision"/)
  assert.match(audit, new RegExp(ERROR_CODES.approvalReplay))
  assert.doesNotMatch(audit, /send-message|#weekly/)
})

check('background requests expire at the TTL and chat requests wait', () => {
  const { bot, approvals } = setup()
  const start = Date.parse('2026-11-22T10:00:00.000Z')
  const background = approvals.createRequest(requestFor(bot, { origin: 'background' }), { now: start })
  assert.equal(Date.parse(background.expiresAt) - start, DEFAULT_BACKGROUND_TTL_MS)
  expectCode(
    () => approvals.decide(bot.id, background.id, 'approve', { now: start + DEFAULT_BACKGROUND_TTL_MS + 1 }),
    ERROR_CODES.approvalExpired,
  )

  const chat = approvals.createRequest(requestFor(bot), { now: start })
  const waited = approvals.decide(bot.id, chat.id, 'approve', { now: start + 24 * 60 * 60 * 1000 })
  assert.equal(waited.approval.state, 'approved')

  expectCode(
    () => approvals.createRequest(requestFor(bot, { origin: 'background', expiresAt: new Date(start + DEFAULT_BACKGROUND_TTL_MS + 1).toISOString() })),
    ERROR_CODES.approvalInvalid,
  )
  expectCode(
    () => approvals.createRequest(requestFor(bot, { expiresAt: new Date(start + 60_000).toISOString() })),
    ERROR_CODES.approvalInvalid,
  )
})

check('a tampered request or mismatched decision is refused', () => {
  const { root, bot, approvals } = setup()
  const created = approvals.createRequest(requestFor(bot), { now: '2026-11-22T10:00:00.000Z' })
  const requestFile = path.join(root, 'bots', bot.id, 'approvals', `req-${created.id}.json`)
  const raw = readJson(requestFile)
  raw.action.text = 'tampered'
  writeFileSync(requestFile, JSON.stringify(raw))
  expectCode(() => approvals.get(bot.id, created.id), ERROR_CODES.approvalInvalid)
  expectCode(() => approvals.decide(bot.id, created.id, 'approve'), ERROR_CODES.approvalInvalid)
  assert.equal(existsSync(path.join(root, 'bots', bot.id, 'approvals', `res-${created.id}.json`)), false)

  const second = setup()
  const request = second.approvals.createRequest(requestFor(second.bot), { now: '2026-11-22T10:00:00.000Z' })
  const badDecision = {
    schema: 1,
    id: request.id,
    botId: second.bot.id,
    actionId: 'act-1',
    actionHash: '0'.repeat(64),
    nonce: 'n'.repeat(64),
    decision: 'approve',
    decidedAt: '2026-11-22T10:01:00.000Z',
    decisionId: 'dec-bad',
  }
  writeFileSync(
    path.join(second.root, 'bots', second.bot.id, 'approvals', `res-${request.id}.json`),
    JSON.stringify(badDecision),
  )
  expectCode(() => second.approvals.get(second.bot.id, request.id), ERROR_CODES.approvalInvalid)
})

check('corrupt, oversized and mismatched files fail closed', () => {
  const { root, bot, approvals } = setup()
  const dir = path.join(root, 'bots', bot.id, 'approvals')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'req-bad.json'), '{not json')
  const listed = approvals.list(bot.id)
  const bad = listed.find((item) => item.id === 'bad')
  assert.equal(bad.state, 'invalid')
  assert.equal(bad.code, ERROR_CODES.approvalInvalid)
  expectCode(() => approvals.get(bot.id, 'bad'), ERROR_CODES.approvalInvalid)

  const nullExpiry = {
    schema: 1,
    id: 'null-expiry',
    botId: bot.id,
    actionId: 'act-null',
    nonce: 'n'.repeat(64),
    action: { kind: 'publish' },
    risk: ['outside'],
    origin: 'background',
    createdAt: '2026-11-22T10:00:00.000Z',
    expiresAt: null,
  }
  nullExpiry.actionHash = actionHashFor(nullExpiry)
  writeFileSync(path.join(dir, 'req-null-expiry.json'), JSON.stringify(nullExpiry))
  expectCode(() => approvals.get(bot.id, 'null-expiry'), ERROR_CODES.approvalInvalid)

  expectCode(
    () => approvals.createRequest(requestFor(bot, { action: { text: 'x'.repeat(20_000) } })),
    ERROR_CODES.approvalInvalid,
  )
  expectCode(() => approvals.createRequest(requestFor(bot, { risk: [] })), ERROR_CODES.approvalInvalid)
  expectCode(() => approvals.createRequest(requestFor(bot, { origin: 'other' })), ERROR_CODES.approvalInvalid)
  expectCode(() => approvals.createRequest(requestFor(bot, { id: '../escape' })), ERROR_CODES.approvalInvalid)

  const created = approvals.createRequest(requestFor(bot), { now: '2026-11-22T10:00:00.000Z' })
  expectCode(
    () => approvals.createRequest(requestFor(bot, { id: created.id }), { now: '2026-11-22T10:00:00.000Z' }),
    ERROR_CODES.approvalReplay,
  )
})

check('unknown ids and wrong bots are refused', () => {
  const { bots, bot, approvals } = setup()
  expectCode(() => approvals.get(bot.id, 'missing'), ERROR_CODES.approvalUnknown)
  expectCode(() => approvals.decide(bot.id, 'missing', 'approve'), ERROR_CODES.approvalUnknown)
  const other = bots.create({ name: 'Other Bot', label: 'Other' })
  const created = approvals.createRequest(requestFor(bot), { now: '2026-11-22T10:00:00.000Z' })
  expectCode(() => approvals.decide(other.id, created.id, 'approve'), ERROR_CODES.approvalUnknown)
  expectCode(() => approvals.get(other.id, created.id), ERROR_CODES.approvalUnknown)
})

check('list is newest first and carries decision state', () => {
  const { bot, approvals } = setup()
  const first = approvals.createRequest(requestFor(bot, { actionId: 'act-1' }), { now: '2026-11-22T10:00:00.000Z' })
  const second = approvals.createRequest(requestFor(bot, { actionId: 'act-2' }), { now: '2026-11-22T10:01:00.000Z' })
  approvals.decide(bot.id, first.id, 'deny', { now: '2026-11-22T10:02:00.000Z' })
  const listed = approvals.list(bot.id, { now: '2026-11-22T10:03:00.000Z' })
  assert.deepEqual(listed.map((item) => item.id), [second.id, first.id])
  assert.equal(listed.find((item) => item.id === first.id).state, 'denied')
  assert.equal(listed.find((item) => item.id === second.id).state, 'pending')
})

let failed = 0
for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}`)
    console.log(`     ${error?.stack ?? error}`)
  }
}

for (const root of roots) rmSync(root, { recursive: true, force: true })

console.log(`${checks.length - failed}/${checks.length} approval checks passed`)
if (failed) process.exitCode = 1
