/**
 * `bot.json` schema checks.
 *
 *   node test/bot-schema.mjs
 */
import assert from 'node:assert/strict'
import {
  BOT_SCHEMA_VERSION, BotValidationError, INSTRUCTIONS_MAX_BYTES,
  botIdFromName, createBot, fillTemplate, validateBot,
} from '../lib/bot-schema.js'
import { ERROR_CODES } from '../lib/errors.js'

const errors = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })

function valid(overrides = {}) {
  return {
    schema: 1,
    id: 'weekly-watch',
    name: 'Weekly Watch',
    label: 'Watches the weekly numbers and reports',
    avatar: { kind: 'monogram', letter: 'W', hue: 152 },
    instructions: 'You are Weekly Watch.',
    skills: [],
    model: 'deepseek',
    createdAt: '2026-11-18T12:00:00.000Z',
    updatedAt: '2026-11-18T12:00:00.000Z',
    ...overrides,
  }
}

function expectInvalid(fn, field) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof BotValidationError)
    assert.equal(error.code, ERROR_CODES.botInvalid)
    if (field !== undefined) assert.equal(error.field, field)
    return true
  })
}

check('the documented example validates and defaults revision', () => {
  const bot = validateBot(valid())
  assert.deepEqual(bot, { ...valid(), revision: 1 })
})

check('model defaults to deepseek and revision can be kept', () => {
  const input = valid({ model: undefined, revision: 3 })
  const bot = validateBot(input)
  assert.equal(bot.model, 'deepseek')
  assert.equal(bot.revision, 3)
})

check('unknown top-level fields are rejected', () => {
  expectInvalid(() => validateBot(valid({ extra: true })), 'extra')
})

check('a newer schema is rejected without reading its fields', () => {
  expectInvalid(() => validateBot(valid({ schema: 2, extra: true })), 'schema')
  expectInvalid(() => validateBot(valid({ schema: '1' })), 'schema')
})

for (const id of ['Weekly-Watch', 'weekly_watch', 'a--b', '-a', 'a-', '']) {
  check(`invalid id ${JSON.stringify(id)} is rejected`, () => {
    expectInvalid(() => validateBot(valid({ id })), 'id')
  })
}

check('name must be one non-empty line', () => {
  expectInvalid(() => validateBot(valid({ name: '   ' })), 'name')
  expectInvalid(() => validateBot(valid({ name: 'A\nB' })), 'name')
  expectInvalid(() => validateBot(valid({ name: 'a'.repeat(81) })), 'name')
})

check('label must be one non-empty line', () => {
  expectInvalid(() => validateBot(valid({ label: '' })), 'label')
  expectInvalid(() => validateBot(valid({ label: 'a\nb' })), 'label')
  expectInvalid(() => validateBot(valid({ label: 'a'.repeat(121) })), 'label')
})

check('avatar is a monogram with one letter and a valid hue', () => {
  expectInvalid(() => validateBot(valid({ avatar: { kind: 'image', letter: 'W', hue: 1 } })), 'kind')
  expectInvalid(() => validateBot(valid({ avatar: { kind: 'monogram', letter: 'AB', hue: 1 } })), 'letter')
  expectInvalid(() => validateBot(valid({ avatar: { kind: 'monogram', letter: ' ', hue: 1 } })), 'letter')
  expectInvalid(() => validateBot(valid({ avatar: { kind: 'monogram', letter: 'W', hue: -1 } })), 'hue')
  expectInvalid(() => validateBot(valid({ avatar: { kind: 'monogram', letter: 'W', hue: 360 } })), 'hue')
  expectInvalid(() => validateBot(valid({ avatar: { kind: 'monogram', letter: 'W', hue: 1.5 } })), 'hue')
  expectInvalid(() => validateBot(valid({ avatar: { kind: 'monogram', letter: 'W', hue: 1, extra: 2 } })), 'avatar')
})

check('instructions are bounded by UTF-8 bytes and control characters', () => {
  assert.equal(validateBot(valid({ instructions: 'a'.repeat(INSTRUCTIONS_MAX_BYTES) })).instructions.length, INSTRUCTIONS_MAX_BYTES)
  expectInvalid(() => validateBot(valid({ instructions: 'a'.repeat(INSTRUCTIONS_MAX_BYTES + 1) })), 'instructions')
  expectInvalid(() => validateBot(valid({ instructions: 'é'.repeat(4097) })), 'instructions')
  expectInvalid(() => validateBot(valid({ instructions: 'a\u0000b' })), 'instructions')
  expectInvalid(() => validateBot(valid({ instructions: 42 })), 'instructions')
})

check('skills are unique non-empty names', () => {
  expectInvalid(() => validateBot(valid({ skills: 'skill' })), 'skills')
  expectInvalid(() => validateBot(valid({ skills: [1] })), 'skills')
  expectInvalid(() => validateBot(valid({ skills: ['a', 'a'] })), 'skills')
  expectInvalid(() => validateBot(valid({ skills: Array.from({ length: 65 }, (_, i) => `s${i}`) })), 'skills')
  assert.deepEqual(validateBot(valid({ skills: [' git ', 'docs'] })).skills, ['git', 'docs'])
})

check('only the DeepSeek model is accepted', () => {
  expectInvalid(() => validateBot(valid({ model: 'openai' })), 'model')
})

check('timestamps and revision are validated', () => {
  expectInvalid(() => validateBot(valid({ createdAt: 'nope' })), 'createdAt')
  expectInvalid(() => validateBot(valid({ updatedAt: 'nope' })), 'updatedAt')
  expectInvalid(() => validateBot(valid({ revision: -1 })), 'revision')
  expectInvalid(() => validateBot(valid({ revision: 1.5 })), 'revision')
  expectInvalid(() => validateBot(valid({ deletedAt: 'nope' })), 'deletedAt')
  assert.equal(validateBot(valid({ deletedAt: '2026-11-19T00:00:00.000Z' })).deletedAt, '2026-11-19T00:00:00.000Z')
})

check('ids derive from display names', () => {
  assert.equal(botIdFromName('Weekly Watch'), 'weekly-watch')
  assert.equal(botIdFromName('  Café  Menu!  '), 'cafe-menu')
  assert.equal(botIdFromName('A'.repeat(80)), 'a'.repeat(64))
  expectInvalid(() => botIdFromName('周报'), 'id')
})

check('fillTemplate replaces both placeholders', () => {
  assert.equal(fillTemplate('You are {name}; job: {job}.', { name: 'Nora', job: 'digest' }), 'You are Nora; job: digest.')
  assert.equal(fillTemplate(undefined, { name: 'Nora', job: 'digest' }), '')
})

check('createBot derives id, avatar, template, timestamps and revision', () => {
  const bot = createBot(
    { name: 'Weekly Watch', label: 'Watches the weekly numbers' },
    { template: 'You are {name}. Your job: {job}.', now: '2026-11-18T12:00:00.000Z' },
  )
  assert.equal(bot.schema, BOT_SCHEMA_VERSION)
  assert.equal(bot.id, 'weekly-watch')
  assert.equal(bot.name, 'Weekly Watch')
  assert.equal(bot.instructions, 'You are Weekly Watch. Your job: Watches the weekly numbers.')
  assert.deepEqual(bot.skills, [])
  assert.equal(bot.model, 'deepseek')
  assert.equal(bot.revision, 1)
  assert.equal(bot.createdAt, '2026-11-18T12:00:00.000Z')
  assert.equal(bot.updatedAt, bot.createdAt)
  assert.equal(bot.avatar.kind, 'monogram')
  assert.equal(bot.avatar.letter, 'W')
  assert.ok(Number.isInteger(bot.avatar.hue) && bot.avatar.hue >= 0 && bot.avatar.hue <= 359)
})

check('createBot keeps explicit instructions and accepts a CJK name with an explicit id', () => {
  const bot = createBot({ id: 'weekly', name: '周报', label: '每周汇报', instructions: 'Custom.' })
  assert.equal(bot.id, 'weekly')
  assert.equal(bot.instructions, 'Custom.')
  assert.equal(bot.avatar.letter, '周')
})

check('createBot rejects host-only and unknown fields', () => {
  expectInvalid(() => createBot({ name: 'A', label: 'B', createdAt: '2026-11-18T12:00:00.000Z' }), 'createdAt')
  expectInvalid(() => createBot({ name: 'A', label: 'B', revision: 2 }), 'revision')
  expectInvalid(() => createBot({ name: 'A', label: 'B', extra: true }), 'extra')
})

check('createBot rejects an invalid now', () => {
  expectInvalid(() => createBot({ name: 'A', label: 'B' }, { now: 'nope' }), 'createdAt')
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

if (errors.length) {
  console.error(`${errors.length}/${checks.length} bot-schema checks failed`)
  process.exit(1)
}
console.log(`${checks.length}/${checks.length} bot-schema checks passed`)
