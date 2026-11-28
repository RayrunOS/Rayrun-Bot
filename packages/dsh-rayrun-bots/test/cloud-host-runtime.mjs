/**
 * Persistent cloud host runtime adapter checks.
 *
 *   node test/cloud-host-runtime.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openApprovalStore } from '../lib/approvals.js'
import { openBotStore } from '../lib/bots.js'
import { createCloudHostRuntime, hostRuntimeName } from '../lib/cloud-host-runtime.js'
import { ERROR_CODES } from '../lib/errors.js'
import { hostAssetDigest } from '../lib/host-projection.js'

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function setup({
  machineStatus = 'Running', runtime: existing = null, withTool = true, project = false,
  configured = true, tokenMissing = false, hostReadyAfter = 0, credentials = ['deepseek-flash'],
  machineCredentials = null, runtimeOptions = {},
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-cloud-host-runtime-'))
  roots.push(root)
  const calls = []
  const uploads = []
  const files = new Map()
  files.set('.rayrun/host/state.json', JSON.stringify({ state: 'running' }))
  const state = {
    machine: {
      id: 'box-id', name: 'box', status: machineStatus, remote_desktop: false,
      ...(machineCredentials === null ? {} : { credentials: machineCredentials }),
    },
    runtimes: new Map(existing === null ? [] : [[existing.name, existing]]),
    puts: [],
    putWhileBusy: false,
  }
  let hostStateReads = 0
  const tool = {
    async execute(args) {
      if (tokenMissing) {
        const error = new Error('No Rayrun token.')
        error.code = 'token_required'
        throw error
      }
      if (args.action === 'upload') {
        uploads.push(args)
        files.set(args.path, args.text)
        return 'uploaded'
      }
      if (args.action === 'download' && args.path === '.rayrun/host/state.json' && hostReadyAfter > 0) {
        hostStateReads += 1
        return JSON.stringify({ state: hostStateReads > hostReadyAfter ? 'running' : 'stopped' })
      }
      if (args.action === 'download') {
        if (files.has(args.path)) return files.get(args.path)
        const error = new Error('file not found')
        error.status = 404
        throw error
      }
      throw new Error(`unexpected file action: ${args.action}`)
    },
  }
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push(body)
    let value
    if (body.action === 'overview') {
      value = { ok: true, connection: { configured }, machines: state.machine ? [state.machine] : [] }
    } else if (body.action === 'machine.action') {
      state.machine = { ...state.machine, status: 'Running' }
      value = { ok: true, machine: state.machine }
    } else if (body.action === 'runtime.get') {
      value = { ok: true, runtime: state.runtimes.get(body.name) ?? null }
    } else if (body.action === 'runtime.put') {
      state.puts.push(body)
      try {
        const fileState = JSON.parse(files.get('.rayrun/host/state.json') ?? '{}')
        if (Number(fileState?.queueDepth) > 0) state.putWhileBusy = true
      } catch {
        // The state file is optional for old hosts.
      }
      try {
        const fileState = JSON.parse(files.get('.rayrun/host/state.json') ?? 'null')
        if (fileState && typeof fileState === 'object') {
          files.set('.rayrun/host/state.json', JSON.stringify({
            ...fileState, state: 'running', queueDepth: 0, startedAt: `restart-${state.puts.length}`,
          }))
        }
      } catch {
        // No state file to refresh.
      }
      const runtime = { name: body.name, state: 'running', spec: body.spec, pid: 1 + state.puts.length, restarts: 0 }
      state.runtimes.set(body.name, runtime)
      value = { ok: true, runtime, applied: true, restarted: false }
    } else if (body.action === 'runtime.start') {
      const current = state.runtimes.get(body.name)
      const runtime = { ...(current ?? { name: body.name }), state: 'running', pid: 2, restarts: 0 }
      state.runtimes.set(body.name, runtime)
      value = { ok: true, runtime }
    } else {
      throw new Error(`unexpected RPC action: ${body.action}`)
    }
    return new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const runtime = createCloudHostRuntime({
    getOrigin: () => 'http://127.0.0.1:8080',
    fetchImpl,
    getTools: () => (withTool ? { get: (name) => (name === 'rayrun_files' ? tool : undefined) } : { get: () => undefined }),
    machine: 'box',
    credentials,
    ...runtimeOptions,
    ...(project ? {} : { hostScript: '/workspace/.rayrun/bin/host.mjs' }),
  })
  return { root, runtime, state, calls, uploads, files, machineStatus }
}

const bot = { id: 'echo-bot', name: 'Echo Bot', label: 'Echoes', instructions: 'Reply briefly.' }

check('start uploads one task and returns a detached record', async () => {
  const { root, runtime, state, uploads, files } = setup()
  assert.equal(runtime.name, 'rayrun-cloud-host')
  assert.equal(runtime.detached, true)
  assert.equal(runtime.available, true)
  const started = await runtime.start({
    bot,
    text: 'hello',
    history: [],
    messageSeq: 1,
    botId: bot.id,
    stateRoot: root,
  })
  assert.match(started.taskId, /^task-/)
  assert.equal(started.sandbox, 'box')
  assert.equal(started.timeoutSeconds, 900)
  assert.equal(started.localDir, path.join(root, 'bots', bot.id, 'workspace'))
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].sandbox, 'box')
  assert.match(uploads[0].path, new RegExp(`^\\.rayrun/bots/${bot.id}/inbox/${started.taskId}\\.json$`))
  const task = JSON.parse(uploads[0].text)
  assert.equal(task.id, started.taskId)
  assert.match(task.text, /Echo Bot/)
  assert.match(task.text, /hello/)
  assert.match(task.text, /Approval requests:/)
  assert.match(task.text, /rayrun-approval/)
  assert.match(task.text, /"machine":"box"/)
  assert.match(task.text, /rayrun\.machine\.pause/)

  const spec = state.puts[0].spec
  assert.deepEqual(spec.argv, ['node', '/workspace/.rayrun/bin/host.mjs'])
  assert.deepEqual(spec.credentials, ['deepseek-flash'])
  assert.equal(spec.keep_alive, true)
  assert.equal(spec.restart, 'always')
  assert.equal(spec.env.DSH_BOT_ROOT, '/workspace/.rayrun')
  assert.equal(spec.env.DSH_BOT_MACHINE, 'box')
  assert.equal(spec.env.DSH_BOT_PROPOSE, '/workspace/.rayrun/bin/bin/propose.mjs')
  assert.equal(Object.hasOwn(spec.env, 'BOT_ID'), false)
  assert.equal(hostRuntimeName(), 'bot-host')
})

check('uses the machine credential when none is configured', async () => {
  const { root, runtime, state } = setup({ credentials: [], machineCredentials: ['machine-credential'] })
  await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  assert.deepEqual(state.puts[0].spec.credentials, ['machine-credential'])
})

check('carries routine origin into the cloud task', async () => {
  const { root, runtime, uploads } = setup()
  const started = await runtime.start({
    bot,
    text: 'routine prompt',
    history: [],
    messageSeq: 1,
    origin: 'routine',
    botId: bot.id,
    stateRoot: root,
  })
  const task = JSON.parse(uploads[0].text)
  assert.equal(task.id, started.taskId)
  assert.equal(task.origin, 'routine')
})

const PRIMARY = { id: 'superagent', name: 'Superagent', label: 'Coordinates your bots', instructions: 'Route work.' }
const WORKER = {
  id: 'weekly-watch', name: 'Weekly Watch', label: 'Watches the weekly numbers',
  instructions: 'Only check the numbers.',
}

check('the primary task carries the worker roster and the delegate prompt', async () => {
  const { root, runtime, uploads } = setup({
    runtimeOptions: {
      getPrimaryBotId: () => PRIMARY.id,
      getRoster: () => [WORKER],
    },
  })
  const started = await runtime.start({
    bot: PRIMARY, text: 'check the numbers', history: [], messageSeq: 1, botId: PRIMARY.id, stateRoot: root,
  })
  const task = JSON.parse(uploads[0].text)
  assert.equal(task.id, started.taskId)
  assert.deepEqual(task.delegation, {
    primary: true,
    roster: [{
      id: 'weekly-watch', name: 'Weekly Watch', label: 'Watches the weekly numbers',
      instructions: 'Only check the numbers.',
    }],
  })
  assert.match(task.text, /Teammates:/)
  assert.match(task.text, /- weekly-watch — Weekly Watch — Watches the weekly numbers/)
  assert.match(task.text, /rayrun-delegate/)
  assert.match(task.text, /Handle simple tasks yourself/)
  assert.doesNotMatch(task.text, /Only check the numbers/)
})

check('a worker task has no delegation metadata or delegate prompt', async () => {
  const { root, runtime, uploads } = setup({
    runtimeOptions: {
      getPrimaryBotId: () => PRIMARY.id,
      getRoster: () => [WORKER],
    },
  })
  await runtime.start({
    bot: WORKER, text: 'check the numbers', history: [], messageSeq: 1, botId: WORKER.id, stateRoot: root,
  })
  const task = JSON.parse(uploads[0].text)
  assert.equal(Object.hasOwn(task, 'delegation'), false)
  assert.doesNotMatch(task.text, /Teammates:|rayrun-delegate/)
})

check('a roster read failure leaves the primary as an ordinary bot', async () => {
  const { root, runtime, uploads } = setup({
    runtimeOptions: {
      getPrimaryBotId: () => PRIMARY.id,
      getRoster: () => { throw new Error('store unavailable') },
    },
  })
  await runtime.start({
    bot: PRIMARY, text: 'hello', history: [], messageSeq: 1, botId: PRIMARY.id, stateRoot: root,
  })
  const task = JSON.parse(uploads[0].text)
  assert.equal(Object.hasOwn(task, 'delegation'), false)
  assert.doesNotMatch(task.text, /Teammates:|rayrun-delegate/)
})

check('too many workers fail closed before the machine or host is touched', async () => {
  const roster = Array.from({ length: 9 }, (_, index) => ({
    id: `worker-${index}`, name: `Worker ${index}`, label: 'Does work', instructions: 'Work.',
  }))
  const { root, runtime, uploads, state } = setup({
    runtimeOptions: { getPrimaryBotId: () => PRIMARY.id, getRoster: () => roster },
  })
  await assert.rejects(runtime.start({
    bot: PRIMARY, text: 'hello', history: [], messageSeq: 1, botId: PRIMARY.id, stateRoot: root,
  }), (error) => {
    assert.equal(error.code, ERROR_CODES.internal)
    assert.match(error.message, /at most 8/)
    return true
  })
  assert.equal(uploads.length, 0)
  assert.equal(state.puts.length, 0)
})

check('an oversized roster payload fails closed before the machine or host is touched', async () => {
  const roster = Array.from({ length: 8 }, (_, index) => ({
    id: `worker-${index}`, name: `Worker ${index}`, label: 'Does work',
    instructions: 'x'.repeat(9 * 1024),
  }))
  const { root, runtime, uploads, state } = setup({
    runtimeOptions: { getPrimaryBotId: () => PRIMARY.id, getRoster: () => roster },
  })
  await assert.rejects(runtime.start({
    bot: PRIMARY, text: 'hello', history: [], messageSeq: 1, botId: PRIMARY.id, stateRoot: root,
  }), (error) => {
    assert.equal(error.code, ERROR_CODES.internal)
    assert.match(error.message, /too large/)
    return true
  })
  assert.equal(uploads.length, 0)
  assert.equal(state.puts.length, 0)
})

check('includes recent local approval outcomes in the next prompt', async () => {
  const { root, runtime, uploads } = setup()
  const bot = openBotStore(root).create({ id: 'context-bot', name: 'Context Bot', label: 'Context' })
  const approvals = openApprovalStore(root)
  const created = approvals.createRequest({
    botId: bot.id,
    actionId: 'act-context',
    action: { kind: 'rayrun.machine.stop', machine: 'box' },
    risk: ['outside'],
    origin: 'chat',
  })
  approvals.decide(bot.id, created.id, 'approve')
  writeFileSync(
    path.join(root, 'bots', bot.id, 'approvals', `exec-${created.id}.json`),
    JSON.stringify({
      schema: 1, id: created.id, botId: bot.id, actionId: 'act-context', state: 'done',
      startedAt: '2026-11-23T10:00:00.000Z', finishedAt: '2026-11-23T10:00:01.000Z',
      result: { kind: 'rayrun.machine.stop', machine: 'box', status: 'Stopped' },
    }),
  )
  await runtime.start({ bot, text: 'continue', messageSeq: 1, botId: bot.id, stateRoot: root })
  const task = JSON.parse(uploads[0].text)
  assert.match(task.text, /Recent approval outcomes:/)
  assert.match(task.text, /rayrun\.machine\.stop on box: approved; execution done \(Stopped\)/)
  assert.doesNotMatch(task.text, /act-context|createdAt|finishedAt/)
})

check('projects the host assets before starting when no override is set', async () => {
  const { root, runtime, uploads, state } = setup({ project: true })
  await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  const hostUploads = uploads.filter((item) => String(item.path).startsWith('.rayrun/host/'))
  assert.ok(hostUploads.length >= 4)
  assert.equal(state.puts[0].spec.argv[1], `/workspace/.rayrun/host/${PACKAGE_VERSION}/host.mjs`)
  assert.equal(state.puts[0].spec.env.DSH_BOT_PROPOSE, `/workspace/.rayrun/host/${PACKAGE_VERSION}/bin/propose.mjs`)
})

check('concurrent bots share one host setup', async () => {
  const { root, runtime, state, uploads } = setup()
  const second = { id: 'other-bot', name: 'Other', label: 'Other', instructions: 'Reply.' }
  const [a, b] = await Promise.all([
    runtime.start({ bot, text: 'a', messageSeq: 1, botId: bot.id, stateRoot: root }),
    runtime.start({ bot: second, text: 'b', messageSeq: 1, botId: second.id, stateRoot: root }),
  ])
  assert.equal(state.puts.length, 1)
  assert.notEqual(a.taskId, b.taskId)
  assert.equal(uploads.filter((item) => item.path.includes('/inbox/')).length, 2)
})

check('recreates a deleted host runtime on the next turn', async () => {
  const { root, runtime, state, uploads } = setup()
  const first = await runtime.start({ bot, text: 'one', messageSeq: 1, botId: bot.id, stateRoot: root })
  assert.equal(state.puts.length, 1)
  state.runtimes.delete('bot-host')
  const second = await runtime.start({ bot, text: 'two', messageSeq: 2, botId: bot.id, stateRoot: root })
  assert.notEqual(first.taskId, second.taskId)
  assert.equal(state.puts.length, 2)
  assert.equal(state.runtimes.get('bot-host')?.state, 'running')
  assert.equal(uploads.filter((item) => item.path.includes('/inbox/')).length, 2)
})

check('waits past a stale stopped host state until the new host is running', async () => {
  const { root, runtime } = setup({ hostReadyAfter: 1 })
  const started = await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  assert.match(started.taskId, /^task-/)
})

check('status stays running until the outbox exists, then collect returns the reply', async () => {
  const { root, runtime, files } = setup()
  const started = await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  assert.deepEqual(await runtime.status({ detached: started }), { running: true })
  const outbox = `.rayrun/bots/${bot.id}/outbox/${started.taskId}.json`
  files.set(outbox, JSON.stringify({ taskId: started.taskId, reply: 'host reply' }))
  assert.deepEqual(await runtime.status({ detached: started }), { running: false })
  assert.deepEqual(await runtime.collect({ detached: started }), { text: 'host reply' })
})

check('an error outbox becomes a worker-no-reply error', async () => {
  const { root, runtime, files } = setup()
  const started = await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  const outbox = `.rayrun/bots/${bot.id}/outbox/${started.taskId}.json`
  files.set(outbox, JSON.stringify({ taskId: started.taskId, error: 'Authentication Fails: invalid key' }))
  await assert.rejects(runtime.collect({ detached: started }), (error) => {
    assert.equal(error.code, ERROR_CODES.workerNoReply)
    assert.match(error.message, /Authentication Fails/)
    return true
  })
})

check('can resolve a stopped machine without starting it for approval sync', async () => {
  const { runtime, calls } = setup({ machineStatus: 'Stopped' })
  const machine = await runtime.ensureMachine({ start: false })
  assert.equal(machine.status, 'Stopped')
  assert.equal(calls.some((call) => call.action === 'machine.action'), false)
})

check('starts a stopped machine and resumes a paused one', async () => {
  for (const [status, verb] of [['Stopped', 'start'], ['Paused', 'resume']]) {
    const { root, runtime, calls } = setup({ machineStatus: status })
    await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
    const action = calls.find((call) => call.action === 'machine.action')
    assert.equal(action?.verb, verb, `${status} should use ${verb}`)
  }
})

check('reuses a matching running runtime without putting it again', async () => {
  const { root, runtime, state } = setup()
  await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  assert.equal(state.puts.length, 1)
  await runtime.start({ bot, text: 'again', messageSeq: 2, botId: bot.id, stateRoot: root })
  assert.equal(state.puts.length, 1)
})

check('a changed host digest waits for idle and refreshes the runtime', async () => {
  const { root, runtime, state, files } = setup({ project: true })
  await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  assert.equal(state.puts.length, 1)
  assert.equal(state.puts[0].spec.env.DSH_BOT_HOST_DIGEST, hostAssetDigest())
  state.runtimes.get('bot-host').spec.env.DSH_BOT_HOST_DIGEST = 'stale'
  files.set('.rayrun/host/state.json', JSON.stringify({
    state: 'running', queueDepth: 1, startedAt: 'old',
  }))
  setTimeout(() => {
    files.set('.rayrun/host/state.json', JSON.stringify({
      state: 'running', queueDepth: 0, startedAt: 'old',
    }))
  }, 300)
  const startedAt = Date.now()
  const started = await runtime.start({ bot, text: 'again', messageSeq: 2, botId: bot.id, stateRoot: root })
  assert.equal(started.taskId.startsWith('task-'), true)
  assert.equal(state.putWhileBusy, false)
  assert.equal(state.puts.length, 2)
  assert.equal(state.puts[1].spec.env.DSH_BOT_HOST_DIGEST, hostAssetDigest())
  assert.ok(Date.now() - startedAt >= 1000, `refresh waited ${Date.now() - startedAt}ms`)
})

check('logs phase timings for projection, attach and inbox upload', async () => {
  const logs = []
  const { root, runtime } = setup({
    project: true,
    runtimeOptions: { logger: { info: (message) => logs.push(message) } },
  })
  await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  for (const phase of [
    'machine-list', 'projection', 'projection-write', 'ensure-host',
    'host-ready', 'prepare-host', 'inbox-upload', 'start-total',
  ]) {
    assert.ok(logs.some((line) => line.includes(`cloud-host timing ${phase} `)), `missing ${phase}`)
  }
})

check('a host that stays busy fails closed without restarting it', async () => {
  const { root, runtime, state, files } = setup({ project: true, runtimeOptions: { hostUpdateWaitMs: 100 } })
  await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  state.runtimes.get('bot-host').spec.env.DSH_BOT_HOST_DIGEST = 'stale'
  files.set('.rayrun/host/state.json', JSON.stringify({
    state: 'running', queueDepth: 1, startedAt: 'old',
  }))
  await assert.rejects(
    runtime.start({ bot, text: 'again', messageSeq: 2, botId: bot.id, stateRoot: root }),
    (error) => error.code === ERROR_CODES.runtimeUnavailable && /stayed busy/.test(error.message),
  )
  assert.equal(state.puts.length, 1)
  assert.equal(state.putWhileBusy, false)
})

check('refuses without a Rayrun connection before a machine lookup', async () => {
  const { root, runtime, state } = setup({ configured: false })
  await assert.rejects(
    runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root }),
    (error) => error.code === ERROR_CODES.tokenRequired && /Connect Rayrun/.test(error.message),
  )
  assert.equal(state.machine.status, 'Running')
  assert.equal(state.puts.length, 0)
})

check('maps a missing token from the file tool to E_TOKEN_REQUIRED', async () => {
  const { root, runtime } = setup({ tokenMissing: true })
  await assert.rejects(
    runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root }),
    (error) => error.code === ERROR_CODES.tokenRequired,
  )
})

check('refuses when there is no machine', async () => {
  const { root, runtime, state } = setup()
  state.machine = null
  await assert.rejects(
    runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root }),
    (error) => error.code === ERROR_CODES.machineStopped,
  )
})

check('fails closed when the file tool is missing', async () => {
  const { root, runtime } = setup({ withTool: false })
  assert.equal(runtime.available, false)
  await assert.rejects(
    runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root }),
    (error) => error.code === ERROR_CODES.runtimeUnavailable,
  )
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
console.log(`${passed}/${checks.length} cloud host runtime checks passed`)
if (failed > 0) process.exit(1)
