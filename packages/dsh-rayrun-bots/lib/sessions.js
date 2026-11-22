/**
 * Durable per-bot session state and transcript.
 *
 * A turn is queued here before a runtime adapter runs it, so a message is not
 * lost when the page closes or the host restarts. The transcript is append-only
 * JSONL; the session file is written atomically. Both live beside `bot.json`,
 * so deleting a bot removes its session too. Corrupt state fails closed with
 * `E_SESSION_INVALID` instead of being skipped.
 *
 * The transcript is chronological: a user message is appended when it is
 * accepted, even if an earlier turn is still running. The runtime receives the
 * turn to answer as `text`; `history` is context and may include later queued
 * messages.
 *
 * The runtime adapter executes one turn; the transcript stays local until a
 * cloud session mirror exists. `session.json` and `transcript.jsonl` are the
 * only copy of a bot's conversation.
 */
import { Buffer } from 'node:buffer'
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { assertBotId } from './bot-schema.js'
import { ERROR_CODES } from './errors.js'
import { writeJsonAtomic } from './local-store.js'

export const SESSION_SCHEMA_VERSION = 1
export const MESSAGE_MAX_BYTES = 16 * 1024
export const QUEUE_MAX = 32
export const HISTORY_DEFAULT_LIMIT = 200
export const HISTORY_MAX_LIMIT = 500
export const SESSION_STATES = Object.freeze(['idle', 'queued', 'running', 'failed', 'interrupted'])

/** Control characters that would break one-line JSON or terminal output. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
/** Credential shapes that must never enter the transcript through an error line. */
const SECRET = /(Bearer\s+)[A-Za-z0-9._~+/=-]+|(sk-)[A-Za-z0-9_-]{16,}|((?:RAYRUN_TOKEN|DEEPSEEK_API_KEY|DEEPSEEK_KEY)\s*[=:]\s*)\S+/gi

/** A rejected session operation. `field` names the offending input when known. */
export class SessionError extends Error {
  constructor(code, message, { field } = {}) {
    super(message)
    this.name = 'SessionError'
    this.code = code
    if (field) this.field = field
  }
}

const fail = (message, options) => { throw new SessionError(ERROR_CODES.sessionInvalid, message, options) }
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Keep credential-shaped text out of a persisted error line. */
function redact(value) {
  return String(value ?? '')
    .replace(SECRET, (match, bearer, sk, assignment) => {
      if (bearer) return `${bearer}[redacted]`
      if (sk) return `${sk}[redacted]`
      return `${assignment}[redacted]`
    })
    .slice(0, 1000)
}

function isoOf(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail(`${field} must be an ISO 8601 timestamp.`, { field })
  }
  return value
}

function isoNow(now) {
  const date = new Date(now)
  if (Number.isNaN(date.getTime())) fail('now must be a valid date.', { field: 'now' })
  return date.toISOString()
}

function textOf(value, field = 'text') {
  if (typeof value !== 'string') fail(`${field} must be a string.`, { field })
  const result = value.trim()
  if (result === '') fail(`${field} is required.`, { field })
  if (CONTROL.test(result)) fail(`${field} contains control characters.`, { field })
  if (Buffer.byteLength(result, 'utf8') > MESSAGE_MAX_BYTES) {
    fail(`${field} exceeds ${MESSAGE_MAX_BYTES} bytes.`, { field })
  }
  return result
}

function validateMessage(value) {
  if (!isObject(value)) fail('A transcript message must be a JSON object.')
  if (!Number.isInteger(value.seq) || value.seq < 1) fail('message.seq must be a positive integer.')
  const at = isoOf(value.at, 'message.at')
  if (!['user', 'bot', 'system'].includes(value.role)) fail('message.role is invalid.')
  const text = textOf(value.text, 'message.text')
  const message = { seq: value.seq, at, role: value.role, text }
  if (value.role === 'system') {
    if (typeof value.code !== 'string' || !value.code.startsWith('E_')) {
      fail('A system message must carry an error code.')
    }
    message.code = value.code
  }
  return message
}

function validateQueueItem(value) {
  if (!isObject(value)) fail('A session queue item must be a JSON object.')
  if (!Number.isInteger(value.seq) || value.seq < 1) fail('queue.seq must be a positive integer.')
  return { seq: value.seq, at: isoOf(value.at, 'queue.at'), text: textOf(value.text, 'queue.text') }
}

function validateSession(value, botId) {
  if (!isObject(value)) fail('session.json must be a JSON object.')
  if (value.schema !== SESSION_SCHEMA_VERSION) fail('Unsupported session schema.')
  if (value.botId !== botId) fail('session.json belongs to a different bot.')
  if (typeof value.sessionId !== 'string' || value.sessionId.trim() === '') fail('sessionId is required.')
  if (!SESSION_STATES.includes(value.state)) fail('Session state is invalid.')
  if (!Number.isInteger(value.lastSeq) || value.lastSeq < 0) fail('lastSeq must be a non-negative integer.')
  if (!Array.isArray(value.queue) || value.queue.length > QUEUE_MAX) fail('Session queue is invalid.')
  const queue = value.queue.map(validateQueueItem)
  const seen = new Set()
  for (const item of queue) {
    if (item.seq > value.lastSeq) fail('Session queue points past lastSeq.')
    if (seen.has(item.seq)) fail('Session queue repeats a sequence.')
    seen.add(item.seq)
  }
  const createdAt = isoOf(value.createdAt, 'createdAt')
  const updatedAt = isoOf(value.updatedAt, 'updatedAt')
  if (value.error !== undefined) {
    if (!isObject(value.error)) fail('Session error must be an object.')
    if (typeof value.error.code !== 'string' || !value.error.code.startsWith('E_')) {
      fail('Session error code is invalid.')
    }
    if (typeof value.error.message !== 'string') fail('Session error message is invalid.')
  }
  return {
    schema: SESSION_SCHEMA_VERSION,
    botId,
    sessionId: value.sessionId,
    state: value.state,
    lastSeq: value.lastSeq,
    queue,
    createdAt,
    updatedAt,
    ...(value.error === undefined ? {} : { error: { code: value.error.code, message: value.error.message } }),
  }
}

function publicSession(session) {
  return {
    schema: session.schema,
    botId: session.botId,
    sessionId: session.sessionId,
    state: session.state,
    lastSeq: session.lastSeq,
    pending: session.queue.length,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.error === undefined ? {} : { error: session.error }),
  }
}

function readSession(stateRoot, botId) {
  const file = path.join(stateRoot, 'bots', botId, 'session.json')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    fail(`session.json for ${botId} is not valid JSON.`)
  }
  return validateSession(value, botId)
}

function writeSession(stateRoot, session) {
  writeJsonAtomic(path.join(stateRoot, 'bots', session.botId, 'session.json'), session)
}

function appendMessage(stateRoot, botId, message) {
  appendFileSync(path.join(stateRoot, 'bots', botId, 'transcript.jsonl'), `${JSON.stringify(message)}\n`, {
    mode: 0o600,
  })
}

function readTranscript(stateRoot, botId) {
  const file = path.join(stateRoot, 'bots', botId, 'transcript.jsonl')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const messages = []
  let previous = 0
  for (const line of lines) {
    if (line.trim() === '') fail(`transcript.jsonl for ${botId} contains a blank line.`)
    let value
    try {
      value = JSON.parse(line)
    } catch {
      fail(`transcript.jsonl for ${botId} is not valid JSON.`)
    }
    const message = validateMessage(value)
    if (message.seq !== previous + 1) fail(`transcript.jsonl for ${botId} has a sequence gap.`)
    previous = message.seq
    messages.push(message)
  }
  return messages
}

/**
 * Open the session store under one state directory.
 * @param {string} stateRoot Absolute directory that also holds `bots/`.
 */
export function openSessionStore(stateRoot) {
  const root = path.resolve(stateRoot)

  function botDirectory(id) {
    return path.join(root, 'bots', assertBotId(id))
  }

  function load(id) {
    return readSession(root, assertBotId(id))
  }

  function botExists(id) {
    return existsSync(path.join(botDirectory(id), 'bot.json'))
  }

  function status(id) {
    const session = load(id)
    return session === null ? null : publicSession(session)
  }

  function history(id, { after = 0, limit = HISTORY_DEFAULT_LIMIT, tail = false } = {}) {
    const botId = assertBotId(id)
    if (!Number.isInteger(after) || after < 0) fail('after must be a non-negative integer.', { field: 'after' })
    if (!Number.isInteger(limit) || limit < 1 || limit > HISTORY_MAX_LIMIT) {
      fail(`limit must be an integer from 1 through ${HISTORY_MAX_LIMIT}.`, { field: 'limit' })
    }
    if (typeof tail !== 'boolean') fail('tail must be a boolean.', { field: 'tail' })
    const session = load(botId)
    if (session === null) return { session: null, messages: [] }
    const all = readTranscript(root, botId)
    const last = all.length === 0 ? 0 : all[all.length - 1].seq
    if (last !== session.lastSeq) {
      fail(`transcript.jsonl for ${botId} is out of sync with session.json.`)
    }
    const filtered = all.filter((message) => message.seq > after)
    const messages = tail ? filtered.slice(-limit) : filtered.slice(0, limit)
    return { session: publicSession(session), messages }
  }

  function enqueue(id, text, { now = Date.now() } = {}) {
    const botId = assertBotId(id)
    if (!botExists(botId)) {
      const error = new Error(`Unknown bot: ${botId}.`)
      error.code = ERROR_CODES.botUnknown
      throw error
    }
    const at = isoNow(now)
    const content = textOf(text)
    let session = load(botId)
    if (session === null) {
      session = {
        schema: SESSION_SCHEMA_VERSION,
        botId,
        sessionId: randomUUID(),
        state: 'idle',
        lastSeq: 0,
        queue: [],
        createdAt: at,
        updatedAt: at,
      }
    }
    if (session.queue.length >= QUEUE_MAX) {
      const error = new Error(`This bot already has ${QUEUE_MAX} messages queued; wait for a reply.`)
      error.code = ERROR_CODES.queueFull
      throw error
    }
    const message = { seq: session.lastSeq + 1, at, role: 'user', text: content }
    appendMessage(root, botId, message)
    const next = {
      schema: SESSION_SCHEMA_VERSION,
      botId,
      sessionId: session.sessionId,
      state: 'queued',
      lastSeq: message.seq,
      queue: [...session.queue, { seq: message.seq, at, text: content }],
      createdAt: session.createdAt,
      updatedAt: at,
    }
    writeSession(root, next)
    return { session: publicSession(next), message }
  }

  function shift(id, { now = Date.now() } = {}) {
    const botId = assertBotId(id)
    const session = load(botId)
    if (session === null || session.queue.length === 0) return null
    const at = isoNow(now)
    const item = session.queue[0]
    const next = {
      schema: SESSION_SCHEMA_VERSION,
      botId,
      sessionId: session.sessionId,
      state: 'running',
      lastSeq: session.lastSeq,
      queue: session.queue.slice(1),
      createdAt: session.createdAt,
      updatedAt: at,
    }
    writeSession(root, next)
    return { session: publicSession(next), item }
  }

  function complete(id, text, { now = Date.now() } = {}) {
    const botId = assertBotId(id)
    const session = load(botId)
    if (session === null) fail(`session for ${botId} disappeared before the reply was written.`)
    const at = isoNow(now)
    const message = { seq: session.lastSeq + 1, at, role: 'bot', text: textOf(text) }
    appendMessage(root, botId, message)
    const next = {
      schema: SESSION_SCHEMA_VERSION,
      botId,
      sessionId: session.sessionId,
      state: session.queue.length === 0 ? 'idle' : 'queued',
      lastSeq: message.seq,
      queue: session.queue,
      createdAt: session.createdAt,
      updatedAt: at,
    }
    writeSession(root, next)
    return { session: publicSession(next), message }
  }

  function failTurn(id, error, { now = Date.now() } = {}) {
    const botId = assertBotId(id)
    const session = load(botId)
    if (session === null) fail(`session for ${botId} disappeared before the error was written.`)
    const at = isoNow(now)
    const code = typeof error?.code === 'string' && error.code.startsWith('E_')
      ? error.code
      : ERROR_CODES.internal
    const detail = redact(error?.message ?? error) || 'The turn failed.'
    const message = { seq: session.lastSeq + 1, at, role: 'system', code, text: detail }
    appendMessage(root, botId, message)
    const next = {
      schema: SESSION_SCHEMA_VERSION,
      botId,
      sessionId: session.sessionId,
      state: 'failed',
      lastSeq: message.seq,
      queue: session.queue,
      createdAt: session.createdAt,
      updatedAt: at,
      error: { code, message: detail },
    }
    writeSession(root, next)
    return { session: publicSession(next), message }
  }

  /**
   * Reconcile state left by a previous host process. A turn that was running
   * cannot be proven complete, so it becomes `interrupted` and is never
   * replayed automatically. Queued turns stay queued for the next send.
   */
  function recover() {
    const botsRoot = path.join(root, 'bots')
    if (!existsSync(botsRoot)) return
    for (const entry of readdirSync(botsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const botId = assertBotId(entry.name)
      let session
      try {
        session = load(botId)
      } catch (error) {
        error.message = `${botId}: ${error.message}`
        throw error
      }
      if (session === null) continue
      if (session.state === 'running') {
        const messages = readTranscript(root, botId)
        const last = messages.length === 0 ? 0 : messages[messages.length - 1].seq
        if (last !== session.lastSeq) {
          fail(`transcript.jsonl for ${botId} is out of sync with session.json.`)
        }
        const at = new Date().toISOString()
        const detail = 'The previous turn was interrupted by a host restart; send it again.'
        const message = { seq: session.lastSeq + 1, at, role: 'system', code: ERROR_CODES.hostDown, text: detail }
        appendMessage(root, botId, message)
        writeSession(root, {
          schema: SESSION_SCHEMA_VERSION,
          botId,
          sessionId: session.sessionId,
          state: 'interrupted',
          lastSeq: message.seq,
          queue: session.queue,
          createdAt: session.createdAt,
          updatedAt: at,
          error: { code: ERROR_CODES.hostDown, message: detail },
        })
      } else if (session.state === 'queued' && session.queue.length === 0) {
        writeSession(root, {
          schema: SESSION_SCHEMA_VERSION,
          botId,
          sessionId: session.sessionId,
          state: 'idle',
          lastSeq: session.lastSeq,
          queue: [],
          createdAt: session.createdAt,
          updatedAt: new Date().toISOString(),
        })
      }
    }
  }

  return { status, history, enqueue, shift, complete, failTurn, recover }
}

/**
 * Run queued turns for all bots, one turn at a time per bot.
 *
 * The runtime is the only place a bot turn executes. A missing or unavailable
 * runtime fails the send before anything is queued, so the page never gets a
 * fake reply. A failure after queueing becomes a `failed` session with a
 * redacted system line; the next send resumes the remaining queue.
 * @param {{ stateRoot: string, runtime: object, getBot: (id: string) => object, logger?: object }} options
 */
export function openSessionRunner({ stateRoot, runtime, getBot, logger } = {}) {
  if (typeof getBot !== 'function') throw new TypeError('getBot is required.')
  const store = openSessionStore(stateRoot)
  store.recover()
  const active = new Map()

  function kick(botId) {
    if (active.has(botId)) return active.get(botId)
    const job = drain(botId)
      .catch((error) => {
        logger?.warn?.(`session ${botId}: ${redact(error?.message ?? error)}`)
      })
      .finally(() => {
        active.delete(botId)
      })
    active.set(botId, job)
    return job
  }

  async function drain(botId) {
    for (;;) {
      const next = store.shift(botId)
      if (next === null) return
      try {
        const bot = getBot(botId)
        // Give the runtime the most recent window, not the oldest one.
        const { messages } = store.history(botId, { limit: HISTORY_MAX_LIMIT, tail: true })
        const reply = await runtime.run({
          bot,
          text: next.item.text,
          history: messages,
          sessionId: next.session.sessionId,
          messageSeq: next.item.seq,
        })
        if (typeof reply?.text !== 'string' || reply.text.trim() === '') {
          const error = new Error('The runtime returned no text.')
          error.code = ERROR_CODES.internal
          throw error
        }
        store.complete(botId, reply.text)
      } catch (error) {
        store.failTurn(botId, error)
        return
      }
    }
  }

  function send(botId, text) {
    if (runtime.available !== true) {
      const error = new Error('The cloud bot runtime is not wired in this build; no turn was sent.')
      error.code = ERROR_CODES.runtimeUnavailable
      throw error
    }
    const result = store.enqueue(botId, text)
    kick(botId)
    return result
  }

  return {
    send,
    status: (botId) => store.status(botId),
    history: (botId, options) => store.history(botId, options),
    settled: (botId) => active.get(botId) ?? Promise.resolve(),
  }
}
