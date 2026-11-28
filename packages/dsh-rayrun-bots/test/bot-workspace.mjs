/**
 * Per-bot detached-task workspace checks.
 *
 *   node test/bot-workspace.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureBotWorkspace } from '../lib/bot-workspace.js'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'

const errors = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-workspace-'))
  roots.push(root)
  const bot = openBotStore(root).create({ name: 'Workspace Bot', label: 'Uses a checkout' })
  return { root, bot }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

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

function sourceDir(files = {}) {
  const source = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-source-'))
  roots.push(source)
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(source, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  return source
}

check('ensureBotWorkspace creates an idempotent git checkout outside the user repo', () => {
  const { root, bot } = setup()
  const dir = ensureBotWorkspace(root, bot.id, { name: bot.name })
  assert.equal(dir, path.join(root, 'bots', bot.id, 'workspace'))
  assert.equal(existsSync(path.join(dir, '.git')), true)
  assert.equal(readFileSync(path.join(dir, '.gitignore'), 'utf8'), '.dsh/\n')
  assert.match(readFileSync(path.join(dir, 'README.md'), 'utf8'), /Workspace Bot/)
  assert.equal(git(dir, ['rev-parse', '--is-inside-work-tree']), 'true')
  assert.equal(git(dir, ['rev-list', '--count', 'HEAD']), '1')

  const again = ensureBotWorkspace(root, bot.id, { name: bot.name })
  assert.equal(again, dir)
  assert.equal(git(dir, ['rev-list', '--count', 'HEAD']), '1')
})

check('an existing non-git workspace fails closed', () => {
  const { root, bot } = setup()
  mkdirSync(path.join(root, 'bots', bot.id, 'workspace'), { recursive: true })
  assert.throws(() => ensureBotWorkspace(root, bot.id), (error) => {
    assert.equal(error.code, ERROR_CODES.internal)
    assert.match(error.message, /not a git checkout/)
    return true
  })
})

check('the workspace path validates the bot id', () => {
  const { root } = setup()
  assert.throws(() => ensureBotWorkspace(root, '../escape'), (error) => {
    assert.equal(error.code, ERROR_CODES.botInvalid)
    return true
  })
})

check('a bound workspace mirrors files and ignores secrets, symlinks and git', () => {
  const { root, bot } = setup()
  const source = sourceDir({
    'src/a.txt': 'hello',
    '.env': 'SECRET=1',
    'secret.pem': 'pem',
    'node_modules/x.js': 'x',
    '.git/config': 'git',
  })
  symlinkSync(path.join(source, 'src', 'a.txt'), path.join(source, 'link.txt'))
  const dir = ensureBotWorkspace(root, bot.id, {
    name: bot.name,
    workspace: { id: 'ws-1', path: source, title: 'Source' },
  })
  assert.equal(readFileSync(path.join(dir, 'src', 'a.txt'), 'utf8'), 'hello')
  assert.equal(existsSync(path.join(dir, '.env')), false)
  assert.equal(existsSync(path.join(dir, 'secret.pem')), false)
  assert.equal(existsSync(path.join(dir, 'node_modules')), false)
  assert.equal(existsSync(path.join(dir, 'link.txt')), false)
  assert.equal(readFileSync(path.join(source, 'src', 'a.txt'), 'utf8'), 'hello')
  assert.equal(git(dir, ['rev-parse', '--is-inside-work-tree']), 'true')
  assert.equal(git(dir, ['status', '--porcelain']), '')
  const meta = JSON.parse(readFileSync(path.join(root, 'bots', bot.id, 'workspace.json'), 'utf8'))
  assert.equal(meta.state, 'ready')
  assert.equal(meta.sourceWorkspaceId, 'ws-1')
  assert.equal(meta.sourcePath, source)
})

check('a re-sync updates and removes source files but keeps .dsh results', () => {
  const { root, bot } = setup()
  const source = sourceDir({ 'src/a.txt': 'one' })
  const binding = { id: 'ws-1', path: source, title: 'Source' }
  const dir = ensureBotWorkspace(root, bot.id, { workspace: binding })
  mkdirSync(path.join(dir, '.dsh', 'results', 'task-1'), { recursive: true })
  writeFileSync(path.join(dir, '.dsh', 'results', 'task-1', 'reply.md'), 'result')
  writeFileSync(path.join(source, 'src', 'a.txt'), 'two')
  writeFileSync(path.join(source, 'src', 'b.txt'), 'new')
  ensureBotWorkspace(root, bot.id, { workspace: binding })
  assert.equal(readFileSync(path.join(dir, 'src', 'a.txt'), 'utf8'), 'two')
  assert.equal(readFileSync(path.join(dir, 'src', 'b.txt'), 'utf8'), 'new')
  rmSync(path.join(source, 'src', 'a.txt'))
  ensureBotWorkspace(root, bot.id, { workspace: binding })
  assert.equal(existsSync(path.join(dir, 'src', 'a.txt')), false)
  assert.equal(readFileSync(path.join(dir, '.dsh', 'results', 'task-1', 'reply.md'), 'utf8'), 'result')
  assert.equal(git(dir, ['status', '--porcelain']), '')
})

check('a missing source fails closed and keeps the existing copy', () => {
  const { root, bot } = setup()
  const source = sourceDir({ 'a.txt': 'keep' })
  const binding = { id: 'ws-1', path: source, title: 'Source' }
  const dir = ensureBotWorkspace(root, bot.id, { workspace: binding })
  rmSync(source, { recursive: true, force: true })
  expectCode(() => ensureBotWorkspace(root, bot.id, { workspace: binding }), ERROR_CODES.workspaceStale)
  assert.equal(readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'keep')
})

check('a source at or above the state root is refused', () => {
  const { root, bot } = setup()
  expectCode(
    () => ensureBotWorkspace(root, bot.id, { workspace: { id: 'ws', path: root, title: 'Root' } }),
    ERROR_CODES.workspaceInvalid,
  )
  expectCode(
    () => ensureBotWorkspace(root, bot.id, { workspace: { id: 'ws', path: path.dirname(root), title: 'Parent' } }),
    ERROR_CODES.workspaceInvalid,
  )
})

check('rebinding preserves the previous copy', () => {
  const { root, bot } = setup()
  const first = sourceDir({ 'a.txt': 'first' })
  ensureBotWorkspace(root, bot.id, { workspace: { id: 'ws-1', path: first, title: 'First' } })
  const second = sourceDir({ 'b.txt': 'second' })
  const dir = ensureBotWorkspace(root, bot.id, { workspace: { id: 'ws-2', path: second, title: 'Second' } })
  assert.equal(readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'second')
  const entries = readdirSync(path.join(root, 'bots', bot.id))
  assert.equal(entries.some((name) => name.startsWith('workspace.previous-')), true)
})

check('an oversized file fails closed before writing', () => {
  const { root, bot } = setup()
  const source = sourceDir({ 'small.txt': 'ok' })
  writeFileSync(path.join(source, 'big.bin'), Buffer.alloc(9 * 1024 * 1024))
  expectCode(
    () => ensureBotWorkspace(root, bot.id, { workspace: { id: 'ws', path: source, title: 'Big' } }),
    ERROR_CODES.workspaceTooLarge,
  )
  assert.equal(existsSync(path.join(root, 'bots', bot.id, 'workspace')), false)
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

for (const root of roots) rmSync(root, { recursive: true, force: true })

console.log(`${checks.length - failed}/${checks.length} workspace checks passed`)
if (failed) process.exitCode = 1
