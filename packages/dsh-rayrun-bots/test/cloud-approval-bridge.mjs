/**
 * Cloud proposal bridge checks (fake file tool and machine).
 *
 *   node test/cloud-approval-bridge.mjs
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCloudApprovalBridge } from '../lib/cloud-approval-bridge.js'
import { openApprovalStore } from '../lib/approvals.js'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'

const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function setup({ status = 'Running', withTool = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-cloud-approvals-'))
  roots.push(root)
  const bots = openBotStore(root)
  const bot = bots.create({ id: 'cloud-bot', name: 'Cloud Bot', label: 'Asks first' })
  const store = openApprovalStore(root)
  const files = new Map()
  const uploads = []
  const listingSizes = new Map()
  const tool = {
    async execute(args) {
      if (args.action === 'list') {
        const prefix = `${args.path}/`
        const entries = [...files.keys()].filter((key) => key.startsWith(prefix))
        if (entries.length === 0) return `${args.path}: empty`
        return entries.map((key) => {
          const name = key.slice(prefix.length)
          const size = listingSizes.get(key)
          return `- ${name}${size === undefined ? '' : `  ${size} B`}`
        }).join('\n')
      }
      if (args.action === 'download') {
        if (!files.has(args.path)) {
          const error = new Error('file not found')
          error.status = 404
          throw error
        }
        return files.get(args.path)
      }
      if (args.action === 'upload') {
        uploads.push(args)
        files.set(args.path, args.text)
        return 'Uploaded'
      }
      throw new Error(`unexpected file action: ${args.action}`)
    },
  }
  let machineStatus = status
  const bridge = createCloudApprovalBridge({
    stateRoot: root,
    getTools: () => (withTool ? { get: (name) => (name === 'rayrun_files' ? tool : undefined) } : { get: () => undefined }),
    getMachine: async () => ({ id: 'box-id', name: 'box', status: machineStatus }),
    now: () => Date.parse('2026-11-23T10:00:00.000Z'),
  })
  function proposal(id, overrides = {}) {
    const value = {
      schema: 1,
      id,
      botId: bot.id,
      actionId: id,
      action: { kind: 'rayrun.machine.stop', machine: 'box' },
      origin: 'chat',
      createdAt: '2026-11-23T09:59:00.000Z',
      ...overrides,
    }
    files.set(`.rayrun/bots/${bot.id}/proposals/${id}.json`, JSON.stringify(value))
    return value
  }
  return {
    root, bot, store, bridge, files, uploads, listingSizes,
    proposal,
    setStatus: (value) => { machineStatus = value },
  }
}

check('imports a valid proposal once and derives local risk', async () => {
  const { bot, store, bridge, proposal } = setup()
  proposal('prop-1')
  const first = await bridge.sync(bot.id)
  assert.deepEqual(first, { imported: ['prop-1'], duplicates: 0, rejected: 0, truncated: false, flushed: 0 })
  const approval = store.get(bot.id, 'prop-1')
  assert.equal(approval.state, 'pending')
  assert.deepEqual(approval.action, { kind: 'rayrun.machine.stop', machine: 'box' })
  assert.deepEqual(approval.risk, ['outside'])
  assert.equal(approval.origin, 'chat')
  assert.equal(Object.hasOwn(approval, 'nonce'), false)

  const second = await bridge.sync(bot.id)
  assert.deepEqual(second, { imported: [], duplicates: 1, rejected: 0, truncated: false, flushed: 0 })
})

check('rejects malformed, wrong-bot, oversized and unknown-field proposals', async () => {
  const { bot, store, bridge, files, listingSizes, proposal } = setup()
  proposal('prop-good')
  files.set(`.rayrun/bots/${bot.id}/proposals/prop-wrong-bot.json`, JSON.stringify({
    schema: 1, id: 'prop-wrong-bot', botId: 'other-bot', actionId: 'a',
    action: { kind: 'rayrun.machine.stop', machine: 'box' }, origin: 'chat',
  }))
  files.set(`.rayrun/bots/${bot.id}/proposals/prop-unknown.json`, JSON.stringify({
    schema: 1, id: 'prop-unknown', botId: bot.id, actionId: 'a',
    action: { kind: 'rayrun.machine.stop', machine: 'box' }, origin: 'chat', extra: true,
  }))
  files.set(`.rayrun/bots/${bot.id}/proposals/prop-nofile.json`, JSON.stringify({
    schema: 1, id: 'prop-other', botId: bot.id, actionId: 'a',
    action: { kind: 'rayrun.machine.stop', machine: 'box' }, origin: 'chat',
  }))
  files.set(`.rayrun/bots/${bot.id}/proposals/prop-large.json`, '{"schema":1}')
  listingSizes.set(`.rayrun/bots/${bot.id}/proposals/prop-large.json`, 20_000)
  const result = await bridge.sync(bot.id)
  assert.deepEqual(result.imported, ['prop-good'])
  assert.equal(result.rejected, 4)
  assert.equal(store.get(bot.id, 'prop-good').state, 'pending')
  assert.throws(() => store.get(bot.id, 'prop-large'), (error) => error.code === ERROR_CODES.approvalUnknown)
})

check('the cloud CLI writes one typed, non-overwriting proposal file', () => {
  const { root, bot } = setup()
  const script = new URL('../cloud-host/bin/propose.mjs', import.meta.url)
  const env = {
    ...process.env,
    DSH_BOT_ROOT: root,
    DSH_BOT_ID: bot.id,
    DSH_BOT_MACHINE: 'box',
  }
  const first = spawnSync(process.execPath, [
    script.pathname, '--kind', 'rayrun.machine.start', '--machine', 'box', '--id', 'prop-cli',
  ], { env, encoding: 'utf8' })
  assert.equal(first.status, 0, first.stderr)
  const file = path.join(root, 'bots', bot.id, 'proposals', 'prop-cli.json')
  const proposal = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(proposal.schema, 1)
  assert.equal(proposal.botId, bot.id)
  assert.deepEqual(proposal.action, { kind: 'rayrun.machine.start', machine: 'box' })
  assert.equal(proposal.origin, 'chat')
  assert.doesNotMatch(readFileSync(file, 'utf8'), /token|secret|Bearer|sk-/i)

  const again = spawnSync(process.execPath, [
    script.pathname, '--kind', 'rayrun.machine.start', '--machine', 'box', '--id', 'prop-cli',
  ], { env, encoding: 'utf8' })
  assert.notEqual(again.status, 0)
  assert.match(again.stderr, /already exists/)
})

check('does not start or read a stopped machine, and fails closed without the file tool', async () => {
  const stopped = setup({ status: 'Stopped' })
  stopped.proposal('prop-1')
  const skipped = await stopped.bridge.sync(stopped.bot.id)
  assert.equal(skipped.skipped, 'machine_not_running')
  assert.deepEqual(skipped.imported, [])

  const missing = setup({ withTool: false })
  await assert.rejects(
    missing.bridge.sync(missing.bot.id),
    (error) => error.code === ERROR_CODES.runtimeUnavailable,
  )
})

check('refuses to import past the pending approval cap', async () => {
  const { bot, store, bridge, proposal } = setup()
  for (let index = 0; index < 20; index += 1) {
    store.createRequest({
      botId: bot.id,
      actionId: `local-${index}`,
      action: { kind: 'rayrun.machine.stop', machine: 'box' },
      risk: ['outside'],
      origin: 'chat',
    })
  }
  proposal('prop-over-cap')
  const result = await bridge.sync(bot.id)
  assert.deepEqual(result.imported, [])
  assert.equal(result.truncated, true)
  assert.equal(store.list(bot.id).filter((approval) => approval.state === 'pending').length, 20)
})

check('writes a sanitized result for the next bot turn', async () => {
  const { bot, bridge, uploads } = setup()
  const payload = await bridge.writeResult(bot.id, 'prop-1', {
    state: 'approved',
    execution: {
      state: 'done',
      result: {
        kind: 'rayrun.machine.stop',
        verb: 'stop',
        machine: 'box',
        machineId: 'box-id',
        status: 'Stopped',
        token: 'Bearer must-not-leak',
      },
    },
  })
  assert.equal(payload.state, 'approved')
  assert.equal(payload.execution.state, 'done')
  assert.equal(payload.queued, false)
  assert.equal(Object.hasOwn(payload.execution.result, 'token'), false)
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].path, `.rayrun/bots/${bot.id}/approval-results/prop-1.json`)
  assert.doesNotMatch(uploads[0].text, /must-not-leak|Bearer|sk-/)

  const stopped = setup({ status: 'Stopped' })
  const queued = await stopped.bridge.writeResult(stopped.bot.id, 'prop-1', {
    state: 'denied',
    execution: { state: 'not_executed' },
  })
  assert.equal(queued.queued, true)
  assert.equal(stopped.uploads.length, 0)
  const local = path.join(stopped.root, 'bots', stopped.bot.id, 'approval-results', 'prop-1.json')
  assert.ok(existsSync(local), 'stopped result should be queued locally')

  stopped.setStatus('Running')
  const flushed = await stopped.bridge.sync(stopped.bot.id)
  assert.equal(flushed.flushed, 1)
  assert.equal(stopped.uploads.length, 1)
  assert.equal(stopped.uploads[0].path, `.rayrun/bots/${stopped.bot.id}/approval-results/prop-1.json`)
  assert.equal(existsSync(local), false)
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
console.log(`${passed}/${checks.length} cloud approval bridge checks passed`)
if (failed > 0) process.exit(1)
