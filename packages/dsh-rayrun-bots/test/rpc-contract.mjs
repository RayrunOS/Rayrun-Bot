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
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

const NAME = 'rayrun-bots'
const ROUTE = '/plugins/rayrun-bots'
const MAX_BODY = 64 * 1024
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const DEPENDENCY_UNKNOWN = { name: 'dsh-rayrun-computer', required: '>=1.0.0 <2.0.0', version: null, status: 'unknown', code: null }
const RUNTIME_UNAVAILABLE = { name: 'rayrun-agent', available: false }

/** Mount the host half on a fake context and return the registered route. */
function hostFor({ origin = 'http://127.0.0.1:59999', profileDir, runtime, tools } = {}) {
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
    get(name) {
      if (name === 'profileContext' && profileDir !== undefined) return { dir: profileDir }
      if (name === 'tools' && tools !== undefined) return tools
      return undefined
    },
    inject(deps, callback) {
      if (Array.isArray(deps) && deps.includes('webServer')) callback(child)
      return () => {}
    },
  }
  apply(ctx, { runtime })
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
  assert.deepEqual(reply.json, {
    ok: true,
    plugin: NAME,
    version: VERSION,
    ready: false,
    dependency: DEPENDENCY_UNKNOWN,
    runtime: RUNTIME_UNAVAILABLE,
  })
  assert.doesNotMatch(reply.text, /Bearer\s|RAYRUN_TOKEN|sk-[A-Za-z0-9]{16,}/)
})

check('POST health answers the same envelope', async () => {
  const reply = await request(hostFor().handler, { action: 'health' })
  assert.equal(reply.status, 200)
  assert.deepEqual(reply.json, {
    ok: true,
    plugin: NAME,
    version: VERSION,
    ready: false,
    dependency: DEPENDENCY_UNKNOWN,
    runtime: RUNTIME_UNAVAILABLE,
  })
})

check('health reports the runtime available when rayrun_agent is registered', async () => {
  const tools = {
    get(name) {
      return name === 'rayrun_agent' ? { execute: async () => ({ finished: true, text: 'ok' }) } : undefined
    },
  }
  const reply = await request(hostFor({ tools }).handler, { method: 'GET', action: 'health' })
  assert.equal(reply.status, 200)
  assert.deepEqual(reply.json.runtime, { name: 'rayrun-agent', available: true })
})

check('health reports a missing cloud-computer dependency', async () => {
  const profileDir = path.join(tmpdir(), `rayrun-bots-missing-${randomUUID()}`)
  const reply = await request(hostFor({ profileDir }).handler, { method: 'GET', action: 'health' })
  assert.equal(reply.status, 200)
  assert.equal(reply.json.dependency.status, 'missing')
  assert.equal(reply.json.dependency.code, 'E_DEP_MISSING')
})

check('health reports an installed 1.x cloud-computer dependency', async () => {
  const profileDir = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-profile-'))
  const packageDir = path.join(profileDir, 'node_modules', 'dsh-rayrun-computer')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'dsh-rayrun-computer', version: '1.0.0' }))
  try {
    const reply = await request(hostFor({ profileDir }).handler, { method: 'GET', action: 'health' })
    assert.equal(reply.status, 200)
    assert.equal(reply.json.dependency.status, 'ok')
    assert.equal(reply.json.dependency.version, '1.0.0')
    assert.equal(reply.json.dependency.code, null)
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
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

/** Run one roster check against an isolated DSH home. */
async function withState(fn) {
  const home = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-state-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await fn(home)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    rmSync(home, { recursive: true, force: true })
  }
}

function post(action, payload, headers = {}) {
  return { action, body: JSON.stringify({ action, ...payload }), headers }
}

const FAKE_RUNTIME = {
  contract: 1,
  name: 'fake',
  available: true,
  async run({ text }) {
    return { text: `echo:${text}` }
  },
}

/** Poll the same host until the session satisfies the predicate. */
async function waitForSession(handler, botId, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const reply = await request(handler, post('session.history', { botId }))
    assert.equal(reply.status, 200)
    if (predicate(reply.json)) return reply
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`session ${botId} did not settle`)
}

check('the roster starts empty, persists a created bot, and lists it after a reload', () => withState(async (home) => {
  const { handler } = hostFor()
  const empty = await request(handler, { action: 'bots.list' })
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json, { ok: true, bots: [] })

  const created = await request(handler, post('bots.create', {
    name: 'Weekly Watch',
    label: 'Watches the weekly numbers',
    instructions: 'You are Weekly Watch.',
  }))
  assert.equal(created.status, 200)
  assert.equal(created.json.ok, true)
  assert.equal(created.json.bot.id, 'weekly-watch')
  assert.equal(created.json.bot.revision, 1)
  assert.equal(
    JSON.parse(readFileSync(path.join(home, 'state', 'rayrun-bot', 'bots', 'weekly-watch', 'bot.json'), 'utf8')).name,
    'Weekly Watch',
  )

  const roster = await request(hostFor().handler, { action: 'bots.list' })
  assert.equal(roster.status, 200)
  assert.deepEqual(roster.json.bots, [created.json.bot])

  const fetched = await request(hostFor().handler, post('bots.get', { id: 'weekly-watch' }))
  assert.equal(fetched.status, 200)
  assert.deepEqual(fetched.json.bot, created.json.bot)

  const updated = await request(hostFor().handler, post('bots.update', {
    id: 'weekly-watch',
    patch: { label: 'Watches and reports' },
  }))
  assert.equal(updated.status, 200)
  assert.equal(updated.json.bot.label, 'Watches and reports')
  assert.equal(updated.json.bot.revision, 2)

  const deleted = await request(hostFor().handler, post('bots.delete', { id: 'weekly-watch' }))
  assert.equal(deleted.status, 200)
  assert.deepEqual(deleted.json, { ok: true, deleted: 'weekly-watch' })
  assert.deepEqual((await request(hostFor().handler, { action: 'bots.list' })).json.bots, [])
}))

check('roster errors carry stable codes and statuses', () => withState(async () => {
  const { handler } = hostFor()
  const invalid = await request(handler, post('bots.create', { name: '', label: 'x' }))
  assert.equal(invalid.status, 400)
  assert.equal(invalid.json.error.code, 'E_BOT_INVALID')

  const unknown = await request(handler, post('bots.get', { id: 'missing' }))
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.error.code, 'E_BOT_UNKNOWN')

  const created = await request(handler, post('bots.create', {
    id: 'weekly', name: 'Weekly Watch', label: 'Watches', instructions: 'Watch.',
  }))
  assert.equal(created.status, 200)
  const duplicate = await request(handler, post('bots.create', {
    id: 'weekly', name: 'Other', label: 'Other.', instructions: 'Other.',
  }))
  assert.equal(duplicate.status, 409)
  assert.equal(duplicate.json.error.code, 'E_BOT_EXISTS')

  const traversal = await request(handler, post('bots.get', { id: '../etc/passwd' }))
  assert.equal(traversal.status, 400)
  assert.equal(traversal.json.error.code, 'E_BOT_INVALID')
}))

check('a cross-origin roster write is refused before it touches state', () => withState(async (home) => {
  const { handler } = hostFor()
  const reply = await request(handler, post('bots.create', {
    name: 'Weekly Watch', label: 'Watches', instructions: 'Watch.',
  }, { origin: 'http://evil.example', host: '127.0.0.1:53109' }))
  assert.equal(reply.status, 403)
  assert.equal(reply.json.error.code, 'E_INTERNAL')
  assert.equal(existsSync(path.join(home, 'state', 'rayrun-bot', 'bots')), false)
}))

check('roster replies expose no credential shape', () => withState(async () => {
  const { handler } = hostFor()
  const created = await request(handler, post('bots.create', {
    name: 'Weekly Watch', label: 'Watches', instructions: 'Watch.',
  }))
  const replies = [
    created,
    await request(handler, { action: 'bots.list' }),
    await request(handler, post('bots.get', { id: 'weekly-watch' })),
  ]
  for (const reply of replies) {
    assert.doesNotMatch(reply.text, /Bearer\s|RAYRUN_TOKEN|sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]/i)
  }
}))

check('session.send fails closed without a wired runtime and writes no session', () => withState(async (home) => {
  const { handler } = hostFor()
  const created = await request(handler, post('bots.create', {
    name: 'Echo Bot', label: 'Echoes', instructions: 'Echo.',
  }))
  const botId = created.json.bot.id
  const reply = await request(handler, post('session.send', { botId, text: 'hello' }))
  assert.equal(reply.status, 503)
  assert.equal(reply.json.error.code, 'E_RUNTIME_UNAVAILABLE')
  assert.equal(existsSync(path.join(home, 'state', 'rayrun-bot', 'bots', botId, 'session.json')), false)
}))

check('session.send queues a turn and history returns the fake reply', () => withState(async () => {
  const { handler } = hostFor({ runtime: FAKE_RUNTIME })
  const created = await request(handler, post('bots.create', {
    name: 'Echo Bot', label: 'Echoes', instructions: 'Echo.',
  }))
  const botId = created.json.bot.id

  const sent = await request(handler, post('session.send', { botId, text: 'hello' }))
  assert.equal(sent.status, 200)
  assert.equal(sent.json.ok, true)
  assert.equal(sent.json.message.role, 'user')
  assert.equal(sent.json.message.text, 'hello')
  assert.ok(['queued', 'running'].includes(sent.json.session.state))

  const settled = await waitForSession(
    handler,
    botId,
    (json) => json.session?.state === 'idle' && json.messages.length === 2,
  )
  assert.deepEqual(
    settled.json.messages.map((message) => [message.role, message.text]),
    [['user', 'hello'], ['bot', 'echo:hello']],
  )

  const status = await request(handler, post('session.status', { botId }))
  assert.equal(status.status, 200)
  assert.equal(status.json.session.state, 'idle')

  const cursor = await request(handler, post('session.history', { botId, after: sent.json.message.seq }))
  assert.equal(cursor.status, 200)
  assert.deepEqual(cursor.json.messages.map((message) => message.text), ['echo:hello'])
}))

check('session errors carry stable codes and a cross-origin send writes nothing', () => withState(async () => {
  const { handler } = hostFor({ runtime: FAKE_RUNTIME })
  const unknown = await request(handler, post('session.send', { botId: 'missing', text: 'x' }))
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.error.code, 'E_BOT_UNKNOWN')

  const created = await request(handler, post('bots.create', {
    name: 'Echo Bot', label: 'Echoes', instructions: 'Echo.',
  }))
  const botId = created.json.bot.id
  const empty = await request(handler, post('session.send', { botId, text: '   ' }))
  assert.equal(empty.status, 400)
  assert.equal(empty.json.error.code, 'E_SESSION_INVALID')

  const cross = await request(handler, post('session.send', { botId, text: 'hello' }, {
    origin: 'http://evil.example', host: '127.0.0.1:53109',
  }))
  assert.equal(cross.status, 403)

  const history = await request(handler, post('session.history', { botId }))
  assert.equal(history.status, 200)
  assert.equal(history.json.session, null)
  assert.deepEqual(history.json.messages, [])
}))

check('an unknown session action is refused before any state is touched', () => withState(async (home) => {
  const reply = await request(hostFor().handler, { action: 'session.foo' })
  assert.equal(reply.status, 404)
  assert.match(reply.json.error.message, /Unknown action/)
  assert.equal(existsSync(path.join(home, 'state', 'rayrun-bot')), false)
}))

check('session replies expose no credential shape', () => withState(async () => {
  const { handler } = hostFor({ runtime: FAKE_RUNTIME })
  const created = await request(handler, post('bots.create', {
    name: 'Echo Bot', label: 'Echoes', instructions: 'Echo.',
  }))
  const botId = created.json.bot.id
  const sent = await request(handler, post('session.send', { botId, text: 'hello' }))
  const settled = await waitForSession(handler, botId, (json) => json.session?.state === 'idle')
  const status = await request(handler, post('session.status', { botId }))
  for (const reply of [sent, settled, status]) {
    assert.doesNotMatch(reply.text, /Bearer\s|RAYRUN_TOKEN|sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]/i)
  }
}))

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
