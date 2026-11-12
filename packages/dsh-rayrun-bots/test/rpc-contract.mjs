/**
 * Contract checks for the Rayrun Bot RPC surface.
 *
 * Drives the real `/plugins/rayrun-bots` handler with a fake Harness context, so
 * the route shape, response envelope, body cap and origin gate are tested where
 * they actually run — not on a copy of the logic.
 *
 *   node test/rpc-contract.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

const NAME = 'rayrun-bots'
const ROUTE = '/plugins/rayrun-bots'
const MAX_BODY = 64 * 1024
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

/** Mount the host half on a fake context and return the registered route. */
function hostFor({ origin = 'http://127.0.0.1:59999' } = {}) {
  const routes = []
  const child = {
    effect(fn) {
      fn()
      return () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
      getOrigin: () => origin,
    },
  }
  const ctx = {
    logger: { info() {} },
    inject(deps, callback) {
      if (Array.isArray(deps) && deps.includes('webServer')) callback(child)
      return () => {}
    },
  }
  apply(ctx)
  assert.equal(routes.length, 1, 'the host route is registered once')
  return { handler: routes[0].handler, route: routes[0] }
}

/** Call the handler and capture status, headers and body. */
async function request(handler, { method = 'POST', action, body, path = ROUTE, headers = {} } = {}) {
  const text = body ?? (method === 'GET' ? '' : JSON.stringify(action === undefined ? {} : { action }))
  const req = Readable.from(text === '' ? [] : [Buffer.from(text)])
  req.method = method
  req.url = method === 'GET' ? `${path}?action=${encodeURIComponent(action ?? 'health')}` : path
  req.headers = headers
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, responseHeaders) {
      this.status = status
      this.headers = responseHeaders ?? {}
    },
    end(chunk) {
      this.body = String(chunk ?? '')
    },
  }
  await handler(req, res)
  let json = null
  try {
    json = JSON.parse(res.body)
  } catch {
    json = null
  }
  return { status: res.status, headers: res.headers, text: res.body, json }
}

const checks = []
const check = (name, fn) => checks.push({ name, fn })

check('the host route is a prefix registration on the plugin path', () => {
  const { route } = hostFor()
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, ROUTE)
})

check('GET health reports the loaded bundle, uncached and without secrets', async () => {
  const reply = await request(hostFor().handler, { method: 'GET', action: 'health' })
  assert.equal(reply.status, 200)
  assert.match(reply.headers['Content-Type'], /^application\/json/)
  assert.equal(reply.headers['Cache-Control'], 'no-store')
  assert.deepEqual(reply.json, { ok: true, plugin: NAME, version: VERSION, ready: false })
  assert.doesNotMatch(reply.text, /Bearer\s|RAYRUN_TOKEN|sk-[A-Za-z0-9]{16,}/)
})

check('POST health answers the same envelope', async () => {
  const reply = await request(hostFor().handler, { action: 'health' })
  assert.equal(reply.status, 200)
  assert.deepEqual(reply.json, { ok: true, plugin: NAME, version: VERSION, ready: false })
})

check('unknown actions are refused on GET and POST', async () => {
  const get = await request(hostFor().handler, { method: 'GET', action: 'shell.exec' })
  assert.equal(get.status, 404)
  assert.equal(get.json.ok, false)
  assert.equal(get.json.error.code, 'E_INTERNAL')
  const post = await request(hostFor().handler, { action: 'shell.exec' })
  assert.equal(post.status, 404)
  assert.equal(post.json.error.code, 'E_INTERNAL')
})

check('a method other than GET or POST is refused', async () => {
  const reply = await request(hostFor().handler, { method: 'DELETE' })
  assert.equal(reply.status, 405)
  assert.equal(reply.json.error.code, 'E_INTERNAL')
})

check('a path outside the plugin route is refused', async () => {
  const reply = await request(hostFor().handler, { method: 'GET', action: 'health', path: '/plugins/rayrun-other' })
  assert.equal(reply.status, 404)
  assert.match(reply.json.error.message, /Unknown Rayrun Bot route/)
})

check('a malformed JSON body is refused', async () => {
  const reply = await request(hostFor().handler, { body: '{oops' })
  assert.equal(reply.status, 400)
  assert.match(reply.json.error.message, /not valid JSON/)
})

check(`a body over the ${MAX_BODY / 1024} KB cap is refused before parsing`, async () => {
  const reply = await request(hostFor().handler, {
    body: JSON.stringify({ action: 'health', pad: 'x'.repeat(MAX_BODY) }),
  })
  assert.equal(reply.status, 413)
  assert.match(reply.json.error.message, /too large/)
})

check('a cross-origin POST is refused', async () => {
  const reply = await request(hostFor().handler, {
    action: 'health',
    headers: { origin: 'http://evil.example', host: '127.0.0.1:53109' },
  })
  assert.equal(reply.status, 403)
  assert.equal(reply.json.ok, false)
  assert.equal(reply.json.error.code, 'E_INTERNAL')
  assert.match(reply.json.error.message, /Cross-origin/)
})

check('a same-origin POST is accepted', async () => {
  const reply = await request(hostFor().handler, {
    action: 'health',
    headers: { origin: 'http://127.0.0.1:53109', host: '127.0.0.1:53109' },
  })
  assert.equal(reply.status, 200)
  assert.equal(reply.json.ok, true)
})

check('a hand-made POST without an Origin header is accepted', async () => {
  const reply = await request(hostFor().handler, { action: 'health' })
  assert.equal(reply.status, 200)
})

check('without a Host header the Origin is compared with the bind origin', async () => {
  const sameOriginReply = await request(hostFor({ origin: 'http://127.0.0.1:59999' }).handler, {
    action: 'health',
    headers: { origin: 'http://127.0.0.1:59999' },
  })
  assert.equal(sameOriginReply.status, 200)
  const crossOriginReply = await request(hostFor({ origin: 'http://127.0.0.1:59999' }).handler, {
    action: 'health',
    headers: { origin: 'http://evil.example' },
  })
  assert.equal(crossOriginReply.status, 403)
})

check('the error envelope keeps its shape', async () => {
  const reply = await request(hostFor().handler, { action: 'shell.exec' })
  assert.deepEqual(Object.keys(reply.json).sort(), ['error', 'ok'])
  assert.deepEqual(Object.keys(reply.json.error).sort(), ['code', 'message', 'status'])
  assert.equal(typeof reply.json.error.code, 'string')
  assert.equal(typeof reply.json.error.message, 'string')
})

check('no reply carries a credential shape', async () => {
  const { handler } = hostFor()
  const replies = [
    await request(handler, { method: 'GET', action: 'health' }),
    await request(handler, { action: 'health' }),
    await request(handler, { method: 'GET', action: 'nope' }),
    await request(handler, { action: 'nope' }),
  ]
  for (const reply of replies) {
    assert.doesNotMatch(reply.text, /Bearer\s|RAYRUN_TOKEN|sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]/i)
  }
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
console.log(`${checks.length - failed}/${checks.length} checks passed`)
if (failed) process.exitCode = 1
