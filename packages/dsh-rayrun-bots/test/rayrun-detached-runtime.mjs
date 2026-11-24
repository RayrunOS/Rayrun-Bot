/**
 * Detached `dsh.start/status/result` adapter checks.
 *
 *   node test/rayrun-detached-runtime.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ERROR_CODES } from '../lib/errors.js'
import { createRayrunDetachedRuntime } from '../lib/rayrun-detached-runtime.js'

const errors = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

const MACHINE = {
  ok: true,
  connection: { configured: true },
  machines: [{ id: 'machine-1', name: 'rayrun-bot', status: 'Running' }],
}

function fakeFetch({ start, status = { running: true, files: ['reply.md'], activity: null }, result } = {}) {
  const calls = []
  const impl = async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push({ url: String(url), body })
    let payload = null
    if (body.action === 'overview') payload = MACHINE
    else if (body.action === 'dsh.start') payload = start ?? {
      ok: true,
      task_id: 'task-test',
      sandbox: 'rayrun-bot',
      machine_id: 'machine-1',
      round: 1,
      started_at: '2026-11-22T10:00:00.000Z',
    }
    else if (body.action === 'dsh.status') payload = { ok: true, task_id: body.task_id, ...status }
    else if (body.action === 'dsh.result') payload = result ?? {
      ok: true,
      task_id: body.task_id,
      running: false,
      results_dir: path.join(body.local_dir, '.dsh', 'results', body.task_id),
      files: ['reply.md'],
      released: true,
      questions: '',
    }
    else payload = { ok: false, error: { code: 'unsupported_action', message: 'unknown action', status: 400 } }
    return { ok: true, status: 200, async json() { return payload } }
  }
  impl.calls = calls
  return impl
}

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-detached-'))
  roots.push(root)
  return root
}

check('start posts a bounded dsh.start and returns its task id', async () => {
  const stateRoot = setup()
  const fetchImpl = fakeFetch()
  const runtime = createRayrunDetachedRuntime({
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl,
  })
  assert.equal(runtime.available, true)
  assert.equal(runtime.detached, true)
  const started = await runtime.start({
    bot: { id: 'echo', name: 'Echo', label: 'Echoes', instructions: 'Reply briefly.' },
    text: 'hello',
    history: [],
    messageSeq: 1,
    botId: 'echo',
    stateRoot,
  })
  assert.equal(started.taskId, 'task-test')
  assert.equal(started.sandbox, 'rayrun-bot')
  assert.equal(started.timeoutSeconds, 900)
  assert.equal(path.isAbsolute(started.localDir), true)
  assert.equal(started.startedAt, '2026-11-22T10:00:00.000Z')

  const startCall = fetchImpl.calls.find((call) => call.body.action === 'dsh.start')
  assert.equal(startCall.body.sandbox, 'rayrun-bot')
  assert.equal(startCall.body.local_dir, started.localDir)
  assert.equal(startCall.body.timeout, 900)
  assert.match(startCall.body.task_id, /^task-/)
  assert.match(startCall.body.objective, /hello/)
  assert.match(startCall.body.objective, /reply\.md/)
  assert.deepEqual(startCall.body.acceptance, [
    'The task result directory contains reply.md with a self-contained reply to the latest user message.',
    'No external side effect was performed.',
  ])
  assert.doesNotMatch(JSON.stringify(fetchImpl.calls), /Bearer\s|RAYRUN_TOKEN|sk-[A-Za-z0-9]{16,}/)
})

check('status and result collect reply.md from the task directory', async () => {
  const stateRoot = setup()
  const fetchImpl = fakeFetch()
  const runtime = createRayrunDetachedRuntime({
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl,
  })
  const started = await runtime.start({
    bot: { id: 'echo', name: 'Echo', label: 'Echoes', instructions: 'Reply briefly.' },
    text: 'hello',
    history: [],
    messageSeq: 1,
    botId: 'echo',
    stateRoot,
  })
  const running = await runtime.status({ detached: started })
  assert.deepEqual(running, { running: true, files: ['reply.md'], activity: null })

  const resultDir = path.join(started.localDir, '.dsh', 'results', started.taskId)
  mkdirSync(resultDir, { recursive: true })
  writeFileSync(path.join(resultDir, 'reply.md'), 'pong\n')
  const collected = await runtime.collect({ detached: started })
  assert.equal(collected.text, 'pong')
  assert.equal(collected.released, true)
})

check('a missing reply.md fails closed instead of collecting a stale file', async () => {
  const stateRoot = setup()
  const fetchImpl = fakeFetch()
  const runtime = createRayrunDetachedRuntime({
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl,
  })
  const started = await runtime.start({
    bot: { id: 'echo', name: 'Echo', label: 'Echoes', instructions: 'Reply briefly.' },
    text: 'hello',
    history: [],
    messageSeq: 1,
    botId: 'echo',
    stateRoot,
  })
  await assert.rejects(runtime.collect({ detached: started }), (error) => {
    assert.equal(error.code, ERROR_CODES.internal)
    assert.match(error.message, /did not write reply\.md/)
    return true
  })
})

check('a dependency error code is mapped before a task is attached', async () => {
  const stateRoot = setup()
  const fetchImpl = fakeFetch({
    start: { ok: false, error: { code: 'sandbox_missing', message: 'missing', status: 404 } },
  })
  const runtime = createRayrunDetachedRuntime({
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl,
  })
  await assert.rejects(runtime.start({
    bot: { id: 'echo', name: 'Echo', label: 'Echoes', instructions: 'Reply briefly.' },
    text: 'hello',
    history: [],
    messageSeq: 1,
    botId: 'echo',
    stateRoot,
  }), (error) => {
    assert.equal(error.code, ERROR_CODES.machineStopped)
    return true
  })
})

check('availability follows a late origin injection', () => {
  let origin
  const runtime = createRayrunDetachedRuntime({
    getOrigin: () => origin,
    fetchImpl: fakeFetch(),
  })
  assert.equal(runtime.available, false)
  origin = 'http://127.0.0.1:1234'
  assert.equal(runtime.available, true)
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

console.log(`${checks.length - failed}/${checks.length} detached runtime checks passed`)
if (failed) process.exitCode = 1
