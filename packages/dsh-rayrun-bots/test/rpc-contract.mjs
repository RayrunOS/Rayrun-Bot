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
import { openApprovalStore } from '../lib/approvals.js'
import { openBotStore } from '../lib/bots.js'
import { openSessionStore } from '../lib/sessions.js'

const NAME = 'rayrun-bots'
const ROUTE = '/plugins/rayrun-bots'
const MAX_BODY = 64 * 1024
const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const DEPENDENCY_UNKNOWN = { name: 'dsh-rayrun-computer', required: '>=1.0.0 <2.0.0', version: null, status: 'unknown', code: null }
const RUNTIME_UNAVAILABLE = { name: 'rayrun-agent', available: false }

/** Mount the host half on a fake context and return the registered route. */
function hostFor({ origin = 'http://127.0.0.1:59999', profileDir, runtime, tools, options = {} } = {}) {
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
  apply(ctx, { runtime, ...options })
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

check('health selects the detached runtime for dependency 1.1.0', async () => {
  const profileDir = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-detached-profile-'))
  const packageDir = path.join(profileDir, 'node_modules', 'dsh-rayrun-computer')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'dsh-rayrun-computer', version: '1.1.0' }))
  try {
    const reply = await request(hostFor({ profileDir }).handler, { method: 'GET', action: 'health' })
    assert.equal(reply.status, 200)
    assert.deepEqual(reply.json.runtime, { name: 'rayrun-detached', available: true })
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
})

check('health selects the cloud host by default for dependency 1.2.0', async () => {
  const profileDir = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-cloud-profile-'))
  const packageDir = path.join(profileDir, 'node_modules', 'dsh-rayrun-computer')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'dsh-rayrun-computer', version: '1.2.0' }))
  try {
    const tools = { get: (name) => (name === 'rayrun_files' ? { execute() {} } : undefined) }
    const reply = await request(hostFor({ profileDir, tools }).handler, { method: 'GET', action: 'health' })
    assert.equal(reply.status, 200)
    assert.deepEqual(reply.json.runtime, { name: 'rayrun-cloud-host', available: true })
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
})

check('cloudHost: false keeps the detached runtime on dependency 1.2.0', async () => {
  const profileDir = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-detached-profile-'))
  const packageDir = path.join(profileDir, 'node_modules', 'dsh-rayrun-computer')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'dsh-rayrun-computer', version: '1.2.0' }))
  try {
    const reply = await request(
      hostFor({ profileDir, options: { cloudHost: false } }).handler,
      { method: 'GET', action: 'health' },
    )
    assert.equal(reply.status, 200)
    assert.deepEqual(reply.json.runtime, { name: 'rayrun-detached', available: true })
  } finally {
    rmSync(profileDir, { recursive: true, force: true })
  }
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

check('update.check reads npm dist-tags through the host and is same-origin gated', async () => {
  const originalFetch = globalThis.fetch
  let seen
  globalThis.fetch = async (url, options) => {
    seen = { url, options }
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify({ alpha: '99.0.0-alpha.1', latest: '99.0.0' }) },
    }
  }
  try {
    const reply = await request(hostFor().handler, { action: 'update.check' })
    assert.equal(reply.status, 200)
    assert.equal(reply.json.ok, true)
    assert.equal(reply.json.updateAvailable, true)
    assert.equal(reply.json.latest, '99.0.0-alpha.1')
    assert.match(reply.json.command, /dsh-rayrun-bots@99\.0\.0-alpha\.1/)
    assert.equal(seen.url, 'https://registry.npmjs.org/-/package/dsh-rayrun-bots/dist-tags')
    assert.equal(seen.options.headers.authorization, undefined)
    const cross = await request(hostFor({ origin: 'http://127.0.0.1:59999' }).handler, {
      action: 'update.check',
      headers: { origin: 'http://evil.example' },
    })
    assert.equal(cross.status, 403)
  } finally {
    globalThis.fetch = originalFetch
  }
})

check('computer.update fails closed without explicit confirmation', async () => {
  const reply = await request(hostFor().handler, {
    body: JSON.stringify({
      action: 'computer.update',
      machine: 'box',
    }),
  })
  assert.equal(reply.status, 409)
  assert.equal(reply.json.ok, false)
  assert.equal(reply.json.error.code, 'E_COMPUTER_UPDATE')
  assert.match(reply.json.error.message, /explicit confirmation/)
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
  assert.deepEqual(empty.json, { ok: true, bots: [], routines: {}, computers: {} })

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

check('routines are per-bot, host-owned and validated', () => withState(async () => {
  const { handler } = hostFor()
  const created = await request(handler, post('bots.create', {
    name: 'Routine Bot', label: 'Runs routines', instructions: 'Follow routines.',
  }))
  const botId = created.json.bot.id

  const empty = await request(handler, post('routines.list', { botId }))
  assert.equal(empty.status, 200)
  assert.deepEqual(empty.json, { ok: true, routines: [] })

  const made = await request(handler, post('routines.create', {
    botId,
    title: 'Morning inbox',
    prompt: 'Summarize the inbox.',
    everyMinutes: 15,
  }))
  assert.equal(made.status, 200)
  assert.equal(made.json.routine.title, 'Morning inbox')
  assert.equal(made.json.routine.enabled, true)
  assert.equal(made.json.routines.length, 1)
  assert.equal(made.json.routine.nextAt > made.json.routine.createdAt, true)
  assert.equal(
    JSON.parse(readFileSync(path.join(
      process.env.DSH_HOME, 'state', 'rayrun-bot', 'bots', botId, 'routines.json',
    ), 'utf8')).routines.length,
    1,
  )

  const roster = await request(handler, { action: 'bots.list' })
  assert.equal(roster.status, 200)
  assert.deepEqual(roster.json.routines[botId], made.json.routines)
  const fetched = await request(handler, post('bots.get', { id: botId }))
  assert.deepEqual(fetched.json.routines, made.json.routines)

  const paused = await request(handler, post('routines.update', {
    botId, id: made.json.routine.id, patch: { enabled: false },
  }))
  assert.equal(paused.status, 200)
  assert.equal(paused.json.routine.enabled, false)
  const resumed = await request(handler, post('routines.update', {
    botId, id: made.json.routine.id, patch: { enabled: true },
  }))
  assert.equal(resumed.status, 200)
  assert.equal(resumed.json.routine.enabled, true)

  const invalid = await request(handler, post('routines.create', {
    botId, title: 'Bad', prompt: 'Bad.', everyMinutes: 0,
  }))
  assert.equal(invalid.status, 400)
  assert.equal(invalid.json.error.code, 'E_ROUTINE_INVALID')
  const hostField = await request(handler, post('routines.update', {
    botId, id: made.json.routine.id, patch: { nextAt: '2026-11-24T10:00:00.000Z' },
  }))
  assert.equal(hostField.status, 400)
  assert.equal(hostField.json.error.code, 'E_ROUTINE_INVALID')
  const unknown = await request(handler, post('routines.update', {
    botId, id: 'routine-missing', patch: { title: 'Nope' },
  }))
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.error.code, 'E_ROUTINE_UNKNOWN')

  const synced = await request(handler, post('routines.sync', { botId }))
  assert.equal(synced.status, 200)
  assert.deepEqual(synced.json, {
    ok: true, uploaded: false, imported: 0, skipped: 'cloud_host_disabled',
  })

  const removed = await request(handler, post('routines.remove', { botId, id: made.json.routine.id }))
  assert.equal(removed.status, 200)
  assert.deepEqual(removed.json.routines, [])
  const missingBot = await request(handler, post('routines.list', { botId: 'missing' }))
  assert.equal(missingBot.status, 404)
  assert.equal(missingBot.json.error.code, 'E_BOT_UNKNOWN')
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

check('session.send returns only after a detached task is attached', () => withState(async (home) => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const runtime = {
    contract: 1,
    name: 'fake-detached',
    available: true,
    detached: true,
    async start() {
      await gate
      return {
        taskId: 'task-http',
        sandbox: 'box',
        localDir: path.join(home, 'bots', 'http-acceptance', 'workspace'),
        timeoutSeconds: 900,
      }
    },
    async status() { return { running: false } },
    async collect() { return { text: 'accepted' } },
  }
  const { handler } = hostFor({ runtime })
  const created = await request(handler, post('bots.create', {
    name: 'HTTP Acceptance', label: 'Acceptance', instructions: 'Reply.',
  }))
  const botId = created.json.bot.id
  let settled = false
  const pending = request(handler, post('session.send', { botId, text: 'hello' })).then((value) => {
    settled = true
    return value
  })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(settled, false, 'session.send responded before the cloud task attached')
  release()
  const sent = await pending
  assert.equal(sent.status, 200)
  assert.equal(sent.json.session.detached.taskId, 'task-http')
  assert.equal(sent.json.message.text, 'hello')
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

  const tail = await request(handler, post('session.history', { botId, tail: true, limit: 1 }))
  assert.equal(tail.status, 200)
  assert.deepEqual(tail.json.messages.map((message) => message.text), ['echo:hello'])
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

check('resumes a persisted detached task without a page RPC', () => withState(async (home) => {
  const stateRoot = path.join(home, 'state', 'rayrun-bot')
  const bot = openBotStore(stateRoot).create({ id: 'auto-recover', name: 'Auto Recover', label: 'Recovery' })
  const store = openSessionStore(stateRoot)
  store.enqueue(bot.id, 'hello')
  store.shift(bot.id)
  store.attach(bot.id, {
    taskId: 'task-recover',
    sandbox: 'box',
    localDir: path.join(stateRoot, 'bots', bot.id, 'workspace'),
    timeoutSeconds: 900,
  })
  let collected = false
  const runtime = {
    contract: 1,
    name: 'fake-detached-recovery',
    available: true,
    detached: true,
    async start() { throw new Error('start must not be called during recovery') },
    async status() { return { running: false } },
    async collect() {
      collected = true
      return { text: 'recovered' }
    },
  }
  const { handler } = hostFor({ runtime })
  for (let attempt = 0; attempt < 40 && store.status(bot.id).state !== 'idle'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(collected, true, 'recovery did not start from the host mount')
  assert.equal(store.status(bot.id).state, 'idle')
  assert.deepEqual(
    store.history(bot.id).messages.map((message) => message.text),
    ['hello', 'recovered'],
  )
  const roster = await request(handler, { action: 'bots.list' })
  assert.equal(roster.json.computers[bot.id], 'box')
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

check('approvals RPC lists, gets and refuses an unsupported local action', () => withState(async (home) => {
  const { handler } = hostFor()
  const created = await request(handler, post('bots.create', {
    name: 'Approval Bot', label: 'Needs approvals', instructions: 'Ask first.',
  }))
  const botId = created.json.bot.id
  const root = path.join(home, 'state', 'rayrun-bot')
  const store = openApprovalStore(root)
  const pending = store.createRequest({
    botId,
    actionId: 'act-1',
    action: { kind: 'send-message', target: '#weekly', text: 'hello' },
    risk: ['outside', 'irreversible'],
    origin: 'chat',
  })

  const listed = await request(handler, post('approvals.list', { botId }))
  assert.equal(listed.status, 200)
  assert.equal(listed.json.approvals.length, 1)
  assert.equal(listed.json.approvals[0].state, 'pending')
  assert.equal(Object.hasOwn(listed.json.approvals[0], 'nonce'), false)
  assert.equal(Object.hasOwn(listed.json.approvals[0], 'actionHash'), false)

  const got = await request(handler, post('approvals.get', { botId, id: pending.id }))
  assert.equal(got.status, 200)
  assert.equal(got.json.approval.id, pending.id)

  const cross = await request(handler, post('approvals.decide', {
    botId, id: pending.id, decision: 'approve',
  }, { origin: 'http://evil.example', host: '127.0.0.1:53109' }))
  assert.equal(cross.status, 403)
  const still = await request(handler, post('approvals.get', { botId, id: pending.id }))
  assert.equal(still.json.approval.state, 'pending')

  const decided = await request(handler, post('approvals.decide', { botId, id: pending.id, decision: 'approve' }))
  assert.equal(decided.status, 200)
  assert.equal(decided.json.approval.state, 'approved')
  assert.equal(decided.json.execution.available, true)
  assert.equal(decided.json.execution.mode, 'local')
  assert.equal(decided.json.execution.state, 'refused')
  assert.equal(decided.json.execution.code, 'E_APPROVAL_UNSUPPORTED')
  assert.equal(decided.json.idempotent, false)

  const again = await request(handler, post('approvals.decide', { botId, id: pending.id, decision: 'approve' }))
  assert.equal(again.status, 200)
  assert.equal(again.json.idempotent, true)

  const replay = await request(handler, post('approvals.decide', { botId, id: pending.id, decision: 'deny' }))
  assert.equal(replay.status, 409)
  assert.equal(replay.json.error.code, 'E_APPROVAL_REPLAY')

  const unknown = await request(handler, post('approvals.get', { botId, id: 'missing' }))
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.error.code, 'E_APPROVAL_UNKNOWN')

  const unknownBot = await request(handler, post('approvals.list', { botId: 'missing' }))
  assert.equal(unknownBot.status, 404)
  assert.equal(unknownBot.json.error.code, 'E_BOT_UNKNOWN')

  const expired = store.createRequest({
    botId,
    actionId: 'act-2',
    action: { kind: 'publish', target: '#weekly' },
    risk: ['outside'],
    origin: 'background',
  }, { now: Date.now() - 31 * 60 * 1000 })
  const expiredReply = await request(handler, post('approvals.decide', { botId, id: expired.id, decision: 'approve' }))
  assert.equal(expiredReply.status, 410)
  assert.equal(expiredReply.json.error.code, 'E_APPROVAL_EXPIRED')

  const invalid = await request(handler, post('approvals.decide', { botId, id: pending.id, decision: 'maybe' }))
  assert.equal(invalid.status, 400)
  assert.equal(invalid.json.error.code, 'E_APPROVAL_INVALID')

  const audit = readFileSync(path.join(root, 'logs', 'audit.log'), 'utf8')
  assert.doesNotMatch(audit, /send-message|#weekly|publish/)
  for (const reply of [listed, got, decided, again]) {
    assert.doesNotMatch(reply.text, /Bearer\s|RAYRUN_TOKEN|sk-[A-Za-z0-9]{16,}|api[_-]?key\s*[:=]/i)
  }
}))

check('approvals.sync fails closed when the cloudHost bridge is not enabled', () => withState(async () => {
  const { handler } = hostFor()
  const created = await request(handler, post('bots.create', {
    name: 'No Bridge Bot', label: 'No cloud host', instructions: 'Ask first.',
  }))
  const botId = created.json.bot.id
  const synced = await request(handler, post('approvals.sync', { botId }))
  assert.equal(synced.status, 503)
  assert.equal(synced.json.error.code, 'E_RUNTIME_UNAVAILABLE')
}))

check('a host proposal can approve a typed action and fails closed without Rayrun', () => withState(async () => {
  const { handler } = hostFor()
  const created = await request(handler, post('bots.create', {
    name: 'Local Action Bot', label: 'Stops a computer', instructions: 'Ask first.',
  }))
  const botId = created.json.bot.id
  const proposal = {
    botId,
    actionId: 'act-local-1',
    requestedAction: { kind: 'rayrun.machine.stop', machine: 'box' },
    origin: 'chat',
  }

  const browser = await request(handler, post('approvals.propose', proposal, {
    origin: 'http://127.0.0.1:59999',
    host: '127.0.0.1:59999',
  }))
  assert.equal(browser.status, 403)

  const proposed = await request(handler, post('approvals.propose', proposal))
  assert.equal(proposed.status, 200)
  assert.equal(proposed.json.approval.state, 'pending')
  assert.deepEqual(proposed.json.approval.risk, ['outside'])

  const decided = await request(handler, post('approvals.decide', {
    botId, id: proposed.json.approval.id, decision: 'approve',
  }))
  assert.equal(decided.status, 200)
  assert.equal(decided.json.approval.state, 'approved')
  assert.equal(decided.json.execution.available, true)
  assert.equal(decided.json.execution.state, 'failed')
  assert.equal(decided.json.execution.code, 'E_APPROVAL_EXECUTION')

  const got = await request(handler, post('approvals.get', { botId, id: proposed.json.approval.id }))
  assert.equal(got.status, 200)
  assert.equal(got.json.approval.execution.state, 'failed')
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
