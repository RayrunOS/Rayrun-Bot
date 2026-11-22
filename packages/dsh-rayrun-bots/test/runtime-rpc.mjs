/**
 * Host-side runtime.* RPC client checks.
 *
 *   node test/runtime-rpc.mjs
 */
import assert from 'node:assert/strict'
import { ERROR_CODES } from '../lib/errors.js'
import { createRuntimeRpc, ensureRuntime } from '../lib/runtime-rpc.js'

const checks = []
const check = (name, fn) => checks.push({ name, fn })

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fakeRpc(handler = (body) => response({ ok: true, action: body.action })) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url: String(url), headers: init.headers, body })
    return handler(body, init)
  }
  return { rpc: createRuntimeRpc({ getOrigin: () => 'http://127.0.0.1:8080', fetchImpl }), calls }
}

check('put/list/get/start/stop/restart/delete use the dependency actions', async () => {
  const { rpc, calls } = fakeRpc()
  const spec = { argv: ['node', '/workspace/.rayrun/bin/host.mjs'], keep_alive: true }
  await rpc.put('box', 'bot-host', spec)
  await rpc.list('box')
  await rpc.get('box', 'bot-host')
  await rpc.start('box', 'bot-host')
  await rpc.stop('box', 'bot-host')
  await rpc.restart('box', 'bot-host')
  await rpc.delete('box', 'bot-host')

  assert.deepEqual(calls.map((call) => call.body.action), [
    'runtime.put', 'runtime.list', 'runtime.get', 'runtime.start',
    'runtime.stop', 'runtime.restart', 'runtime.delete',
  ])
  assert.deepEqual(calls[0].body, { action: 'runtime.put', sandbox: 'box', name: 'bot-host', spec })
  assert.deepEqual(calls[1].body, { action: 'runtime.list', sandbox: 'box' })
  for (const call of calls.slice(2)) {
    assert.equal(call.body.sandbox, 'box')
    assert.equal(call.body.name, 'bot-host')
  }
  assert.equal(calls[0].url, 'http://127.0.0.1:8080/plugins/rayrun/rpc')
})

check('the client never sends an Authorization header or a token field', async () => {
  const { rpc, calls } = fakeRpc()
  await rpc.put('box', 'bot-host', { argv: ['node', 'host.mjs'] })
  const headers = Object.fromEntries(
    Object.entries(calls[0].headers).map(([key, value]) => [key.toLowerCase(), value]),
  )
  assert.equal(Object.hasOwn(headers, 'authorization'), false)
  assert.equal(Object.hasOwn(calls[0].body, 'token'), false)
  assert.equal(JSON.stringify(calls[0].body).includes('RAYRUN_TOKEN'), false)
})

check('ensureRuntime creates only when absent', async () => {
  const calls = []
  const spec = { argv: ['node', 'host.mjs'] }
  const missing = {
    async get() {
      calls.push('get')
      return { ok: true, runtime: null }
    },
    async put(sandbox, name, value) {
      calls.push('put')
      assert.deepEqual({ sandbox, name, value }, { sandbox: 'box', name: 'bot-host', value: spec })
      return { ok: true, runtime: { name: 'bot-host' } }
    },
  }
  const created = await ensureRuntime(missing, { sandbox: 'box', name: 'bot-host', spec })
  assert.equal(created.created, true)
  assert.deepEqual(calls, ['get', 'put'])

  calls.length = 0
  const present = {
    async get() {
      calls.push('get')
      return { ok: true, runtime: { name: 'bot-host', state: 'running' } }
    },
    async put() {
      calls.push('put')
      throw new Error('must not put an existing runtime')
    },
  }
  const existing = await ensureRuntime(present, { sandbox: 'box', name: 'bot-host', spec })
  assert.equal(existing.created, false)
  assert.equal(existing.runtime.state, 'running')
  assert.deepEqual(calls, ['get'])
})

check('runtime errors map to stable host codes', async () => {
  const cases = [
    ['guestd_outdated', ERROR_CODES.guestdOutdated, 409],
    ['invalid_runtime_spec', ERROR_CODES.runtimeInvalid, 400],
    ['invalid_runtime_name', ERROR_CODES.runtimeInvalid, 400],
    ['runtime_not_found', ERROR_CODES.runtimeNotFound, 404],
    ['runtimes_unavailable', ERROR_CODES.runtimesUnavailable, 404],
    ['sandbox_paused', ERROR_CODES.machinePaused, 503],
    ['sandbox_not_running', ERROR_CODES.machineStopped, 409],
  ]
  for (const [code, expected, status] of cases) {
    const { rpc } = fakeRpc((body) => response({
      ok: false,
      error: { code, message: `dependency ${code}`, status },
    }, status))
    await assert.rejects(rpc.get('box', 'bot-host'), (error) => {
      assert.equal(error.code, expected, `${code} should map to ${expected}`)
      return true
    })
  }
})

check('a missing DSH origin fails closed as runtime unavailable', async () => {
  const rpc = createRuntimeRpc({ getOrigin: () => undefined })
  await assert.rejects(rpc.list('box'), (error) => {
    assert.equal(error.code, ERROR_CODES.runtimeUnavailable)
    return true
  })
})

let passed = 0
let failed = 0
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
console.log(`${passed}/${checks.length} runtime RPC checks passed`)
if (failed > 0) process.exit(1)
