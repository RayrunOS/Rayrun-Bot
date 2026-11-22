/**
 * Per-bot detached-task workspace checks.
 *
 *   node test/bot-workspace.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
