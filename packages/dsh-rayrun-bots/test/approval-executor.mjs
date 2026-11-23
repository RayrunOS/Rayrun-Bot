/**
 * Local approval action and executor checks.
 *
 *   node test/approval-executor.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApprovalActionExecutor, normalizeApprovalAction } from '../lib/approval-actions.js'
import { openApprovalExecutor } from '../lib/approval-executor.js'
import { openApprovalStore } from '../lib/approvals.js'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'

const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-approval-executor-'))
  roots.push(root)
  const bots = openBotStore(root)
  const bot = bots.create({ name: 'Machine Watch', label: 'Watches the computer' })
  return { root, bot, store: openApprovalStore(root) }
}

function request(store, bot, overrides = {}) {
  return store.createRequest({
    botId: bot.id,
    actionId: 'act-1',
    action: { kind: 'rayrun.machine.stop', machine: 'box' },
    risk: ['outside'],
    origin: 'chat',
    ...overrides,
  })
}

function fakeRpc({ machines = [{ id: 'box-id', name: 'box', status: 'Running' }], actionError } = {}) {
  const calls = []
  return {
    calls,
    async call(action, payload) {
      calls.push({ action, payload })
      if (action === 'overview') return { ok: true, machines }
      if (action === 'machine.action') {
        if (actionError) throw actionError
        return {
          ok: true,
          machine: { id: payload.id, name: 'box', status: payload.verb === 'stop' ? 'Stopped' : 'Running' },
        }
      }
      throw new Error(`unexpected RPC action: ${action}`)
    },
  }
}

check('normalizes only typed machine actions and derives risk locally', () => {
  assert.deepEqual(normalizeApprovalAction({ kind: 'rayrun.machine.start', machine: 'box' }), {
    action: { kind: 'rayrun.machine.start', machine: 'box' },
    verb: 'start',
    risk: ['outside', 'cost'],
  })
  assert.deepEqual(normalizeApprovalAction({ kind: 'rayrun.machine.stop', machine: 'box-1' }).risk, ['outside'])
  assert.deepEqual(normalizeApprovalAction({ kind: 'rayrun.machine.pause', machine: 'box' }), {
    action: { kind: 'rayrun.machine.pause', machine: 'box' },
    verb: 'pause',
    risk: ['outside'],
  })
  assert.deepEqual(normalizeApprovalAction({ kind: 'rayrun.machine.resume', machine: 'box' }), {
    action: { kind: 'rayrun.machine.resume', machine: 'box' },
    verb: 'resume',
    risk: ['outside', 'cost'],
  })
  for (const value of [
    { kind: 'rayrun.machine.destroy', machine: 'box' },
    { kind: 'shell', machine: 'box' },
    { kind: 'rayrun.machine.stop', machine: 'box', argv: ['rm'] },
    { kind: 'rayrun.machine.stop', machine: '../box' },
    null,
  ]) {
    assert.throws(() => normalizeApprovalAction(value), (error) => (
      error.code === ERROR_CODES.approvalUnsupported || error.code === ERROR_CODES.approvalInvalid
    ))
  }
})

check('executes one approved stop exactly once and records the result', async () => {
  const { root, bot, store } = setup()
  const created = request(store, bot)
  store.decide(bot.id, created.id, 'approve')
  const rpc = fakeRpc()
  const executor = openApprovalExecutor({
    stateRoot: root,
    execute: createApprovalActionExecutor({ rpc }),
  })
  const first = await executor.run(bot.id, created.id)
  assert.equal(first.available, true)
  assert.equal(first.state, 'done')
  assert.equal(first.result.verb, 'stop')
  assert.equal(first.result.status, 'Stopped')
  assert.equal(first.idempotent, false)
  assert.deepEqual(rpc.calls.map((call) => call.action), ['overview', 'machine.action'])
  assert.deepEqual(rpc.calls[1].payload, { id: 'box-id', verb: 'stop' })

  const again = await executor.run(bot.id, created.id)
  assert.equal(again.state, 'done')
  assert.equal(again.idempotent, true)
  assert.equal(rpc.calls.length, 2)
  assert.equal(executor.status(bot.id, created.id).state, 'done')

  const audit = readFileSync(path.join(root, 'logs', 'audit.log'), 'utf8')
  assert.match(audit, /"event":"execution-start"/)
  assert.match(audit, /"event":"execution-done"/)
  assert.doesNotMatch(audit, /rayrun\.machine\.stop|box-id|Stopped/)
})

check('never executes a pending, denied or expired request', async () => {
  const { root, bot, store } = setup()
  const rpc = fakeRpc()
  const executor = openApprovalExecutor({
    stateRoot: root,
    execute: createApprovalActionExecutor({ rpc }),
  })
  const pending = request(store, bot, { actionId: 'pending' })
  assert.equal((await executor.run(bot.id, pending.id)).state, 'not_executed')

  const denied = request(store, bot, { actionId: 'denied' })
  store.decide(bot.id, denied.id, 'deny')
  assert.equal((await executor.run(bot.id, denied.id)).state, 'not_executed')

  const expired = store.createRequest({
    botId: bot.id,
    actionId: 'expired',
    action: { kind: 'rayrun.machine.stop', machine: 'box' },
    risk: ['outside'],
    origin: 'background',
    expiresAt: '1970-01-01T00:00:10.000Z',
  }, { now: 0 })
  assert.equal((await executor.run(bot.id, expired.id)).state, 'expired')
  assert.equal(rpc.calls.length, 0)
})

check('refuses an unsupported action without touching Rayrun', async () => {
  const { root, bot, store } = setup()
  const created = request(store, bot, {
    action: { kind: 'send-message', target: '#weekly', text: 'hello' },
    risk: ['outside', 'irreversible'],
  })
  store.decide(bot.id, created.id, 'approve')
  const rpc = fakeRpc()
  const executor = openApprovalExecutor({
    stateRoot: root,
    execute: createApprovalActionExecutor({ rpc }),
  })
  const result = await executor.run(bot.id, created.id)
  assert.equal(result.state, 'refused')
  assert.equal(result.code, ERROR_CODES.approvalUnsupported)
  assert.equal(rpc.calls.length, 0)
  assert.equal(executor.status(bot.id, created.id).state, 'refused')
  const again = await executor.run(bot.id, created.id)
  assert.equal(again.state, 'refused')
  assert.equal(again.idempotent, true)
  assert.equal(rpc.calls.length, 0)
})

check('records a missing target or RPC failure as failed and never retries it', async () => {
  const missing = setup()
  const missingRequest = request(missing.store, missing.bot)
  missing.store.decide(missing.bot.id, missingRequest.id, 'approve')
  const missingRpc = fakeRpc({ machines: [] })
  const missingExecutor = openApprovalExecutor({
    stateRoot: missing.root,
    execute: createApprovalActionExecutor({ rpc: missingRpc }),
  })
  const failedTarget = await missingExecutor.run(missing.bot.id, missingRequest.id)
  assert.equal(failedTarget.state, 'failed')
  assert.equal(failedTarget.code, ERROR_CODES.machineStopped)
  assert.equal(missingRpc.calls.length, 1)

  const broken = setup()
  const brokenRequest = request(broken.store, broken.bot)
  broken.store.decide(broken.bot.id, brokenRequest.id, 'approve')
  const brokenRpc = fakeRpc({ actionError: new Error('Bearer supersecretvalue sk-abcdefghijklmnop') })
  const brokenExecutor = openApprovalExecutor({
    stateRoot: broken.root,
    execute: createApprovalActionExecutor({ rpc: brokenRpc }),
  })
  const failed = await brokenExecutor.run(broken.bot.id, brokenRequest.id)
  assert.equal(failed.state, 'failed')
  assert.doesNotMatch(JSON.stringify(failed), /supersecretvalue|sk-abcdefghijklmnop/)
  const again = await brokenExecutor.run(broken.bot.id, brokenRequest.id)
  assert.equal(again.state, 'failed')
  assert.equal(brokenRpc.calls.length, 2)
  const audit = readFileSync(path.join(broken.root, 'logs', 'audit.log'), 'utf8')
  assert.doesNotMatch(audit, /supersecretvalue|sk-abcdefghijklmnop/)
})

check('returns a completed claim after the request TTL instead of refusing it', async () => {
  const { root, bot, store } = setup()
  const created = store.createRequest({
    botId: bot.id,
    actionId: 'ttl-done',
    action: { kind: 'rayrun.machine.stop', machine: 'box' },
    risk: ['outside'],
    origin: 'background',
    expiresAt: '1970-01-01T00:00:10.000Z',
  }, { now: 0 })
  store.decide(bot.id, created.id, 'approve', { now: 5000 })
  let clock = 6000
  const rpc = fakeRpc()
  const executor = openApprovalExecutor({
    stateRoot: root,
    execute: createApprovalActionExecutor({ rpc }),
    now: () => clock,
  })
  assert.equal((await executor.run(bot.id, created.id)).state, 'done')
  clock = 20_000
  const later = await executor.run(bot.id, created.id)
  assert.equal(later.state, 'done')
  assert.equal(later.idempotent, true)
  assert.equal(rpc.calls.length, 2)
})

check('leaves a crash-claimed action alone and fails closed on a corrupt claim', async () => {
  const { root, bot, store } = setup()
  const created = request(store, bot)
  store.decide(bot.id, created.id, 'approve')
  const claim = path.join(root, 'bots', bot.id, 'approvals', `exec-${created.id}.json`)
  writeFileSync(claim, JSON.stringify({
    schema: 1, id: created.id, botId: bot.id, actionId: 'act-1', state: 'executing',
    startedAt: '2026-11-23T00:00:00.000Z',
  }))
  const rpc = fakeRpc()
  const executor = openApprovalExecutor({
    stateRoot: root,
    execute: createApprovalActionExecutor({ rpc }),
  })
  const result = await executor.run(bot.id, created.id)
  assert.equal(result.state, 'executing')
  assert.equal(result.idempotent, true)
  assert.equal(rpc.calls.length, 0)

  writeFileSync(claim, '{not json')
  assert.throws(() => executor.status(bot.id, created.id), (error) => error.code === ERROR_CODES.approvalInvalid)
})

let passed = 0
let failed = 0
try {
  for (const { name, fn } of checks) {
    try {
      await fn()
      passed += 1
      console.log(`ok   ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}\n     ${String(error?.stack ?? error).split('\n').slice(0, 5).join('\n     ')}`)
    }
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
console.log(`${passed}/${checks.length} approval executor checks passed`)
if (failed > 0) process.exit(1)
