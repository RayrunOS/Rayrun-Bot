/**
 * Workspace binding checks: bot.json shape, host RPC, stale derivation and
 * busy/refusal behavior.
 *
 *   node test/workspace-bind.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../index.js'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'
import { openSessionStore } from '../lib/sessions.js'

const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function expectCode(fn, code) {
  let caught
  try {
    fn()
  } catch (error) {
    caught = error
  }
  assert.ok(caught, `expected ${code}`)
  assert.equal(caught.code, code)
}

function hostFor(workspaceRegistry, runtime) {
  const routes = []
  const child = {
    effect(fn) { fn(); return () => {} },
    webServer: {
      register(route) { routes.push(route); return () => {} },
      getOrigin: () => 'http://127.0.0.1:59999',
    },
  }
  const ctx = {
    logger: { info() {} },
    get(name) {
      if (name === 'workspaceRegistry' && workspaceRegistry !== undefined) return workspaceRegistry
      return undefined
    },
    inject(deps, callback) {
      if (Array.isArray(deps) && deps.includes('webServer')) callback(child)
      return () => {}
    },
  }
  apply(ctx, runtime === undefined ? {} : { runtime })
  assert.equal(routes.length, 1, 'the host route is registered once')
  return routes[0].handler
}

function request(handler, payload) {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(payload)
    const req = Readable.from([Buffer.from(text)])
    req.method = 'POST'
    req.url = '/plugins/rayrun-bots'
    req.headers = {}
    const res = {
      status: 0,
      body: '',
      writeHead(status) { this.status = status },
      end(body) { this.body = body },
    }
    handler(req, res).then(() => {
      let json
      try {
        json = JSON.parse(res.body)
      } catch {
        json = { raw: res.body }
      }
      resolve({ status: res.status, json })
    }, reject)
  })
}

async function withState(fn) {
  const home = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-ws-state-'))
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

function registryOf(entries) {
  const records = new Map()
  const registry = {
    records,
    get(id) { return records.get(id) },
    add(entry) { records.set(entry.id, { status: async () => 'ok', ...entry }) },
    remove(id) { records.delete(id) },
    setStatus(id, status) { records.get(id).status = async () => status },
  }
  for (const entry of entries) registry.add(entry)
  return registry
}

check('bot.json accepts a host-validated binding and rejects raw ones', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-ws-store-'))
  roots.push(root)
  const bots = openBotStore(root)
  const binding = { id: 'ws-1', path: path.join(root, 'project'), title: 'Project' }
  const bot = bots.create({ name: 'Bound Bot', label: 'Bound', instructions: 'Work.' }, { workspace: binding })
  assert.deepEqual(bot.workspace, binding)
  assert.deepEqual(openBotStore(root).get(bot.id).workspace, binding)

  expectCode(
    () => bots.create({ name: 'Raw', label: 'Raw', instructions: 'Raw.', workspace: binding }),
    ERROR_CODES.botInvalid,
  )
  expectCode(
    () => bots.create({ name: 'Rel', label: 'Rel', instructions: 'Rel.' }, { workspace: { id: 'ws', path: 'relative', title: 'x' } }),
    ERROR_CODES.botInvalid,
  )
  expectCode(
    () => bots.create({ name: 'Title', label: 'Title', instructions: 'Title.' }, { workspace: { id: 'ws', path: path.join(root, 'p'), title: '' } }),
    ERROR_CODES.botInvalid,
  )
  expectCode(
    () => bots.create({ name: 'Extra', label: 'Extra', instructions: 'Extra.' }, { workspace: { id: 'ws', path: path.join(root, 'p'), title: 'p', extra: true } }),
    ERROR_CODES.botInvalid,
  )

  const rebound = bots.update(bot.id, {}, { workspace: { ...binding, id: 'ws-2' } })
  assert.equal(rebound.workspace.id, 'ws-2')
  const unbound = bots.update(bot.id, {}, { workspace: null })
  assert.equal(unbound.workspace, undefined)
  expectCode(() => bots.update(bot.id, { workspace: binding }), ERROR_CODES.botInvalid)
})

check('RPC binds, derives stale, rebinds and unbinds', () => withState(async (home) => {
  const project = path.join(home, 'project')
  const other = path.join(home, 'other')
  mkdirSync(project)
  mkdirSync(other)
  const registry = registryOf([{ id: 'ws-1', path: project, title: 'Project' }])
  const handler = hostFor(registry)

  const created = await request(handler, {
    action: 'bots.create', name: 'Bound Bot', label: 'Bound', instructions: 'Work.', workspaceId: 'ws-1',
  })
  assert.equal(created.status, 200)
  assert.deepEqual(created.json.bot.workspace, { id: 'ws-1', path: project, title: 'Project' })
  assert.equal(created.json.workspaceBinding, true)

  const list = await request(handler, { action: 'bots.list' })
  assert.equal(list.json.workspaceBinding, true)
  assert.equal(list.json.bots.find((bot) => bot.id === 'bound-bot').stale, false)

  const storedFile = path.join(home, 'state', 'rayrun-bot', 'bots', 'bound-bot', 'bot.json')
  assert.equal(JSON.parse(readFileSync(storedFile, 'utf8')).stale, undefined)

  registry.remove('ws-1')
  const stale = await request(handler, { action: 'bots.list' })
  assert.equal(stale.json.bots.find((bot) => bot.id === 'bound-bot').stale, true)
  assert.deepEqual(
    JSON.parse(readFileSync(storedFile, 'utf8')).workspace,
    { id: 'ws-1', path: project, title: 'Project' },
  )

  registry.add({ id: 'ws-2', path: other, title: 'Other' })
  const rebound = await request(handler, { action: 'bots.update', id: 'bound-bot', workspaceId: 'ws-2' })
  assert.equal(rebound.status, 200)
  assert.equal(rebound.json.bot.workspace.id, 'ws-2')

  const unbound = await request(handler, { action: 'bots.update', id: 'bound-bot', workspaceId: null })
  assert.equal(unbound.status, 200)
  assert.equal(unbound.json.bot.workspace, undefined)
}))

check('stale also comes from a path change or a missing directory', () => withState(async (home) => {
  const project = path.join(home, 'project')
  mkdirSync(project)
  const registry = registryOf([{ id: 'ws-1', path: project, title: 'Project' }])
  const handler = hostFor(registry)
  const created = await request(handler, {
    action: 'bots.create', name: 'Path Bot', label: 'Path', instructions: 'Work.', workspaceId: 'ws-1',
  })
  assert.equal(created.status, 200)

  registry.get('ws-1').path = path.join(home, 'moved')
  const moved = await request(handler, { action: 'bots.list' })
  assert.equal(moved.json.bots.find((bot) => bot.id === 'path-bot').stale, true)

  registry.get('ws-1').path = project
  registry.setStatus('ws-1', 'missing-dir')
  const missing = await request(handler, { action: 'bots.list' })
  assert.equal(missing.json.bots.find((bot) => bot.id === 'path-bot').stale, true)
}))

check('without a registry binding is disabled and create fails closed', () => withState(async () => {
  const handler = hostFor()
  const list = await request(handler, { action: 'bots.list' })
  assert.equal(list.json.workspaceBinding, false)
  const failed = await request(handler, {
    action: 'bots.create', name: 'No Reg', label: 'No', instructions: 'No.', workspaceId: 'ws-1',
  })
  assert.equal(failed.status, 503)
  assert.equal(failed.json.error.code, 'E_WORKSPACE_UNAVAILABLE')
}))

check('unknown, invalid and raw workspace fields fail closed', () => withState(async () => {
  const registry = registryOf([])
  const handler = hostFor(registry)

  const unknown = await request(handler, {
    action: 'bots.create', name: 'Unknown', label: 'Unknown', instructions: 'Unknown.', workspaceId: 'missing',
  })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.json.error.code, 'E_WORKSPACE_UNKNOWN')

  const invalid = await request(handler, {
    action: 'bots.create', name: 'Invalid', label: 'Invalid', instructions: 'Invalid.', workspaceId: 7,
  })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.json.error.code, 'E_WORKSPACE_INVALID')

  const raw = await request(handler, {
    action: 'bots.create', name: 'Raw', label: 'Raw', instructions: 'Raw.',
    workspace: { id: 'x', path: '/tmp', title: 'x' },
  })
  assert.equal(raw.status, 400)
  assert.equal(raw.json.error.code, 'E_BOT_INVALID')
}))

check('changing the workspace while busy is refused', () => withState(async (home) => {
  const project = path.join(home, 'project')
  mkdirSync(project)
  const registry = registryOf([{ id: 'ws-1', path: project, title: 'Project' }])
  const handler = hostFor(registry)
  const created = await request(handler, {
    action: 'bots.create', name: 'Busy Bot', label: 'Busy', instructions: 'Busy.',
  })
  assert.equal(created.status, 200)
  openSessionStore(path.join(home, 'state', 'rayrun-bot')).enqueue(created.json.bot.id, 'hello')
  const busy = await request(handler, {
    action: 'bots.update', id: created.json.bot.id, workspaceId: 'ws-1',
  })
  assert.equal(busy.status, 409)
  assert.equal(busy.json.error.code, 'E_WORKSPACE_BUSY')
}))

check('a stale bound workspace blocks session.send for a local-workspace runtime', () => withState(async (home) => {
  const project = path.join(home, 'project')
  mkdirSync(project)
  const registry = registryOf([{ id: 'ws-1', path: project, title: 'Project' }])
  const runtime = {
    contract: 1,
    name: 'fake-detached',
    available: true,
    detached: true,
    usesLocalWorkspace: true,
    async start() { throw new Error('start must not run for a stale workspace') },
    async status() { return { running: false } },
    async collect() { return { running: false, text: 'x' } },
  }
  const handler = hostFor(registry, runtime)
  const created = await request(handler, {
    action: 'bots.create', name: 'Stale Bot', label: 'Stale', instructions: 'Stale.', workspaceId: 'ws-1',
  })
  assert.equal(created.status, 200)
  registry.remove('ws-1')
  const reply = await request(handler, {
    action: 'session.send', botId: created.json.bot.id, text: 'hello',
  })
  assert.equal(reply.status, 409)
  assert.equal(reply.json.error.code, 'E_WORKSPACE_STALE')
}))

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
console.log(`${checks.length - failed}/${checks.length} workspace-bind checks passed`)
if (failed) process.exitCode = 1
