/**
 * Persistent cloud host runtime adapter checks.
 *
 *   node test/cloud-host-runtime.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCloudHostRuntime, hostRuntimeName } from '../lib/cloud-host-runtime.js'
import { ERROR_CODES } from '../lib/errors.js'

const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function setup({ machineStatus = 'Running', runtime: existing = null, withTool = true, project = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-cloud-host-runtime-'))
  roots.push(root)
  const calls = []
  const uploads = []
  const files = new Map()
  files.set('.rayrun/host/state.json', JSON.stringify({ state: 'running' }))
  const state = {
    machine: { id: 'box-id', name: 'box', status: machineStatus, remote_desktop: false },
    runtimes: new Map(existing === null ? [] : [[existing.name, existing]]),
    puts: [],
  }
  const tool = {
    async execute(args) {
      if (args.action === 'upload') {
        uploads.push(args)
        files.set(args.path, args.text)
        return 'uploaded'
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
      value = { ok: true, connection: { configured: true }, machines: state.machine ? [state.machine] : [] }
    } else if (body.action === 'machine.action') {
      state.machine = { ...state.machine, status: 'Running' }
      value = { ok: true, machine: state.machine }
    } else if (body.action === 'runtime.get') {
      value = { ok: true, runtime: state.runtimes.get(body.name) ?? null }
    } else if (body.action === 'runtime.put') {
      state.puts.push(body)
      const runtime = { name: body.name, state: 'running', spec: body.spec, pid: 1, restarts: 0 }
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
    credentials: ['deepseek-flash'],
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

  const spec = state.puts[0].spec
  assert.deepEqual(spec.argv, ['node', '/workspace/.rayrun/bin/host.mjs'])
  assert.deepEqual(spec.credentials, ['deepseek-flash'])
  assert.equal(spec.keep_alive, true)
  assert.equal(spec.restart, 'always')
  assert.equal(spec.env.DSH_BOT_ROOT, '/workspace/.rayrun')
  assert.equal(Object.hasOwn(spec.env, 'BOT_ID'), false)
  assert.equal(hostRuntimeName(), 'bot-host')
})

check('projects the host assets before starting when no override is set', async () => {
  const { root, runtime, uploads, state } = setup({ project: true })
  await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  const hostUploads = uploads.filter((item) => String(item.path).startsWith('.rayrun/host/'))
  assert.ok(hostUploads.length >= 4)
  assert.equal(state.puts[0].spec.argv[1], '/workspace/.rayrun/host/0.1.0-alpha.0/host.mjs')
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

check('status stays running until the outbox exists, then collect returns the reply', async () => {
  const { root, runtime, files } = setup()
  const started = await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  assert.deepEqual(await runtime.status({ detached: started }), { running: true })
  const outbox = `.rayrun/bots/${bot.id}/outbox/${started.taskId}.json`
  files.set(outbox, JSON.stringify({ taskId: started.taskId, reply: 'host reply' }))
  assert.deepEqual(await runtime.status({ detached: started }), { running: false })
  assert.deepEqual(await runtime.collect({ detached: started }), { text: 'host reply' })
})

check('starts a stopped machine and resumes a paused one', async () => {
  for (const [status, verb] of [['Stopped', 'start'], ['Paused', 'resume']]) {
    const { root, runtime, calls } = setup({ machineStatus: status })
    await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
    const action = calls.find((call) => call.action === 'machine.action')
    assert.equal(action?.verb, verb, `${status} should use ${verb}`)
  }
})

check('reuses an existing running runtime without putting it again', async () => {
  const existing = { name: 'bot-host', state: 'running', pid: 7, restarts: 0 }
  const { root, runtime, state } = setup({ runtime: existing })
  await runtime.start({ bot, text: 'hello', messageSeq: 1, botId: bot.id, stateRoot: root })
  assert.equal(state.puts.length, 0)
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
