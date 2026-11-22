/**
 * Cloud bot host POC checks (plain Node, no framework).
 *
 *   node tools/cloud-host-poc/test/host.mjs
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
    botId: 'demo',
    logPath: path.join(root, 'host.log'),
    credentialPresent,
    agent,
  })
  host.recover()
  return { root, host }
}

function inbox(root, name, task) {
  mkdirSync(path.join(root, 'inbox'), { recursive: true })
  writeFileSync(path.join(root, 'inbox', name), JSON.stringify(task))
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function messages(root) {
  const file = path.join(root, 'transcript.jsonl')
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

check('processes one task and writes transcript, outbox and state', async () => {
  const { root, host } = makeHost()
  inbox(root, '0001.json', { id: 't1', text: 'hello' })
  const result = await host.processNext()
  assert.deepEqual(result, { taskId: 't1', reply: 'echo:hello' })

  const transcript = messages(root)
  assert.deepEqual(transcript.map((message) => [message.role, message.text]), [
    ['user', 'hello'],
    ['bot', 'echo:hello'],
  ])
  assert.equal(transcript[0].taskId, 't1')
  assert.equal(transcript[1].replyTo, 't1')
  assert.equal(transcript[1].seq, 2)

  assert.equal(readJson(path.join(root, 'outbox', 't1.json')).reply, 'echo:hello')
  assert.equal(readJson(path.join(root, 'results', 't1.json')).reply, 'echo:hello')
  assert.ok(existsSync(path.join(root, 'done', 't1.json')))

  const state = readJson(host.paths.state)
  assert.equal(state.state, 'running')
  assert.equal(state.processed, 1)
  assert.equal(state.queueDepth, 0)
  assert.equal(state.hasCredential, true)
  assert.equal(state.lastTask, 't1')
  assert.equal(state.lastSeq, 2)
})

check('recovers a task that was in flight without duplicating the user message', async () => {
  const { root, host } = makeHost()
  mkdirSync(path.join(root, 'processing'), { recursive: true })
  writeFileSync(path.join(root, 'processing', '0002.json'), JSON.stringify({ id: 't2', text: 'crash' }))
  appendFileSync(path.join(root, 'transcript.jsonl'), `${JSON.stringify({
    seq: 1, at: new Date().toISOString(), role: 'user', text: 'crash', taskId: 't2',
  })}\n`)

  assert.equal(host.recover(), 1)
  const result = await host.processNext()
  assert.deepEqual(result, { taskId: 't2', reply: 'echo:crash' })
  const transcript = messages(root)
  assert.equal(transcript.filter((message) => message.role === 'user' && message.taskId === 't2').length, 1)
  assert.equal(transcript.filter((message) => message.role === 'bot' && message.replyTo === 't2').length, 1)
})

check('skips a duplicate task id without appending again', async () => {
  const { root, host } = makeHost()
  inbox(root, '0001.json', { id: 't1', text: 'hello' })
  await host.processNext()
  const before = messages(root)
  inbox(root, '0002.json', { id: 't1', text: 'hello again' })
  const result = await host.processNext()
  assert.deepEqual(result, { taskId: 't1', skipped: true })
  assert.deepEqual(messages(root), before)
  assert.equal(readJson(path.join(root, 'outbox', 't1.json')).reply, 'echo:hello')
})

check('persists the agent session id and passes it to the next task', async () => {
  const seen = []
  const { root, host } = makeHost({
    agent: async ({ text, sessionId }) => {
      seen.push(sessionId)
      return { text: `reply:${text}`, sessionId: 'session-host-1' }
    },
  })
  inbox(root, '0001.json', { id: 't1', text: 'first' })
  await host.processNext()
  inbox(root, '0002.json', { id: 't2', text: 'second' })
  await host.processNext()
  assert.deepEqual(seen, [null, 'session-host-1'])
  assert.equal(readJson(host.paths.state).sessionId, 'session-host-1')
  assert.equal(readFileSync(path.join(root, 'host', 'session-id'), 'utf8').trim(), 'session-host-1')
})

check('moves a failing agent task to failed and redacts the log', async () => {
  const secret = 'sk-abcdefghijklmnop'
  const { root, host } = makeHost({
    agent: async () => {
      throw new Error(`bad ${secret} Bearer supersecretvalue`)
    },
  })
  inbox(root, '0001.json', { id: 't1', text: 'fail' })
  const result = await host.processNext()
  assert.equal(result.taskId, 't1')
  assert.match(result.error, /\[redacted\]/)
  assert.ok(existsSync(path.join(root, 'failed', 't1.json')))
  const log = readFileSync(path.join(root, 'host.log'), 'utf8')
  assert.doesNotMatch(log, new RegExp(secret))
  assert.doesNotMatch(log, /supersecretvalue/)
})

check('a stopped state is written without losing the queue', async () => {
  const { root, host } = makeHost()
  inbox(root, '0001.json', { id: 't1', text: 'queued' })
  host.writeState('stopped')
  const state = readJson(host.paths.state)
  assert.equal(state.state, 'stopped')
  assert.equal(state.queueDepth, 1)
  assert.equal(state.processed, 0)
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

console.log(`${passed}/${checks.length} cloud host POC checks passed`)
if (failed > 0) process.exit(1)
