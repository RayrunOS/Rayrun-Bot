/**
 * Persistent roster checks.
 *
 *   node test/bot-store.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'

const errors = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })

const roots = []
function store() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-store-'))
  roots.push(root)
  return { root, bots: openBotStore(root) }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

check('create derives a kebab-case id, persists and lists it', () => {
  const { root, bots } = store()
  const created = bots.create(
    { name: 'Weekly Watch', label: 'Watches the weekly numbers', instructions: 'Do the weekly watch.' },
    { now: '2026-11-21T10:00:00.000Z' },
  )
  assert.equal(created.id, 'weekly-watch')
  assert.equal(created.revision, 1)

  const file = path.join(root, 'bots', 'weekly-watch', 'bot.json')
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).name, 'Weekly Watch')

  const reopened = openBotStore(root)
  const list = reopened.list()
  assert.equal(list.length, 1)
  assert.deepEqual(list[0], created)
  assert.deepEqual(reopened.get('weekly-watch'), created)
})

check('a CJK-only name falls back to the bot id and suffixes duplicates', () => {
  const { bots } = store()
  assert.equal(bots.create({ name: '周报', label: '每周汇报' }).id, 'bot')
  assert.equal(bots.create({ name: '周报', label: '每周汇报' }).id, 'bot-2')
  assert.equal(bots.create({ name: 'Weekly Watch', label: 'one' }).id, 'weekly-watch')
  assert.equal(bots.create({ name: 'Weekly Watch', label: 'two' }).id, 'weekly-watch-2')
})

check('an explicit id is validated and a duplicate is refused', () => {
  const { bots } = store()
  bots.create({ id: 'weekly', name: '周报', label: '每周汇报' })
  expectCode(() => bots.create({ id: 'weekly', name: 'Other', label: 'Other.' }), ERROR_CODES.botExists)
  expectCode(() => bots.create({ id: '../escape', name: 'Other', label: 'Other.' }), ERROR_CODES.botInvalid)
})

check('invalid definitions are refused and write nothing', () => {
  const { root, bots } = store()
  expectCode(() => bots.create({ name: '', label: 'x' }), ERROR_CODES.botInvalid)
  expectCode(() => bots.create({ name: 'A', label: 'B', createdAt: '2026-11-21T10:00:00.000Z' }), ERROR_CODES.botInvalid)
  assert.deepEqual(readdirSync(path.join(root, 'bots')), [])
})

check('unknown and malformed ids are refused before any path is touched', () => {
  const { bots } = store()
  expectCode(() => bots.get('missing'), ERROR_CODES.botUnknown)
  expectCode(() => bots.get('../etc/passwd'), ERROR_CODES.botInvalid)
  expectCode(() => bots.remove('Missing_Id'), ERROR_CODES.botInvalid)
})

check('update bumps the revision and refuses non-editable fields', () => {
  const { bots } = store()
  const created = bots.create({ name: 'Weekly Watch', label: 'Watches' }, { now: '2026-11-21T10:00:00.000Z' })
  const updated = bots.update(
    created.id,
    { label: 'Watches and reports', skills: ['git'] },
    { now: '2026-11-21T11:00:00.000Z' },
  )
  assert.equal(updated.label, 'Watches and reports')
  assert.deepEqual(updated.skills, ['git'])
  assert.equal(updated.revision, 2)
  assert.equal(updated.updatedAt, '2026-11-21T11:00:00.000Z')
  assert.equal(updated.createdAt, created.createdAt)
  assert.deepEqual(bots.get(created.id), updated)

  for (const key of ['id', 'createdAt', 'revision', 'schema']) {
    expectCode(() => bots.update(created.id, { [key]: 'x' }), ERROR_CODES.botInvalid)
  }
  assert.deepEqual(bots.get(created.id), updated)
})

check('a corrupt or mismatched bot.json is refused, not silently skipped', () => {
  const { root, bots } = store()
  const created = bots.create({ name: 'Weekly Watch', label: 'Watches' })
  writeFileSync(path.join(root, 'bots', created.id, 'bot.json'), '{not json')
  expectCode(() => bots.list(), ERROR_CODES.botInvalid)

  const second = store()
  const other = second.bots.create({ id: 'other', name: 'Other', label: 'Other.' })
  const body = JSON.parse(readFileSync(path.join(second.root, 'bots', 'other', 'bot.json'), 'utf8'))
  body.id = 'different'
  writeFileSync(path.join(second.root, 'bots', 'other', 'bot.json'), JSON.stringify(body))
  expectCode(() => second.bots.list(), ERROR_CODES.botInvalid)
})

check('delete removes the directory and the id becomes unknown', () => {
  const { root, bots } = store()
  const created = bots.create({ name: 'Weekly Watch', label: 'Watches' })
  assert.equal(bots.remove(created.id), created.id)
  assert.equal(readdirSync(path.join(root, 'bots')).length, 0)
  expectCode(() => bots.get(created.id), ERROR_CODES.botUnknown)
  expectCode(() => bots.remove(created.id), ERROR_CODES.botUnknown)
})

check('successful writes leave no temp files behind', () => {
  const { root, bots } = store()
  const created = bots.create({ name: 'Weekly Watch', label: 'Watches' })
  bots.update(created.id, { label: 'Watches again' })
  const entries = readdirSync(path.join(root, 'bots', created.id))
  assert.deepEqual(entries, ['bot.json'])
})

check('list is ordered by creation time, then id', () => {
  const { bots } = store()
  bots.create({ name: 'Second', label: 'x' }, { now: '2026-11-21T11:00:00.000Z' })
  bots.create({ name: 'First', label: 'x' }, { now: '2026-11-21T10:00:00.000Z' })
  bots.create({ name: 'Third', label: 'x' }, { now: '2026-11-21T11:00:00.000Z' })
  assert.deepEqual(bots.list().map((bot) => bot.id), ['first', 'second', 'third'])
})

for (const { name, fn } of checks) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    errors.push(name)
    console.error(`FAIL ${name}: ${error?.message ?? error}`)
  }
}

for (const root of roots) rmSync(root, { recursive: true, force: true })

if (errors.length) {
  console.error(`${errors.length}/${checks.length} bot-store checks failed`)
  process.exit(1)
}
console.log(`${checks.length}/${checks.length} bot-store checks passed`)
