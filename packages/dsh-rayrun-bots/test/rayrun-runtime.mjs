/**
 * Rayrun `rayrun_agent` runtime adapter checks.
 *
 *   node test/rayrun-runtime.mjs
 */
import assert from 'node:assert/strict'
import { ERROR_CODES } from '../lib/errors.js'
import { buildPrompt, createRayrunAgentRuntime } from '../lib/rayrun-runtime.js'

const errors = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })

const BOT = {
  id: 'weekly-watch',
  name: 'Weekly Watch',
  label: 'Watches the weekly numbers',
  instructions: 'Stay factual and brief. Ask before anything leaves the computer.',
}
const HISTORY = [
  { seq: 1, at: '2026-11-22T10:00:00.000Z', role: 'user', text: 'first question' },
  { seq: 2, at: '2026-11-22T10:01:00.000Z', role: 'bot', text: 'first answer' },
  { seq: 3, at: '2026-11-22T10:02:00.000Z', role: 'user', text: 'current question' },
  { seq: 4, at: '2026-11-22T10:03:00.000Z', role: 'user', text: 'later queued question' },
]
const OVERVIEW = {
  ok: true,
  connection: { configured: true },
  machines: [
    { id: 'machine-other', name: 'other', status: 'Stopped', remote_desktop: false },
    { id: 'machine-bot', name: 'rayrun-bot', status: 'Running', remote_desktop: true, desktop_url: 'https://desk' },
  ],
}

function toolsWith(handler, { present = true } = {}) {
  const calls = []
  return {
    calls,
    get(name) {
      if (!present || name !== 'rayrun_agent') return undefined
      return {
        name,
        async execute(args, exec) {
          calls.push({ args, hasSignal: Boolean(exec?.signal) })
          return handler(args, exec)
        },
      }
    },
  }
}

function fetchWith(body, { ok = true, status = 200 } = {}) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url: String(url), options })
    return {
      ok,
      status,
      async json() { return body },
    }
  }
  impl.calls = calls
  return impl
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

check('buildPrompt follows the bot, current turn and ordered history', () => {
  const prompt = buildPrompt({
    bot: BOT,
    text: 'current question',
    history: HISTORY,
    messageSeq: 3,
  })
  assert.match(prompt, /You are Weekly Watch, Watches the weekly numbers\./)
  assert.match(prompt, /Stay factual and brief/)
  assert.match(prompt, /User: first question/)
  assert.match(prompt, /Bot: first answer/)
  assert.match(prompt, /User: current question/)
  assert.doesNotMatch(prompt, /later queued question/)
  assert.match(prompt, /Do not send, publish, spend/)
})

check('buildPrompt bounds old history from the end', () => {
  const history = Array.from({ length: 60 }, (_, index) => ({
    seq: index + 1,
    at: '2026-11-22T10:00:00.000Z',
    role: 'user',
    text: `${index}:${'x'.repeat(1000)}`,
  }))
  const prompt = buildPrompt({ bot: BOT, text: 'latest', history, messageSeq: 61 })
  assert.match(prompt, /\[earlier messages omitted\]/)
  assert.ok(prompt.includes('\nUser: 59:'))
  assert.equal(prompt.includes('\nUser: 0:'), false)
  assert.ok(prompt.length < 30_000, `prompt is ${prompt.length} bytes`)
})

check('the adapter calls rayrun_agent with the selected existing machine', async () => {
  const tools = toolsWith(async () => ({ finished: true, text: 'current answer' }))
  const fetchImpl = fetchWith(OVERVIEW)
  const runtime = createRayrunAgentRuntime({
    getTools: () => tools,
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl,
  })
  assert.equal(runtime.available, true)
  assert.equal(runtime.name, 'rayrun-agent')

  const result = await runtime.run({
    bot: BOT,
    text: 'current question',
    history: HISTORY,
    messageSeq: 3,
    sessionId: 'session-1',
  })
  assert.deepEqual(result, { text: 'current answer' })

  assert.equal(fetchImpl.calls.length, 1)
  assert.equal(fetchImpl.calls[0].url, 'http://127.0.0.1:1234/plugins/rayrun/rpc')
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].options.body), { action: 'overview' })

  assert.equal(tools.calls.length, 1)
  assert.equal(tools.calls[0].args.sandbox, 'rayrun-bot')
  assert.equal(tools.calls[0].args.timeout_seconds, 900)
  assert.equal(tools.calls[0].hasSignal, true)
  assert.match(tools.calls[0].args.prompt, /current question/)
  assert.doesNotMatch(tools.calls[0].args.prompt, /later queued question/)
})

check('the adapter reports unavailable when the dependency tool is missing', async () => {
  const runtime = createRayrunAgentRuntime({
    getTools: () => ({ get: () => undefined }),
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl: fetchWith(OVERVIEW),
  })
  assert.equal(runtime.available, false)
  await expectCode(
    runtime.run({ bot: BOT, text: 'hello', history: [], messageSeq: 1 }),
    ERROR_CODES.runtimeUnavailable,
  )
})

check('availability follows a late tool registration', () => {
  let tool
  const runtime = createRayrunAgentRuntime({
    getTools: () => ({ get: () => tool }),
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl: fetchWith(OVERVIEW),
  })
  assert.equal(runtime.available, false)
  tool = { execute: async () => ({ finished: true, text: 'ok' }) }
  assert.equal(runtime.available, true)
})

check('the adapter refuses an unconnected Rayrun account before calling the agent', async () => {
  const tools = toolsWith(async () => ({ finished: true, text: 'never' }))
  const runtime = createRayrunAgentRuntime({
    getTools: () => tools,
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl: fetchWith({ ok: true, connection: { configured: false }, machines: [] }),
  })
  await expectCode(
    runtime.run({ bot: BOT, text: 'hello', history: [], messageSeq: 1 }),
    ERROR_CODES.tokenRequired,
  )
  assert.equal(tools.calls.length, 0)
})

check('the adapter refuses to create a machine when none exists', async () => {
  const tools = toolsWith(async () => ({ finished: true, text: 'never' }))
  const runtime = createRayrunAgentRuntime({
    getTools: () => tools,
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl: fetchWith({ ok: true, connection: { configured: true }, machines: [] }),
  })
  await expectCode(
    runtime.run({ bot: BOT, text: 'hello', history: [], messageSeq: 1 }),
    ERROR_CODES.machineStopped,
  )
  assert.equal(tools.calls.length, 0)
})

check('an unfinished agent run is refused and no partial text is returned', async () => {
  const tools = toolsWith(async () => ({ finished: false, text: 'partial' }))
  const runtime = createRayrunAgentRuntime({
    getTools: () => tools,
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl: fetchWith(OVERVIEW),
  })
  await assert.rejects(
    runtime.run({ bot: BOT, text: 'hello', history: [], messageSeq: 1 }),
    (error) => {
      assert.equal(error.code, ERROR_CODES.internal)
      assert.match(error.message, /did not finish/)
      return true
    },
  )
})

check('dependency error codes map to stable host codes', async () => {
  const tools = toolsWith(async () => {
    const error = new Error('No Rayrun token.')
    error.code = 'token_required'
    throw error
  })
  const runtime = createRayrunAgentRuntime({
    getTools: () => tools,
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl: fetchWith(OVERVIEW),
  })
  await expectCode(
    runtime.run({ bot: BOT, text: 'hello', history: [], messageSeq: 1 }),
    ERROR_CODES.tokenRequired,
  )
})

check('an overview RPC failure is mapped before calling the agent', async () => {
  const tools = toolsWith(async () => ({ finished: true, text: 'never' }))
  const runtime = createRayrunAgentRuntime({
    getTools: () => tools,
    getOrigin: () => 'http://127.0.0.1:1234',
    fetchImpl: fetchWith(
      { ok: false, error: { code: 'unauthorized', message: 'Bad token.', status: 401 } },
      { ok: false, status: 401 },
    ),
  })
  await expectCode(
    runtime.run({ bot: BOT, text: 'hello', history: [], messageSeq: 1 }),
    ERROR_CODES.tokenRequired,
  )
  assert.equal(tools.calls.length, 0)
})

let failed = 0
for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}`)
    console.log(`     ${error?.message ?? error}`)
  }
}

console.log(`${checks.length - failed}/${checks.length} rayrun runtime checks passed`)
if (failed) process.exitCode = 1
