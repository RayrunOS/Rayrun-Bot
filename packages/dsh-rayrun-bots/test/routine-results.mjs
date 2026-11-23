/**
 * Routines results and merged history checks.
 *
 *   node test/routine-results.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'
import {
  ROUTINE_SYNTHETIC_SEQ_BASE, readRoutineResults, writeRoutineResult,
} from '../lib/routine-results.js'
import { openSessionStore } from '../lib/sessions.js'

const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []
const T0 = '2026-11-23T10:00:00.000Z'
const T1 = '2026-11-23T10:00:01.000Z'
const T2 = '2026-11-23T10:00:02.000Z'
const T3 = '2026-11-23T10:00:03.000Z'

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-routine-results-'))
  roots.push(root)
  const bots = openBotStore(root)
  const bot = bots.create({ id: 'bot-a', name: 'Bot A', label: 'A.', instructions: 'A.' })
  return { root, bots, bot }
}

function result(overrides = {}) {
  return {
    schema: 1,
    botId: 'bot-a',
    taskId: 'task-1',
    text: 'Scheduled routine: Inbox\n\nCheck it.',
    reply: 'All clear.',
    at: T3,
    routineId: 'routine-11111111-1111-1111-1111-111111111111',
    ...overrides,
  }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

check('writes one validated result idempotently and reads it back', () => {
  const { root, bot } = setup()
  const written = writeRoutineResult(root, result(), { botId: bot.id })
  assert.equal(written.taskId, 'task-1')
  assert.deepEqual(readRoutineResults(root, bot.id), [written])
  writeRoutineResult(root, result({ reply: 'Updated.' }), { botId: bot.id })
  assert.deepEqual(readRoutineResults(root, bot.id).map((item) => item.reply), ['Updated.'])
})

check('invalid results are refused and an unknown bot writes nothing', () => {
  const { root, bot } = setup()
  expectCode(() => writeRoutineResult(root, result({ taskId: '../escape' }), { botId: bot.id }), ERROR_CODES.routineInvalid)
  expectCode(() => writeRoutineResult(root, result({ reply: '' }), { botId: bot.id }), ERROR_CODES.routineInvalid)
  expectCode(() => writeRoutineResult(root, result({ extra: true }), { botId: bot.id }), ERROR_CODES.routineInvalid)
  expectCode(() => writeRoutineResult(root, result(), { botId: 'missing' }), ERROR_CODES.botUnknown)
  assert.deepEqual(readRoutineResults(root, bot.id), [])
})

check('a failed result becomes a visible system error in history', () => {
  const { root, bot } = setup()
  writeRoutineResult(root, {
    schema: 1,
    botId: bot.id,
    taskId: 'task-failed',
    text: 'Scheduled routine: Inbox\n\nCheck it.',
    at: T0,
    state: 'failed',
    error: 'The model connection failed.',
  }, { botId: bot.id })
  const history = openSessionStore(root).history(bot.id, { tail: true })
  assert.deepEqual(history.messages.map((message) => message.role), ['user', 'system'])
  assert.equal(history.messages[1].code, ERROR_CODES.routineFailed)
  assert.equal(history.messages[1].text, 'The model connection failed.')
  expectCode(() => writeRoutineResult(root, {
    schema: 1, botId: bot.id, taskId: 'task-bad-failure', text: 'x', at: T0,
    state: 'failed', error: 'x', reply: 'nope',
  }, { botId: bot.id }), ERROR_CODES.routineInvalid)
})

check('history merges local transcript and routine results chronologically', () => {
  const { root, bot } = setup()
  const store = openSessionStore(root)
  store.enqueue(bot.id, 'human question', { now: Date.parse(T0) })
  store.shift(bot.id, { now: Date.parse(T1) })
  store.complete(bot.id, 'human reply', { now: Date.parse(T2) })
  writeRoutineResult(root, result(), { botId: bot.id })

  const history = store.history(bot.id, { tail: true })
  assert.equal(history.session.state, 'idle')
  assert.equal(history.session.lastSeq, 2)
  assert.deepEqual(history.messages.map((message) => [message.role, message.text]), [
    ['user', 'human question'],
    ['bot', 'human reply'],
    ['user', 'Scheduled routine: Inbox\n\nCheck it.'],
    ['bot', 'All clear.'],
  ])
  assert.equal(history.messages[2].origin, 'routine')
  assert.equal(history.messages[3].origin, undefined)
  assert.equal(history.messages[2].seq, ROUTINE_SYNTHETIC_SEQ_BASE)
  assert.equal(history.messages[3].seq, ROUTINE_SYNTHETIC_SEQ_BASE + 1)

  const after = store.history(bot.id, { after: 2 })
  assert.deepEqual(after.messages.map((message) => message.text), [
    'Scheduled routine: Inbox\n\nCheck it.',
    'All clear.',
  ])
  const tail = store.history(bot.id, { tail: true, limit: 1 })
  assert.deepEqual(tail.messages.map((message) => message.text), ['All clear.'])
})

check('history returns routine-only results when no local session exists', () => {
  const { root, bot } = setup()
  writeRoutineResult(root, result({ at: T0 }), { botId: bot.id })
  const history = openSessionStore(root).history(bot.id, { tail: true })
  assert.equal(history.session, null)
  assert.deepEqual(history.messages.map((message) => [message.role, message.text]), [
    ['user', 'Scheduled routine: Inbox\n\nCheck it.'],
    ['bot', 'All clear.'],
  ])
})

check('a malformed result file fails history closed', async () => {
  const { root, bot } = setup()
  const store = openSessionStore(root)
  const directory = path.join(root, 'bots', bot.id, 'routine-results')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, 'task-bad.json'), '{not json')
  expectCode(() => store.history(bot.id), ERROR_CODES.routineInvalid)
  writeFileSync(path.join(directory, 'task-bad.json'), JSON.stringify(result({ taskId: 'task-bad', reply: '' })))
  expectCode(() => store.history(bot.id), ERROR_CODES.routineInvalid)
})

for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}: ${error?.message ?? error}`)
    process.exitCode = 1
  }
}

for (const root of roots) rmSync(root, { recursive: true, force: true })
if (!process.exitCode) console.log(`${checks.length}/${checks.length} routine result checks passed`)
