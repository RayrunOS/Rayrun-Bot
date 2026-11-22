/**
 * Durable session and fake-runtime checks.
 *
 *   node test/session-runtime.mjs
 */
import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'
import {
  HISTORY_MAX_LIMIT, MESSAGE_MAX_BYTES, QUEUE_MAX, openSessionRunner, openSessionStore,
} from '../lib/sessions.js'

const errors = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function setup(handler) {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-session-'))
  roots.push(root)
  const bots = openBotStore(root)
  const bot = bots.create({ name: 'Echo Bot', label: 'Echoes messages', instructions: 'Reply briefly.' })
  const runtime = { contract: 1, name: 'fake', available: true, run: handler }
  const runner = openSessionRunner({ stateRoot: root, runtime, getBot: bots.get })
  return { root, bots, bot, runner, runtime }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.code, code)
    return true
  })
}

check('a send persists the user message and the fake reply, then returns to idle', async () => {
  let seen
  const { bot, runner } = setup(async ({ bot: current, text, history }) => {
    seen = { current, text, history }
    return { text: 'pong' }
  })
  const sent = runner.send(bot.id, 'ping')
  assert.equal(sent.message.role, 'user')
  assert.equal(sent.message.text, 'ping')
  assert.ok(['queued', 'running'].includes(sent.session.state))

  await runner.settled(bot.id)
  assert.equal(seen.current.id, bot.id)
  assert.equal(seen.text, 'ping')
  assert.deepEqual(seen.history.map((message) => message.role), ['user'])

  const status = runner.status(bot.id)
  assert.equal(status.state, 'idle')
  assert.equal(status.lastSeq, 2)
  const { messages } = runner.history(bot.id)
  assert.deepEqual(messages.map((message) => [message.role, message.text]), [['user', 'ping'], ['bot', 'pong']])
})

check('history returns only messages after the cursor and validates its bounds', async () => {
  const { bot, runner } = setup(async () => ({ text: 'pong' }))
  const sent = runner.send(bot.id, 'ping')
  await runner.settled(bot.id)

  const all = runner.history(bot.id)
  const tail = runner.history(bot.id, { after: sent.message.seq })
  assert.deepEqual(all.messages.map((message) => message.text), ['ping', 'pong'])
  assert.deepEqual(tail.messages.map((message) => message.text), ['pong'])
  expectCode(() => runner.history(bot.id, { after: -1 }), ERROR_CODES.sessionInvalid)
  expectCode(() => runner.history(bot.id, { limit: HISTORY_MAX_LIMIT + 1 }), ERROR_CODES.sessionInvalid)
})

check('a second send queues behind the running turn and order is preserved', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const calls = []
  const { bot, runner } = setup(async ({ text }) => {
    calls.push(text)
    if (text === 'one') await gate
    return { text: `re:${text}` }
  })

  runner.send(bot.id, 'one')
  const second = runner.send(bot.id, 'two')
  assert.equal(second.session.state, 'queued')
  assert.equal(second.session.pending, 1)
  assert.equal(Object.hasOwn(second.session, 'queue'), false)
  assert.equal(runner.status(bot.id).pending, 1)

  release()
  await runner.settled(bot.id)
  assert.deepEqual(calls, ['one', 'two'])
  // The transcript is chronological: the second user message is recorded when
  // it is accepted, even though the first turn is still running.
  assert.deepEqual(
    runner.history(bot.id).messages.map((message) => message.text),
    ['one', 'two', 're:one', 're:two'],
  )
})

check('a runtime failure fails closed, redacts credentials and resumes on the next send', async () => {
  let calls = 0
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345'
  const { bot, runner } = setup(async ({ text }) => {
    calls += 1
    if (calls === 1) {
      const error = new Error(`No token. Bearer ${secret} and RAYRUN_TOKEN=also-secret`)
      error.code = ERROR_CODES.tokenRequired
      throw error
    }
    return { text: `ok:${text}` }
  })

  runner.send(bot.id, 'first')
  await runner.settled(bot.id)
  const failed = runner.status(bot.id)
  assert.equal(failed.state, 'failed')
  assert.equal(failed.error.code, ERROR_CODES.tokenRequired)

  const system = runner.history(bot.id).messages.at(-1)
  assert.equal(system.role, 'system')
  assert.equal(system.code, ERROR_CODES.tokenRequired)
  assert.doesNotMatch(system.text, new RegExp(secret))
  assert.doesNotMatch(system.text, /also-secret/)
  assert.match(system.text, /\[redacted\]/)

  runner.send(bot.id, 'second')
  await runner.settled(bot.id)
  assert.equal(runner.status(bot.id).state, 'idle')
  assert.deepEqual(
    runner.history(bot.id).messages.map((message) => message.text),
    ['first', system.text, 'second', 'ok:second'],
  )
})

check('an unavailable runtime refuses before anything is queued', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-session-'))
  roots.push(root)
  const bots = openBotStore(root)
  const bot = bots.create({ name: 'Echo Bot', label: 'Echoes messages' })
  const runner = openSessionRunner({
    stateRoot: root,
    runtime: { contract: 1, name: 'off', available: false, async run() { return { text: 'never' } } },
    getBot: bots.get,
  })

  expectCode(() => runner.send(bot.id, 'hello'), ERROR_CODES.runtimeUnavailable)
  assert.equal(runner.status(bot.id), null)
  assert.deepEqual(runner.history(bot.id).messages, [])
  assert.equal(existsSync(path.join(root, 'bots', bot.id, 'session.json')), false)
})

check('invalid messages are refused before a session is written', () => {
  const { bot, runner } = setup(async () => ({ text: 'never' }))
  expectCode(() => runner.send(bot.id, ''), ERROR_CODES.sessionInvalid)
  expectCode(() => runner.send(bot.id, '   '), ERROR_CODES.sessionInvalid)
  expectCode(() => runner.send(bot.id, 'x'.repeat(MESSAGE_MAX_BYTES + 1)), ERROR_CODES.sessionInvalid)
  expectCode(() => runner.send(bot.id, 'bad\u0000text'), ERROR_CODES.sessionInvalid)
  assert.equal(runner.status(bot.id), null)
})

check('the queue cap refuses overflow without dropping queued turns', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { bot, runner } = setup(async ({ text }) => {
    if (text === 'first') await gate
    return { text: `re:${text}` }
  })

  runner.send(bot.id, 'first')
  for (let index = 0; index < QUEUE_MAX; index += 1) runner.send(bot.id, `q${index}`)
  expectCode(() => runner.send(bot.id, 'overflow'), ERROR_CODES.queueFull)
  assert.equal(runner.status(bot.id).pending, QUEUE_MAX)

  release()
  await runner.settled(bot.id)
  const { messages } = runner.history(bot.id)
  assert.equal(messages.length, (QUEUE_MAX + 1) * 2)
  assert.equal(messages.at(-1).text, `re:q${QUEUE_MAX - 1}`)
})

check('a running turn is recovered as interrupted and never replayed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-session-'))
  roots.push(root)
  const bots = openBotStore(root)
  const bot = bots.create({ name: 'Echo Bot', label: 'Echoes messages' })

  const store = openSessionStore(root)
  store.enqueue(bot.id, 'unfinished')
  store.shift(bot.id)

  const reopened = openSessionStore(root)
  reopened.recover()
  const status = reopened.status(bot.id)
  assert.equal(status.state, 'interrupted')
  assert.equal(status.error.code, ERROR_CODES.hostDown)
  const last = reopened.history(bot.id).messages.at(-1)
  assert.equal(last.role, 'system')
  assert.equal(last.code, ERROR_CODES.hostDown)
  assert.match(last.text, /interrupted/)
})

check('a missing transcript is refused, not treated as an empty history', async () => {
  const { root, bot, runner } = setup(async () => ({ text: 'pong' }))
  runner.send(bot.id, 'ping')
  await runner.settled(bot.id)
  rmSync(path.join(root, 'bots', bot.id, 'transcript.jsonl'))
  expectCode(() => runner.history(bot.id), ERROR_CODES.sessionInvalid)
})

check('corrupt session or transcript state fails closed', async () => {
  const first = setup(async () => ({ text: 'pong' }))
  first.runner.send(first.bot.id, 'ping')
  await first.runner.settled(first.bot.id)
  writeFileSync(path.join(first.root, 'bots', first.bot.id, 'session.json'), '{not json')
  expectCode(() => first.runner.status(first.bot.id), ERROR_CODES.sessionInvalid)

  const second = setup(async () => ({ text: 'pong' }))
  second.runner.send(second.bot.id, 'ping')
  await second.runner.settled(second.bot.id)
  appendFileSync(path.join(second.root, 'bots', second.bot.id, 'transcript.jsonl'), '{not json\n')
  expectCode(() => second.runner.history(second.bot.id), ERROR_CODES.sessionInvalid)

  const third = setup(async () => ({ text: 'pong' }))
  third.runner.send(third.bot.id, 'ping')
  await third.runner.settled(third.bot.id)
  appendFileSync(
    path.join(third.root, 'bots', third.bot.id, 'transcript.jsonl'),
    `${JSON.stringify({ seq: 4, at: new Date().toISOString(), role: 'user', text: 'gap' })}\n`,
  )
  expectCode(() => third.runner.history(third.bot.id), ERROR_CODES.sessionInvalid)
})

check('deleting a bot removes its session and transcript', async () => {
  const { root, bots, bot, runner } = setup(async () => ({ text: 'pong' }))
  runner.send(bot.id, 'ping')
  await runner.settled(bot.id)
  assert.equal(existsSync(path.join(root, 'bots', bot.id, 'transcript.jsonl')), true)

  bots.remove(bot.id)
  assert.equal(existsSync(path.join(root, 'bots', bot.id)), false)
  assert.equal(runner.status(bot.id), null)
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

console.log(`${checks.length - failed}/${checks.length} session checks passed`)
if (failed) process.exitCode = 1
