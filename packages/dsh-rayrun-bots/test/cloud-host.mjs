/**
 * Multi-bot cloud host checks (plain Node, no framework).
 *
 *   node test/cloud-host.mjs
 */
import assert from 'node:assert/strict'
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCloudHost } from '../cloud-host/lib/host.mjs'

const checks = []
const roots = []
const check = (name, fn) => checks.push({ name, fn })

function makeHost({ agent, credentialPresent = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-cloud-host-'))
  roots.push(root)
  const host = createCloudHost({
    root,
    logPath: path.join(root, 'host.log'),
    credentialPresent,
    agent,
  })
  host.recover()
  return { root, host }
}

function inbox(host, botId, name, task) {
  const paths = host.pathsFor(botId)
  mkdirSync(paths.inbox, { recursive: true })
  writeFileSync(path.join(paths.inbox, name), JSON.stringify(task))
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function messages(host, botId) {
  const file = host.pathsFor(botId).transcript
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

check('processes one task and writes per-bot transcript, outbox and global state', async () => {
  const { host } = makeHost()
  inbox(host, 'bot-a', '0001.json', { id: 't1', text: 'hello' })
  const result = await host.processNext()
  assert.deepEqual(result, { botId: 'bot-a', taskId: 't1', reply: 'echo:hello' })

  const transcript = messages(host, 'bot-a')
  assert.deepEqual(transcript.map((message) => [message.role, message.text]), [
    ['user', 'hello'],
    ['bot', 'echo:hello'],
  ])
  assert.equal(transcript[0].taskId, 't1')
  assert.equal(transcript[1].replyTo, 't1')

  assert.equal(readJson(path.join(host.pathsFor('bot-a').outbox, 't1.json')).reply, 'echo:hello')
  assert.ok(existsSync(path.join(host.pathsFor('bot-a').done, 't1.json')))

  const state = readJson(host.paths.state)
  assert.equal(state.state, 'running')
  assert.equal(state.queueDepth, 0)
  assert.equal(state.processed, 1)
  assert.equal(state.hasCredential, true)
  assert.equal(state.lastBot, 'bot-a')
  assert.equal(state.lastTask, 't1')
  assert.equal(state.bots.length, 1)
  assert.equal(state.bots[0].botId, 'bot-a')
})

check('recovers an in-flight task without duplicating the user message', async () => {
  const { host } = makeHost()
  const paths = host.pathsFor('bot-a')
  mkdirSync(paths.processing, { recursive: true })
  writeFileSync(path.join(paths.processing, '0002.json'), JSON.stringify({ id: 't2', text: 'crash' }))
  appendFileSync(paths.transcript, `${JSON.stringify({
    seq: 1, at: new Date().toISOString(), role: 'user', text: 'crash', taskId: 't2',
  })}\n`)

  assert.equal(host.recover(), 1)
  const result = await host.processNext()
  assert.deepEqual(result, { botId: 'bot-a', taskId: 't2', reply: 'echo:crash' })
  const transcript = messages(host, 'bot-a')
  assert.equal(transcript.filter((message) => message.role === 'user' && message.taskId === 't2').length, 1)
  assert.equal(transcript.filter((message) => message.role === 'bot' && message.replyTo === 't2').length, 1)
})

check('skips a duplicate task id without appending again', async () => {
  const { host } = makeHost()
  inbox(host, 'bot-a', '0001.json', { id: 't1', text: 'hello' })
  await host.processNext()
  const before = messages(host, 'bot-a')
  inbox(host, 'bot-a', '0002.json', { id: 't1', text: 'hello again' })
  const result = await host.processNext()
  assert.deepEqual(result, { botId: 'bot-a', taskId: 't1', skipped: true })
  assert.deepEqual(messages(host, 'bot-a'), before)
})

check('persists an independent DSH session id per bot', async () => {
  const seen = []
  const { host } = makeHost({
    agent: async ({ botId, text, sessionId }) => {
      seen.push({ botId, text, sessionId })
      return { text: `reply:${text}`, sessionId: `session-${botId}` }
    },
  })
  inbox(host, 'alpha', '0001.json', { id: 'a1', text: 'one' })
  inbox(host, 'beta', '0001.json', { id: 'b1', text: 'two' })
  await host.processNext()
  await host.processNext()
  inbox(host, 'alpha', '0002.json', { id: 'a2', text: 'three' })
  await host.processNext()

  assert.deepEqual(seen.map((item) => [item.botId, item.sessionId]), [
    ['alpha', null],
    ['beta', null],
    ['alpha', 'session-alpha'],
  ])
  const state = readJson(host.paths.state)
  const sessions = Object.fromEntries(state.bots.map((bot) => [bot.botId, bot.sessionId]))
  assert.deepEqual(sessions, { alpha: 'session-alpha', beta: 'session-beta' })
  assert.deepEqual(messages(host, 'alpha').map((message) => message.text), ['one', 'reply:one', 'three', 'reply:three'])
  assert.deepEqual(messages(host, 'beta').map((message) => message.text), ['two', 'reply:two'])
})

check('serves multiple bots in round-robin order', async () => {
  const seen = []
  const { host } = makeHost({
    agent: async ({ botId, text }) => {
      seen.push(botId)
      return `ok:${text}`
    },
  })
  inbox(host, 'alpha', '0001.json', { id: 'a1', text: 'a' })
  inbox(host, 'beta', '0001.json', { id: 'b1', text: 'b' })
  await host.processNext()
  await host.processNext()
  assert.deepEqual(seen, ['alpha', 'beta'])
})

check('moves a failing agent task to failed and redacts the log', async () => {
  const secret = 'sk-abcdefghijklmnop'
  const { host } = makeHost({
    agent: async () => {
      throw new Error(`bad ${secret} Bearer supersecretvalue`)
    },
  })
  inbox(host, 'bot-a', '0001.json', { id: 't1', text: 'fail' })
  const result = await host.processNext()
  assert.equal(result.botId, 'bot-a')
  assert.match(result.error, /\[redacted\]/)
  assert.ok(existsSync(path.join(host.pathsFor('bot-a').failed, 't1.json')))
  const log = readFileSync(host.paths.log, 'utf8')
  assert.doesNotMatch(log, new RegExp(secret))
  assert.doesNotMatch(log, /supersecretvalue/)
})

check('a stopped state counts queued work for every bot', () => {
  const { host } = makeHost()
  inbox(host, 'alpha', '0001.json', { id: 'a1', text: 'a' })
  inbox(host, 'beta', '0001.json', { id: 'b1', text: 'b' })
  host.writeState('stopped')
  const state = readJson(host.paths.state)
  assert.equal(state.state, 'stopped')
  assert.equal(state.queueDepth, 2)
  assert.deepEqual(state.bots.map((bot) => [bot.botId, bot.queueDepth]), [['alpha', 1], ['beta', 1]])
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
      console.error(`FAIL ${name}\n     ${String(error?.stack ?? error).split('\n').slice(0, 5).join('\n     ')}`)
    }
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
console.log(`${passed}/${checks.length} cloud host checks passed`)
if (failed > 0) process.exit(1)
