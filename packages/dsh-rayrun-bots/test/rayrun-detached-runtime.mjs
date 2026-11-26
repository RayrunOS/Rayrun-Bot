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
  machines: [{ id: 'machine-1', name: 'rayrun-bot', status: 'Running', agent: 'deepseek-harness@1' }],
}

function machineWith(agent) {
  const item = { ...MACHINE.machines[0] }
  if (agent === undefined) delete item.agent
  else item.agent = agent
  return { ...MACHINE, machines: [item] }
}

function detailWith(agent) {
  return {
    ok: true,
    machine: { id: 'machine-1', name: 'rayrun-bot', status: 'Running', agent },
  }
}

function fakeFetch({
  machine = MACHINE,
  detail,
  start,
  status = { running: true, files: ['reply.md'], activity: null },
  result,
} = {}) {
  const calls = []
  const impl = async (url, options) => {
    const body = JSON.parse(options.body)
    calls.push({ url: String(url), body })
    let payload = null
    if (body.action === 'overview') payload = machine
    else if (body.action === 'machine.get') payload = detail ?? {
      ok: false,
      error: { code: 'unsupported_action', message: 'no machine detail', status: 400 },
    }
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
  assert.equal(started.image, 'deepseek-harness@1')
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

check('rejects a known shell-oneshot image before dsh.start', async () => {
  for (const agent of ['dsh-bot@1', 'dsh-bot-devcheck@1']) {
    const stateRoot = setup()
    const fetchImpl = fakeFetch({ machine: machineWith(agent) })
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
      assert.equal(error.code, ERROR_CODES.imageUnsupported)
      assert.match(error.message, /shell oneshot/)
      assert.match(error.message, /deepseek-harness@1/)
      return true
    })
    assert.equal(fetchImpl.calls.some((call) => call.body.action === 'dsh.start'), false)
    assert.equal(fetchImpl.calls.some((call) => call.body.action === 'machine.get'), false)
  }
})

check('an unknown image is not blocked by the known-image precheck', async () => {
  const stateRoot = setup()
  const fetchImpl = fakeFetch({ machine: machineWith('custom-image@1') })
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
  assert.equal(started.taskId, 'task-test')
  assert.equal(started.image, 'custom-image@1')
  assert.equal(fetchImpl.calls.some((call) => call.body.action === 'machine.get'), false)
})

async function rejectStart(fetchImpl, extra = {}) {
  const runtime = createRayrunDetachedRuntime({
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl,
  })
  try {
    await runtime.start({
      bot: { id: 'echo', name: 'Echo', label: 'Echoes', instructions: 'Reply briefly.' },
      text: 'hello',
      history: [],
      messageSeq: 1,
      botId: 'echo',
      stateRoot: setup(),
      ...extra,
    })
  } catch (error) {
    return error
  }
  assert.fail('start should have failed before creating a task')
}

check('a blank overview image is read from machine.get before dsh.start', async () => {
  const fetchImpl = fakeFetch({
    machine: machineWith(''),
    detail: detailWith('dsh-bot@1'),
  })
  const error = await rejectStart(fetchImpl)
  assert.equal(error.code, ERROR_CODES.imageUnsupported)
  assert.equal(error.image, 'dsh-bot@1')
  assert.equal(error.computer, 'rayrun-bot')
  assert.match(error.message, /shell oneshot/)
  assert.equal(fetchImpl.calls.some((call) => call.body.action === 'machine.get'), true)
  assert.equal(fetchImpl.calls.some((call) => call.body.action === 'dsh.start'), false)
})

check('an unreadable image fails closed before dsh.start', async () => {
  for (const agent of ['', '   ', undefined]) {
    const fetchImpl = fakeFetch({
      machine: machineWith(agent),
      detail: detailWith(''),
    })
    const error = await rejectStart(fetchImpl)
    assert.equal(error.code, ERROR_CODES.imageUnsupported)
    assert.equal(error.image, undefined)
    assert.match(error.message, /could not be read/)
    assert.match(error.message, /no detached task was started/)
    assert.equal(fetchImpl.calls.some((call) => call.body.action === 'dsh.start'), false)
  }
})

check('a machine.get failure does not start a task', async () => {
  const fetchImpl = fakeFetch({ machine: machineWith('') })
  const error = await rejectStart(fetchImpl)
  assert.equal(error.code, ERROR_CODES.imageUnsupported)
  assert.match(error.message, /could not be read/)
  assert.equal(fetchImpl.calls.some((call) => call.body.action === 'machine.get'), true)
  assert.equal(fetchImpl.calls.some((call) => call.body.action === 'dsh.start'), false)
})

check('machine.get can supply a supported image and the start result records it', async () => {
  const fetchImpl = fakeFetch({
    machine: machineWith(''),
    detail: detailWith('deepseek-harness@1'),
  })
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
    stateRoot: setup(),
  })
  assert.equal(started.image, 'deepseek-harness@1')
  assert.equal(started.taskId, 'task-test')
})

check('a remembered oneshot image blocks a later blank read for the same computer', async () => {
  const fetchImpl = fakeFetch({
    machine: machineWith(''),
    detail: detailWith(''),
  })
  const error = await rejectStart(fetchImpl, {
    rememberedImage: 'dsh-bot@1',
    rememberedComputer: 'rayrun-bot',
  })
  assert.equal(error.code, ERROR_CODES.imageUnsupported)
  assert.equal(error.image, 'dsh-bot@1')
  assert.match(error.message, /dsh-bot@1/)
  assert.equal(fetchImpl.calls.some((call) => call.body.action === 'dsh.start'), false)
})

check('a remembered image for a different computer does not authorize a blank read', async () => {
  const fetchImpl = fakeFetch({
    machine: machineWith(''),
    detail: detailWith(''),
  })
  const error = await rejectStart(fetchImpl, {
    rememberedImage: 'deepseek-harness@1',
    rememberedComputer: 'other-computer',
  })
  assert.equal(error.code, ERROR_CODES.imageUnsupported)
  assert.match(error.message, /could not be read/)
  assert.equal(fetchImpl.calls.some((call) => call.body.action === 'dsh.start'), false)
})

check('a remembered supported image lets the same computer proceed when the live read is blank', async () => {
  const fetchImpl = fakeFetch({
    machine: machineWith(''),
    detail: detailWith(''),
  })
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
    stateRoot: setup(),
    rememberedImage: 'deepseek-harness@1',
    rememberedComputer: 'rayrun-bot',
  })
  assert.equal(started.image, 'deepseek-harness@1')
  assert.equal(fetchImpl.calls.some((call) => call.body.action === 'dsh.start'), true)
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
    assert.equal(error.code, ERROR_CODES.workerNoReply)
    assert.match(error.message, /reply\.md/)
    assert.match(error.message, /MISSING_CREDENTIAL/)
    assert.match(error.message, /DeepSeek credential/)
    assert.doesNotMatch(error.message, /use an image such as/)
    return true
  })
})

check('a missing reply names the image recorded on the task', async () => {
  const stateRoot = setup()
  const runtime = createRayrunDetachedRuntime({
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl: fakeFetch(),
  })
  const started = await runtime.start({
    bot: { id: 'echo', name: 'Echo', label: 'Echoes', instructions: 'Reply briefly.' },
    text: 'hello',
    history: [],
    messageSeq: 1,
    botId: 'echo',
    stateRoot,
  })
  await assert.rejects(runtime.collect({ detached: { ...started, image: 'custom-image@1' } }), (error) => {
    assert.equal(error.code, ERROR_CODES.workerNoReply)
    assert.match(error.message, /custom-image@1/)
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
