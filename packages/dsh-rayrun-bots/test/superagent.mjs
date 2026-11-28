/**
 * Primary bot identity checks.
 *
 *   node test/superagent.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'
import { openSuperagentStore, PRIMARY_DEFAULT_NAME } from '../lib/superagent.js'

const errors = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function stores() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-superagent-'))
  roots.push(root)
  return { root, bots: openBotStore(root), superagent: openSuperagentStore(root) }
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

check('a missing record reads as null', () => {
  const { superagent } = stores()
  assert.equal(superagent.read(), null)
  assert.equal(superagent.primaryBotId(), null)
})

check('ensure creates the default primary and its record', () => {
  const { root, bots, superagent } = stores()
  const result = superagent.ensure(bots)
  assert.equal(result.created, true)
  assert.equal(result.bot.id, 'superagent')
  assert.equal(result.bot.name, PRIMARY_DEFAULT_NAME)
  assert.equal(result.bot.revision, 1)
  assert.deepEqual(superagent.read(), {
    schema: 1,
    botId: 'superagent',
    createdAt: result.record.createdAt,
  })
  assert.equal(superagent.primaryBotId(), 'superagent')
  assert.equal(JSON.parse(readFileSync(path.join(root, 'bots', 'superagent', 'bot.json'), 'utf8')).id, 'superagent')
})

check('ensure is idempotent', () => {
  const { bots, superagent } = stores()
  const first = superagent.ensure(bots)
  const second = superagent.ensure(bots)
  assert.equal(second.created, false)
  assert.equal(second.bot.id, first.bot.id)
  assert.equal(second.bot.revision, first.bot.revision)
  assert.deepEqual(second.record, first.record)
  assert.deepEqual(readdirSync(path.join(path.dirname(superagent.file), 'bots')), ['superagent'])
})

check('an existing worker is untouched', () => {
  const { bots, superagent } = stores()
  const worker = bots.create({ name: 'Existing Worker', label: 'Exists', instructions: 'Work.' })
  const result = superagent.ensure(bots)
  assert.equal(result.bot.id, 'superagent')
  assert.equal(bots.get(worker.id).revision, 1)
})

check('a taken default id gets a suffix', () => {
  const { bots, superagent } = stores()
  const taken = bots.create({ id: 'superagent', name: 'Taken', label: 'Taken', instructions: 'Taken.' })
  const result = superagent.ensure(bots)
  assert.equal(result.bot.id, 'superagent-2')
  assert.equal(result.record.botId, 'superagent-2')
  assert.equal(bots.get(taken.id).name, 'Taken')
})

check('a record pointing at a deleted bot is rebuilt', () => {
  const { bots, superagent } = stores()
  const worker = bots.create({ name: 'Worker', label: 'Works', instructions: 'Work.' })
  const first = superagent.ensure(bots)
  bots.remove('superagent')
  const rebuilt = superagent.ensure(bots)
  assert.equal(rebuilt.created, true)
  assert.equal(rebuilt.bot.id, 'superagent')
  assert.equal(rebuilt.record.createdAt, first.record.createdAt)
  assert.equal(bots.get(worker.id).revision, 1)
})

check('a corrupt bot.json fails closed instead of rebuilding', () => {
  const { root, bots, superagent } = stores()
  superagent.ensure(bots)
  writeFileSync(path.join(root, 'bots', 'superagent', 'bot.json'), '{not json')
  expectCode(() => superagent.ensure(bots), ERROR_CODES.botInvalid)
  assert.equal(superagent.primaryBotId(), 'superagent')
})

check('corrupt records fail closed', () => {
  const cases = [
    '{not json',
    JSON.stringify({ schema: 2, botId: 'superagent', createdAt: new Date().toISOString() }),
    JSON.stringify({ schema: 1, botId: 'superagent', createdAt: new Date().toISOString(), extra: true }),
    JSON.stringify({ schema: 1, botId: '../etc/passwd', createdAt: new Date().toISOString() }),
    JSON.stringify({ schema: 1, botId: 'superagent', createdAt: 'not-a-date' }),
  ]
  for (const text of cases) {
    const { root, superagent } = stores()
    writeFileSync(path.join(root, 'superagent.json'), text)
    expectCode(() => superagent.read(), ERROR_CODES.superagentInvalid)
  }
})

check('writes leave no temp files', () => {
  const { root, bots, superagent } = stores()
  superagent.ensure(bots)
  const leftovers = readdirSync(root).filter((name) => name.startsWith('.superagent.json.tmp-'))
  assert.deepEqual(leftovers, [])
})

for (const { name, fn } of checks) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    errors.push({ name, error })
    console.error(`FAIL ${name}\n     ${error.stack}`)
  }
}
for (const root of roots) rmSync(root, { recursive: true, force: true })
if (errors.length) process.exitCode = 1
else console.log(`${checks.length}/${checks.length} superagent checks passed`)
