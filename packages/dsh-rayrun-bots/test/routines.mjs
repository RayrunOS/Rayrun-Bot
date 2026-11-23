/**
 * Routine store and local scheduler checks.
 *
 *   node test/routines.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRoutineScheduler } from '../lib/routine-scheduler.js'
import {
  ROUTINE_MAX, ROUTINE_PROMPT_MAX_BYTES, buildRoutinePrompt, openRoutineStore,
} from '../lib/routines.js'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'
import { openSessionRunner } from '../lib/sessions.js'

const errors = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []
const T0 = Date.parse('2026-11-23T10:00:00.000Z')
const MINUTE = 60_000

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-routines-'))
  roots.push(root)
  const bots = openBotStore(root)
  const bot = bots.create({ name: 'Routine Bot', label: 'Runs routines.', instructions: 'Follow routines.' })
  return { root, bots, bot, routines: openRoutineStore(root) }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

check('create persists one routine and computes the next run', () => {
  const { root, bot, routines } = setup()
  const routine = routines.create(bot.id, {
    title: 'Morning inbox',
    prompt: 'Check the inbox and summarize anything urgent.',
    everyMinutes: 15,
  }, { now: T0 })
  assert.match(routine.id, /^routine-[a-z0-9-]+$/)
  assert.equal(routine.enabled, true)
  assert.equal(routine.nextAt, '2026-11-23T10:15:00.000Z')
  assert.equal(routine.lastRunAt, undefined)
  assert.deepEqual(routines.list(bot.id), [routine])
  const file = JSON.parse(readFileSync(path.join(root, 'bots', bot.id, 'routines.json'), 'utf8'))
  assert.equal(file.schema, 1)
  assert.equal(file.botId, bot.id)
  assert.deepEqual(file.routines, [routine])
  assert.equal(file.routines.length, 1)
})

check('validation refuses unknown fields, bad intervals, long prompts and newline titles', () => {
  const { bot, routines } = setup()
  const valid = { title: 'Check', prompt: 'Do it.', everyMinutes: 5 }
  expectCode(() => routines.create(bot.id, { ...valid, extra: true }), ERROR_CODES.routineInvalid)
  expectCode(() => routines.create(bot.id, { ...valid, title: 'two\nlines' }), ERROR_CODES.routineInvalid)
  expectCode(() => routines.create(bot.id, { ...valid, title: '' }), ERROR_CODES.routineInvalid)
  expectCode(() => routines.create(bot.id, { ...valid, everyMinutes: 0 }), ERROR_CODES.routineInvalid)
  expectCode(() => routines.create(bot.id, { ...valid, everyMinutes: 1.5 }), ERROR_CODES.routineInvalid)
  expectCode(() => routines.create(bot.id, { ...valid, enabled: 'yes' }), ERROR_CODES.routineInvalid)
  expectCode(() => routines.create(bot.id, {
    ...valid,
    prompt: 'x'.repeat(ROUTINE_PROMPT_MAX_BYTES + 1),
  }), ERROR_CODES.routineInvalid)
  expectCode(() => routines.list('missing'), ERROR_CODES.botUnknown)
  assert.deepEqual(routines.list(bot.id), [])
})

check('update reschedules on interval or re-enable, and refuses host fields', () => {
  const { bot, routines } = setup()
  const routine = routines.create(bot.id, {
    title: 'Check', prompt: 'Do it.', everyMinutes: 5,
  }, { now: T0 })
  const renamed = routines.update(bot.id, routine.id, { title: 'Check again' }, { now: T0 + MINUTE })
  assert.equal(renamed.nextAt, routine.nextAt)
  assert.equal(renamed.updatedAt, '2026-11-23T10:01:00.000Z')

  const rescheduled = routines.update(bot.id, routine.id, { everyMinutes: 10 }, { now: T0 + 2 * MINUTE })
  assert.equal(rescheduled.nextAt, '2026-11-23T10:12:00.000Z')
  assert.equal(rescheduled.everyMinutes, 10)

  const paused = routines.update(bot.id, routine.id, { enabled: false }, { now: T0 + 3 * MINUTE })
  assert.equal(paused.enabled, false)
  const resumed = routines.update(bot.id, routine.id, { enabled: true }, { now: T0 + 4 * MINUTE })
  assert.equal(resumed.nextAt, '2026-11-23T10:14:00.000Z')
  assert.equal(resumed.enabled, true)

  expectCode(() => routines.update(bot.id, routine.id, { nextAt: '2026-11-24T10:00:00.000Z' }), ERROR_CODES.routineInvalid)
  expectCode(() => routines.update(bot.id, routine.id, {}, { now: T0 }), ERROR_CODES.routineInvalid)
  expectCode(() => routines.update(bot.id, 'routine-missing', { title: 'x' }), ERROR_CODES.routineUnknown)
})

check('remove deletes only the named routine', () => {
  const { bot, routines } = setup()
  const first = routines.create(bot.id, { title: 'One', prompt: 'One.', everyMinutes: 5 }, { now: T0 })
  const second = routines.create(bot.id, { title: 'Two', prompt: 'Two.', everyMinutes: 5 }, { now: T0 })
  assert.equal(routines.remove(bot.id, first.id).id, first.id)
  assert.deepEqual(routines.list(bot.id).map((routine) => routine.id), [second.id])
  expectCode(() => routines.remove(bot.id, first.id), ERROR_CODES.routineUnknown)
})

check('due selects only enabled routines whose nextAt has arrived', () => {
  const { bot, routines } = setup()
  const routine = routines.create(bot.id, {
    title: 'Due', prompt: 'Due.', everyMinutes: 5,
  }, { now: T0 })
  const paused = routines.create(bot.id, {
    title: 'Paused', prompt: 'Paused.', everyMinutes: 5, enabled: false,
  }, { now: T0 })
  assert.deepEqual(routines.due(bot.id, T0 + 4 * MINUTE), [])
  assert.deepEqual(routines.due(bot.id, T0 + 5 * MINUTE).map((item) => item.id), [routine.id])
  assert.equal(routines.due(bot.id, T0 + 5 * MINUTE).some((item) => item.id === paused.id), false)

  const marked = routines.markRun(bot.id, routine.id, { now: T0 + 5 * MINUTE })
  assert.equal(marked.lastRunAt, '2026-11-23T10:05:00.000Z')
  assert.equal(marked.nextAt, '2026-11-23T10:10:00.000Z')
  assert.deepEqual(routines.due(bot.id, T0 + 6 * MINUTE), [])
})

check('missed intervals do not backfill; one run advances to the next interval', () => {
  const { bot, routines } = setup()
  const routine = routines.create(bot.id, {
    title: 'Late', prompt: 'Late.', everyMinutes: 5,
  }, { now: T0 })
  assert.equal(routines.due(bot.id, T0 + 60 * MINUTE).length, 1)
  const marked = routines.markRun(bot.id, routine.id, { now: T0 + 60 * MINUTE })
  assert.equal(marked.nextAt, '2026-11-23T11:05:00.000Z')
  assert.deepEqual(routines.due(bot.id, T0 + 60 * MINUTE), [])
})

check('a corrupt routines file is refused, not silently skipped', () => {
  const { root, bot, routines } = setup()
  routines.create(bot.id, { title: 'One', prompt: 'One.', everyMinutes: 5 }, { now: T0 })
  writeFileSync(path.join(root, 'bots', bot.id, 'routines.json'), '{not json')
  expectCode(() => routines.list(bot.id), ERROR_CODES.routineInvalid)
  expectCode(() => routines.due(bot.id, T0 + 5 * MINUTE), ERROR_CODES.routineInvalid)
})

check('the per-bot routine cap is enforced', () => {
  const { bot, routines } = setup()
  for (let index = 0; index < ROUTINE_MAX; index += 1) {
    routines.create(bot.id, { title: `R${index}`, prompt: 'Do it.', everyMinutes: 5 }, { now: T0 })
  }
  expectCode(() => routines.create(bot.id, {
    title: 'one too many', prompt: 'Do it.', everyMinutes: 5,
  }, { now: T0 }), ERROR_CODES.routineInvalid)
})

check('the scheduler sends one due routine, advances it, and does not repeat', async () => {
  const { root, bots, bot, routines } = setup()
  const routine = routines.create(bot.id, {
    title: 'Inbox', prompt: 'Summarize the inbox.', everyMinutes: 5,
  }, { now: T0 })
  let now = T0 + 5 * MINUTE
  const sent = []
  const scheduler = createRoutineScheduler({
    stateRoot: root,
    botStore: bots,
    routineStore: routines,
    canRun: () => true,
    isBusy: () => false,
    send: async (botId, text, options) => { sent.push({ botId, text, options }) },
    now: () => now,
  })

  assert.deepEqual(await scheduler.tick(), { fired: [{ botId: bot.id, routineId: routine.id }] })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].botId, bot.id)
  assert.deepEqual(sent[0].options, { origin: 'routine' })
  assert.match(sent[0].text, /^Scheduled routine: Inbox/)
  assert.match(sent[0].text, /Summarize the inbox\./)
  assert.equal(routines.list(bot.id)[0].lastRunAt, '2026-11-23T10:05:00.000Z')
  assert.equal(routines.list(bot.id)[0].nextAt, '2026-11-23T10:10:00.000Z')

  assert.deepEqual(await scheduler.tick(), { fired: [] })
  assert.equal(sent.length, 1)
})

check('a busy bot is skipped without advancing the routine', async () => {
  const { root, bots, bot, routines } = setup()
  const routine = routines.create(bot.id, {
    title: 'Inbox', prompt: 'Summarize the inbox.', everyMinutes: 5,
  }, { now: T0 })
  let now = T0 + 5 * MINUTE
  let busy = true
  const sent = []
  const scheduler = createRoutineScheduler({
    stateRoot: root,
    botStore: bots,
    routineStore: routines,
    canRun: () => true,
    isBusy: () => busy,
    send: async (botId, text) => { sent.push({ botId, text }) },
    now: () => now,
  })
  assert.deepEqual(await scheduler.tick(), { fired: [] })
  assert.equal(routines.list(bot.id)[0].lastRunAt, undefined)
  busy = false
  assert.equal((await scheduler.tick()).fired.length, 1)
  assert.equal(sent.length, 1)
  assert.equal(routines.list(bot.id)[0].nextAt, '2026-11-23T10:10:00.000Z')
})

check('the scheduler does nothing while the runtime is unavailable and retries later', async () => {
  const { root, bots, bot, routines } = setup()
  routines.create(bot.id, { title: 'Inbox', prompt: 'Summarize.', everyMinutes: 5 }, { now: T0 })
  let available = false
  const sent = []
  const scheduler = createRoutineScheduler({
    stateRoot: root,
    botStore: bots,
    routineStore: routines,
    canRun: () => available,
    isBusy: () => false,
    send: async (botId, text) => { sent.push({ botId, text }) },
    now: () => T0 + 5 * MINUTE,
  })
  assert.deepEqual(await scheduler.tick(), { fired: [], skipped: 'runtime_unavailable' })
  assert.equal(routines.due(bot.id, T0 + 5 * MINUTE).length, 1)
  available = true
  assert.equal((await scheduler.tick()).fired.length, 1)
  assert.equal(sent.length, 1)
})

check('a failed send consumes the run and does not duplicate', async () => {
  const { root, bots, bot, routines } = setup()
  const routine = routines.create(bot.id, {
    title: 'Inbox', prompt: 'Summarize.', everyMinutes: 5,
  }, { now: T0 })
  let fail = true
  let now = T0 + 5 * MINUTE
  const sent = []
  const scheduler = createRoutineScheduler({
    stateRoot: root,
    botStore: bots,
    routineStore: routines,
    canRun: () => true,
    isBusy: () => false,
    send: async (botId, text) => {
      if (fail) throw new Error('runtime down')
      sent.push({ botId, text })
    },
    now: () => now,
    logger: { warn() {} },
  })
  assert.deepEqual(await scheduler.tick(), { fired: [] })
  const current = routines.list(bot.id).find((item) => item.id === routine.id)
  assert.equal(current.lastRunAt, '2026-11-23T10:05:00.000Z')
  assert.equal(current.nextAt, '2026-11-23T10:10:00.000Z')
  fail = false
  assert.deepEqual(await scheduler.tick(), { fired: [] })
  now = T0 + 10 * MINUTE
  assert.equal((await scheduler.tick()).fired.length, 1)
  assert.equal(sent.length, 1)
})

check('a corrupt bot does not block another bot’s routines', async () => {
  const { root, bots, bot, routines } = setup()
  const other = bots.create({ name: 'Other Bot', label: 'Other.', instructions: 'Other.' })
  routines.create(bot.id, { title: 'Good', prompt: 'Run.', everyMinutes: 5 }, { now: T0 })
  routines.create(other.id, { title: 'Bad', prompt: 'Run.', everyMinutes: 5 }, { now: T0 })
  writeFileSync(path.join(root, 'bots', other.id, 'routines.json'), '{not json')
  const sent = []
  const scheduler = createRoutineScheduler({
    stateRoot: root,
    botStore: bots,
    routineStore: routines,
    canRun: () => true,
    isBusy: () => false,
    send: async (botId, text) => { sent.push({ botId, text }) },
    now: () => T0 + 5 * MINUTE,
    logger: { warn() {} },
  })
  const result = await scheduler.tick()
  assert.equal(result.fired.length, 1)
  assert.equal(result.fired[0].botId, bot.id)
  assert.equal(sent.length, 1)
})

check('a due routine becomes a normal durable session turn', async () => {
  const { root, bots, bot, routines } = setup()
  routines.create(bot.id, {
    title: 'Inbox', prompt: 'Summarize the inbox.', everyMinutes: 1,
  }, { now: T0 })
  let seenOrigin = null
  const runtime = {
    contract: 1,
    name: 'fake',
    available: true,
    async run({ text, origin }) {
      seenOrigin = origin
      return { text: `ran:${text.includes('Summarize the inbox.')}` }
    },
  }
  const runner = openSessionRunner({ stateRoot: root, runtime, getBot: bots.get })
  const scheduler = createRoutineScheduler({
    stateRoot: root,
    botStore: bots,
    routineStore: routines,
    canRun: () => runtime.available,
    isBusy: (botId) => {
      const state = runner.status(botId)?.state
      return state === 'running' || state === 'queued'
    },
    send: (botId, text, options) => runner.send(botId, text, options),
    now: () => T0 + MINUTE,
  })
  assert.equal((await scheduler.tick()).fired.length, 1)
  await runner.settled(bot.id)
  const { messages } = runner.history(bot.id)
  assert.deepEqual(messages.map((message) => message.role), ['user', 'bot'])
  assert.match(messages[0].text, /^Scheduled routine: Inbox/)
  assert.equal(messages[0].origin, 'routine')
  assert.equal(seenOrigin, 'routine')
  assert.equal(messages[1].text, 'ran:true')
  assert.equal(routines.list(bot.id)[0].nextAt, '2026-11-23T10:02:00.000Z')
  runner.close()
})

check('the scheduler timer can be started and stopped without holding the process', () => {
  const { root, bots, routines } = setup()
  const scheduler = createRoutineScheduler({
    stateRoot: root,
    botStore: bots,
    routineStore: routines,
    canRun: () => false,
    isBusy: () => false,
    send: async () => {},
    everyMs: 1000,
  })
  scheduler.start()
  assert.equal(scheduler.running, true)
  scheduler.stop()
  assert.equal(scheduler.running, false)
  assert.throws(() => createRoutineScheduler({
    stateRoot: root, send: async () => {}, everyMs: 10,
  }), /everyMs/)
})

check('the routine prompt carries the title, prompt and approval reminder', () => {
  const prompt = buildRoutinePrompt({ title: 'Inbox', prompt: 'Summarize it.' })
  assert.match(prompt, /Scheduled routine: Inbox/)
  assert.match(prompt, /Summarize it\./)
  assert.match(prompt, /never assume an action was approved/)
  assert.doesNotMatch(prompt, /token|Bearer|sk-/i)
})

for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    errors.push(name)
    console.error(`FAIL ${name}: ${error?.message ?? error}`)
  }
}

for (const root of roots) rmSync(root, { recursive: true, force: true })

if (errors.length) {
  console.error(`${errors.length}/${checks.length} routine checks failed`)
  process.exit(1)
}
console.log(`${checks.length}/${checks.length} routine checks passed`)
