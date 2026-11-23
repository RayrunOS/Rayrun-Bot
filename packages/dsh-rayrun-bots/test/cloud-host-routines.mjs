/**
 * Cloud host routine scheduler checks (plain Node, no framework).
 *
 *   node test/cloud-host-routines.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCloudHost } from '../cloud-host/lib/host.mjs'
import { buildRoutinePrompt, readBotFile } from '../cloud-host/lib/prompt.mjs'

const checks = []
const roots = []
const check = (name, fn) => checks.push({ name, fn })
const T0 = Date.parse('2026-11-23T10:00:00.000Z')
const MINUTE = 60_000

function setup({ agent } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-cloud-routines-'))
  roots.push(root)
  let now = T0
  const host = createCloudHost({
    root,
    logPath: path.join(root, 'host.log'),
    now: () => new Date(now).toISOString(),
    ...(agent === undefined ? {} : { agent }),
  })
  host.recover()
  return {
    root,
    host,
    setNow(value) { now = value },
  }
}

function writeBot(host, botId) {
  const paths = host.pathsFor(botId)
  writeFileSync(path.join(paths.root, 'bot.json'), JSON.stringify({
    schema: 1,
    id: botId,
    name: 'Inbox Bot',
    label: 'Checks the inbox.',
    instructions: 'Follow the routine instructions carefully.',
    avatar: { kind: 'monogram', letter: 'I', hue: 200 },
    skills: [],
    model: 'deepseek',
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    revision: 1,
  }))
  return paths
}

function routine(overrides = {}) {
  return {
    id: 'routine-11111111-1111-1111-1111-111111111111',
    title: 'Inbox',
    prompt: 'Summarize the inbox.',
    everyMinutes: 5,
    enabled: true,
    nextAt: new Date(T0).toISOString(),
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    ...overrides,
  }
}

function writeRoutines(host, botId, routines) {
  const paths = host.pathsFor(botId)
  writeFileSync(path.join(paths.root, 'routines.json'), JSON.stringify({ schema: 1, botId, routines }))
  return paths
}

function readState(host, botId) {
  return JSON.parse(readFileSync(path.join(host.pathsFor(botId).host, 'routines-state.json'), 'utf8'))
}

check('enqueues one due routine, runs it, and writes a routine result', async () => {
  const { host } = setup()
  const paths = writeRoutines(host, 'bot-a', [routine()])
  const enqueued = host.enqueueDueRoutines()
  assert.equal(enqueued.length, 1)
  assert.equal(enqueued[0].botId, 'bot-a')
  assert.equal(enqueued[0].routineId, routine().id)
  const taskFile = path.join(paths.inbox, `${enqueued[0].taskId}.json`)
  assert.ok(existsSync(taskFile))
  const task = JSON.parse(readFileSync(taskFile, 'utf8'))
  assert.equal(task.origin, 'routine')
  assert.equal(task.routineId, routine().id)
  assert.match(task.text, /^Scheduled routine: Inbox/)

  const state = readState(host, 'bot-a')
  assert.equal(state.routines[routine().id].nextAt, new Date(T0 + 5 * MINUTE).toISOString())
  assert.equal(state.routines[routine().id].lastRunAt, new Date(T0).toISOString())

  const result = await host.processNext()
  assert.equal(result.botId, 'bot-a')
  const resultFile = path.join(paths.routineResults, `${enqueued[0].taskId}.json`)
  assert.ok(existsSync(resultFile))
  const stored = JSON.parse(readFileSync(resultFile, 'utf8'))
  assert.equal(stored.schema, 1)
  assert.equal(stored.botId, 'bot-a')
  assert.equal(stored.taskId, enqueued[0].taskId)
  assert.equal(stored.routineId, routine().id)
  assert.match(stored.text, /Summarize the inbox/)
  assert.match(stored.reply, /echo:/)
  const transcript = readFileSync(paths.transcript, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(transcript[0].origin, 'routine')
})

check('does not enqueue the same interval twice', () => {
  const { host } = setup()
  writeRoutines(host, 'bot-a', [routine()])
  assert.equal(host.enqueueDueRoutines().length, 1)
  assert.deepEqual(host.enqueueDueRoutines(), [])
})

check('skips disabled routines and a bot with pending work', async () => {
  const { host } = setup()
  const paths = writeRoutines(host, 'bot-a', [routine({ enabled: false })])
  assert.deepEqual(host.enqueueDueRoutines(), [])
  writeRoutines(host, 'bot-a', [routine()])
  writeFileSync(path.join(paths.inbox, 'human.json'), JSON.stringify({ id: 'human', text: 'hello' }))
  assert.deepEqual(host.enqueueDueRoutines(), [])
  await host.processNext()
  assert.equal(host.enqueueDueRoutines().length, 1)
})

check('a changed definition restarts from its new nextAt', async () => {
  const { host, setNow } = setup()
  writeRoutines(host, 'bot-a', [routine()])
  host.enqueueDueRoutines()
  await host.processNext()
  const updated = routine({
    nextAt: new Date(T0 + 60 * MINUTE).toISOString(),
    updatedAt: new Date(T0 + MINUTE).toISOString(),
  })
  writeRoutines(host, 'bot-a', [updated])
  assert.deepEqual(host.enqueueDueRoutines(), [])
  setNow(T0 + 3 * MINUTE)
  writeRoutines(host, 'bot-a', [routine({
    nextAt: new Date(T0 + 2 * MINUTE).toISOString(),
    updatedAt: new Date(T0 + MINUTE).toISOString(),
  })])
  assert.equal(host.enqueueDueRoutines().length, 1)
})

check('a malformed routines file does not block another bot', () => {
  const { host } = setup()
  writeRoutines(host, 'bot-a', [routine()])
  const bad = host.pathsFor('bot-b')
  writeFileSync(path.join(bad.root, 'routines.json'), '{not json')
  const enqueued = host.enqueueDueRoutines()
  assert.equal(enqueued.length, 1)
  assert.equal(enqueued[0].botId, 'bot-a')
  const log = readFileSync(path.join(host.paths.log), 'utf8')
  assert.match(log, /routine-invalid/)
})

check('builds a full routine prompt from the mirrored bot', () => {
  const { host } = setup()
  const paths = writeBot(host, 'bot-a')
  const bot = readBotFile(paths.root)
  const prompt = buildRoutinePrompt({
    bot,
    text: 'Scheduled routine: Inbox\n\nCheck it.',
    machine: 'box',
  })
  assert.match(prompt, /^You are Inbox Bot, Checks the inbox\./)
  assert.match(prompt, /Follow the routine instructions carefully\./)
  assert.doesNotMatch(prompt, /Conversation so far/)
  assert.match(prompt, /Scheduled routine: Inbox/)
  assert.match(prompt, /```rayrun-approval/)
  assert.match(prompt, /"machine":"box"/)
  assert.match(prompt, /rayrun\.machine\.pause/)
})

check('a routine with an invalid action field is ignored', () => {
  const { host } = setup()
  writeRoutines(host, 'bot-a', [routine({ argv: ['rm'] })])
  assert.deepEqual(host.enqueueDueRoutines(), [])
  assert.match(readFileSync(path.join(host.paths.log), 'utf8'), /routine-invalid/)
})

let passed = 0
let failed = 0
try {
  for (const { name, fn } of checks) {
    try {
      await fn()
      passed += 1
      console.log(`ok   ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}\n     ${String(error?.stack ?? error).split('\n').slice(0, 6).join('\n     ')}`)
    }
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
console.log(`${passed}/${checks.length} cloud host routine checks passed`)
if (failed > 0) process.exit(1)
