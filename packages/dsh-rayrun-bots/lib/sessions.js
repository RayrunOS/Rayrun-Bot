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
import { ROUTINE_SYNTHETIC_SEQ_BASE, readRoutineResults } from './routine-results.js'

export const SESSION_SCHEMA_VERSION = 1
export const MESSAGE_MAX_BYTES = 16 * 1024
export const QUEUE_MAX = 32
export const HISTORY_DEFAULT_LIMIT = 200
export const HISTORY_MAX_LIMIT = 500
export const SESSION_STATES = Object.freeze(['idle', 'queued', 'running', 'failed', 'interrupted'])
export const SESSION_ORIGINS = Object.freeze(['chat', 'routine'])

/** Control characters that would break one-line JSON or terminal output. */
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const DETACHED_TASK = /^[A-Za-z0-9._-]{1,80}$/
const DETACHED_TIMEOUT_MAX = 3600
const IMAGE_MAX = 128
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

function imageValue(value, field) {
  const image = textOf(value, field)
  if ([...image].length > IMAGE_MAX) fail(`${field} is too long.`, { field })
  return image
}

function originOf(value, field) {
  if (value === undefined || value === 'chat') return undefined
  if (!SESSION_ORIGINS.includes(value)) fail(`${field} is invalid.`, { field })
  return value
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
  const origin = originOf(value.origin, 'message.origin')
  if (origin !== undefined) {
    if (value.role !== 'user') fail('Only a user message may carry an origin.')
    message.origin = origin
  }
  return message
}

function validateQueueItem(value) {
  if (!isObject(value)) fail('A session queue item must be a JSON object.')
  if (!Number.isInteger(value.seq) || value.seq < 1) fail('queue.seq must be a positive integer.')
  const origin = originOf(value.origin, 'queue.origin')
  return {
    seq: value.seq,
    at: isoOf(value.at, 'queue.at'),
    text: textOf(value.text, 'queue.text'),
    ...(origin === undefined ? {} : { origin }),
  }
}

function validateDetached(value) {
  if (!isObject(value)) fail('detached must be an object.')
  if (typeof value.taskId !== 'string' || !DETACHED_TASK.test(value.taskId)) {
    fail('detached.taskId is invalid.', { field: 'detached.taskId' })
  }
  const sandbox = textOf(value.sandbox, 'detached.sandbox')
  if (!path.isAbsolute(String(value.localDir ?? ''))) fail('detached.localDir must be absolute.', { field: 'detached.localDir' })
  const localDir = String(value.localDir)
  if (CONTROL.test(localDir)) fail('detached.localDir contains control characters.', { field: 'detached.localDir' })
  if (!Number.isInteger(value.timeoutSeconds) || value.timeoutSeconds < 1 || value.timeoutSeconds > DETACHED_TIMEOUT_MAX) {
    fail(`detached.timeoutSeconds must be an integer from 1 through ${DETACHED_TIMEOUT_MAX}.`, { field: 'detached.timeoutSeconds' })
  }
  const image = value.image === undefined ? undefined : imageValue(value.image, 'detached.image')
  return {
    taskId: value.taskId,
    sandbox,
    localDir,
    startedAt: isoOf(value.startedAt, 'detached.startedAt'),
    timeoutSeconds: value.timeoutSeconds,
    ...(image === undefined ? {} : { image }),
  }
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
  const detached = value.detached === undefined ? undefined : validateDetached(value.detached)
  const computer = value.computer === undefined ? undefined : textOf(value.computer, 'computer')
  const image = value.image === undefined ? undefined : imageValue(value.image, 'image')
  return {
    schema: SESSION_SCHEMA_VERSION,
    botId,
    sessionId: value.sessionId,
    state: value.state,
    lastSeq: value.lastSeq,
    queue,
    createdAt,
    updatedAt,
    ...(computer === undefined ? {} : { computer }),
    ...(image === undefined ? {} : { image }),
    ...(detached === undefined ? {} : { detached }),
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
    ...(session.computer === undefined ? {} : { computer: session.computer }),
    ...(session.image === undefined ? {} : { image: session.image }),
    ...(session.detached === undefined ? {} : {
      detached: { taskId: session.detached.taskId, startedAt: session.detached.startedAt },
    }),
    ...(session.error === undefined ? {} : { error: session.error }),
  }
}

function computerField(session) {
  return session.computer === undefined ? {} : { computer: session.computer }
}

function imageField(session) {
  return session.image === undefined ? {} : { image: session.image }
}

/** An image annotation on a failure, or undefined when it is absent or unusable. */
function notedImage(error) {
  if (typeof error?.image !== 'string') return undefined
  try {
    return imageValue(error.image, 'image')
  } catch {
    return undefined
  }
}

/** A computer name annotation on a failure, or undefined when it is absent or unusable. */
function notedComputer(error) {
  if (typeof error?.computer !== 'string') return undefined
  try {
    return textOf(error.computer, 'computer')
  } catch {
    return undefined
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

function routineMessages(stateRoot, botId) {
  const results = readRoutineResults(stateRoot, botId)
  return results.flatMap((result, index) => {
    const user = {
      seq: ROUTINE_SYNTHETIC_SEQ_BASE + index * 2,
      at: result.at,
      role: 'user',
      text: result.text,
      origin: 'routine',
    }
    const reply = result.state === 'failed'
      ? {
          seq: ROUTINE_SYNTHETIC_SEQ_BASE + index * 2 + 1,
          at: result.at,
          role: 'system',
          code: ERROR_CODES.routineFailed,
          text: result.error,
        }
      : {
          seq: ROUTINE_SYNTHETIC_SEQ_BASE + index * 2 + 1,
          at: result.at,
          role: 'bot',
          text: result.reply,
        }
    return [user, reply]
  })
}

function pageMessages(messages, { after, limit, tail }) {
  const filtered = messages.filter((message) => message.seq > after)
  return tail ? filtered.slice(-limit) : filtered.slice(0, limit)
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
    const routine = routineMessages(root, botId)
    if (session === null) {
      return { session: null, messages: pageMessages(routine, { after, limit, tail }) }
    }
    const local = readTranscript(root, botId)
    const last = local.length === 0 ? 0 : local[local.length - 1].seq
    if (last !== session.lastSeq) {
      fail(`transcript.jsonl for ${botId} is out of sync with session.json.`)
    }
    const all = [...local, ...routine].sort((a, b) => (
      a.at.localeCompare(b.at) || a.seq - b.seq
    ))
    return {
      session: publicSession(session),
      messages: pageMessages(all, { after, limit, tail }),
    }
  }

  function enqueue(id, text, { now = Date.now(), origin = 'chat' } = {}) {
    const botId = assertBotId(id)
    if (!botExists(botId)) {
      const error = new Error(`Unknown bot: ${botId}.`)
      error.code = ERROR_CODES.botUnknown
      throw error
    }
    const at = isoNow(now)
    const content = textOf(text)
    const messageOrigin = originOf(origin, 'origin') ?? 'chat'
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
    const message = {
      seq: session.lastSeq + 1,
      at,
      role: 'user',
      text: content,
      ...(messageOrigin === 'chat' ? {} : { origin: messageOrigin }),
    }
    appendMessage(root, botId, message)
    const next = {
      schema: SESSION_SCHEMA_VERSION,
      botId,
      sessionId: session.sessionId,
      state: 'queued',
      lastSeq: message.seq,
      queue: [
        ...session.queue,
        { seq: message.seq, at, text: content, ...(messageOrigin === 'chat' ? {} : { origin: messageOrigin }) },
      ],
      createdAt: session.createdAt,
      updatedAt: at,
      ...computerField(session),
      ...imageField(session),
      ...(session.detached === undefined ? {} : { detached: session.detached }),
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
      ...computerField(session),
      ...imageField(session),
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
      ...computerField(session),
      ...imageField(session),
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
    const noted = notedImage(error)
    const computer = notedComputer(error)
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
      ...(computer === undefined ? computerField(session) : { computer }),
      ...(noted === undefined ? imageField(session) : { image: noted }),
      error: { code, message: detail },
    }
    writeSession(root, next)
    return { session: publicSession(next), message }
  }

  /** Record the cloud task id for a turn that outlives this host process. */
  function attach(id, detached, { now = Date.now() } = {}) {
    const botId = assertBotId(id)
    const session = load(botId)
    if (session === null) fail(`session for ${botId} disappeared before the detached task was attached.`)
    if (session.state !== 'running' && session.state !== 'queued') {
      fail(`session for ${botId} is not running; cannot attach a detached task.`)
    }
    const at = isoNow(now)
    const record = validateDetached({ ...detached, startedAt: detached?.startedAt ?? at })
    const next = {
      schema: SESSION_SCHEMA_VERSION,
      botId,
      sessionId: session.sessionId,
      state: session.state,
      lastSeq: session.lastSeq,
      queue: session.queue,
      createdAt: session.createdAt,
      updatedAt: at,
      computer: record.sandbox,
      ...(record.image === undefined ? imageField(session) : { image: record.image }),
      detached: record,
    }
    writeSession(root, next)
    return publicSession(next)
  }

  /** The full detached task record for the runner, or null. */
  function detached(id) {
    const session = load(id)
    return session?.detached ?? null
  }

  /** The last machine this bot ran on, if known. */
  function computer(id) {
    return load(id)?.computer ?? null
  }

  /** The last known image for this bot's computer, if one was recorded. */
  function image(id) {
    return load(id)?.image ?? null
  }

  /** Sessions whose cloud task must be resumed by this host process. */
  function detachedSessions() {
    const botsRoot = path.join(root, 'bots')
    if (!existsSync(botsRoot)) return []
    const sessions = []
    for (const entry of readdirSync(botsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const botId = assertBotId(entry.name)
      const session = load(botId)
      if (session?.detached !== undefined) {
        sessions.push({ botId, state: session.state, detached: session.detached })
      }
    }
    return sessions
  }

  /** Complete a detached turn only if it is still the session's current task. */
  function finishDetached(id, taskId, text, { now = Date.now() } = {}) {
    const botId = assertBotId(id)
    const session = load(botId)
    if (session === null) fail(`session for ${botId} disappeared before the detached result arrived.`)
    if (session.detached === undefined || session.detached.taskId !== taskId) return null
    return complete(botId, text, { now })
  }

  /** Fail a detached turn only if it is still the session's current task. */
  function failDetached(id, taskId, error, { now = Date.now() } = {}) {
    const botId = assertBotId(id)
    const session = load(botId)
    if (session === null) fail(`session for ${botId} disappeared before the detached error arrived.`)
    if (session.detached === undefined || session.detached.taskId !== taskId) return null
    return failTurn(botId, error, { now })
  }

  /**
   * Reconcile state left by a previous host process. A turn that was running
   * cannot be proven complete, so it becomes `interrupted` and is never
   * replayed automatically. A detached turn is the exception: its cloud task
   * still exists, so it stays running and the runner resumes polling. Queued
   * turns stay queued for the next send.
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
      if (session.detached !== undefined) continue
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
          ...computerField(session),
          ...imageField(session),
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
          ...computerField(session),
          ...imageField(session),
        })
      }
    }
  }

  return {
    status, history, enqueue, shift, complete, failTurn, recover,
    attach, detached, detachedSessions, finishDetached, failDetached, computer, image,
  }
}

/**
 * Run queued turns for all bots, one turn at a time per bot.
 *
 * The runtime is the only place a bot turn executes. A missing or unavailable
 * runtime fails the send before anything is queued, so the page never gets a
 * fake reply. A failure after queueing becomes a `failed` session with a
 * redacted system line; the next send resumes the remaining queue.
 * @param {{ stateRoot: string, runtime: object, getBot: (id: string) => object, logger?: object, detachedPollMs?: number }} options
 */
export const DEFAULT_DETACHED_POLL_MS = 1000

export function openSessionRunner({ stateRoot, runtime, getBot, logger, detachedPollMs = DEFAULT_DETACHED_POLL_MS } = {}) {
  if (typeof getBot !== 'function') throw new TypeError('getBot is required.')
  const store = openSessionStore(stateRoot)
  store.recover()
  const active = new Map()
  const detachedPolls = new Map()
  const acceptances = new Map()
  const pollDelay = Number.isInteger(detachedPollMs) && detachedPollMs > 0 ? detachedPollMs : DEFAULT_DETACHED_POLL_MS

  function detachedCapable() {
    return runtime.available === true
      && runtime.detached === true
      && typeof runtime.start === 'function'
      && typeof runtime.status === 'function'
      && typeof runtime.collect === 'function'
  }

  /** Resolve the sender's acceptance promise after the runtime attaches or fails. */
  function settleAcceptance(botId, seq, error) {
    const key = `${botId}:${seq}`
    const pending = acceptances.get(key)
    if (pending) {
      acceptances.delete(key)
      if (error) pending.reject(error)
      else pending.resolve(store.status(botId))
    }
    if (!error) return
    // A failed turn leaves the rest queued, not accepted. Do not leave callers
    // waiting for a later kick that may never come.
    for (const [pendingKey, waiter] of acceptances) {
      if (!pendingKey.startsWith(`${botId}:`)) continue
      acceptances.delete(pendingKey)
      waiter.reject(error)
    }
  }

  function kick(botId) {
    if (detachedPolls.has(botId)) return undefined
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
        if (detachedCapable()) {
          const started = await runtime.start({
            bot,
            text: next.item.text,
            history: messages,
            sessionId: next.session.sessionId,
            messageSeq: next.item.seq,
            origin: next.item.origin,
            botId,
            stateRoot,
            rememberedImage: store.image(botId),
            rememberedComputer: store.computer(botId),
          })
          if (typeof started?.taskId !== 'string' || started.taskId.trim() === ''
            || typeof started?.sandbox !== 'string' || started.sandbox.trim() === ''
            || typeof started?.localDir !== 'string' || started.localDir.trim() === ''
            || !Number.isInteger(started?.timeoutSeconds)) {
            const error = new Error('The detached runtime returned an invalid task.')
            error.code = ERROR_CODES.internal
            throw error
          }
          store.attach(botId, started)
          startDetachedPoll(botId, started.taskId)
          settleAcceptance(botId, next.item.seq, null)
          return
        }
        const reply = await runtime.run({
          bot,
          text: next.item.text,
          history: messages,
          sessionId: next.session.sessionId,
          messageSeq: next.item.seq,
          origin: next.item.origin,
        })
        if (typeof reply?.text !== 'string' || reply.text.trim() === '') {
          const error = new Error('The runtime returned no text.')
          error.code = ERROR_CODES.internal
          throw error
        }
        store.complete(botId, reply.text)
      } catch (error) {
        try {
          store.failTurn(botId, error)
        } finally {
          settleAcceptance(botId, next.item.seq, error)
        }
        return
      }
    }
  }

  function startDetachedPoll(botId, taskId) {
    if (detachedPolls.has(botId)) return
    let resolveDone
    const done = new Promise((resolve) => { resolveDone = resolve })
    const record = { taskId, cancelled: false, timer: null, failures: 0, done, resolveDone }
    detachedPolls.set(botId, record)

    const stop = () => {
      if (record.cancelled) return
      record.cancelled = true
      if (record.timer) clearTimeout(record.timer)
      detachedPolls.delete(botId)
      resolveDone()
    }
    const schedule = (delay = pollDelay) => {
      if (!record.cancelled) record.timer = setTimeout(tick, delay)
    }
    const tick = async () => {
      if (record.cancelled) return
      const detached = store.detached(botId)
      if (detached === null || detached.taskId !== taskId) {
        stop()
        return
      }
      const deadline = Date.parse(detached.startedAt) + detached.timeoutSeconds * 1000 + 5 * 60_000
      if (Date.now() > deadline) {
        const error = new Error('The detached cloud task did not finish in time; nothing was stored.')
        error.code = ERROR_CODES.internal
        store.failDetached(botId, taskId, error)
        stop()
        return
      }
      try {
        const state = await runtime.status({ detached })
        if (record.cancelled) return
        if (state?.running === true) {
          record.failures = 0
          schedule()
          return
        }
        if (state?.running !== false) {
          const error = new Error('The detached runtime returned no running state.')
          error.code = ERROR_CODES.internal
          throw error
        }
        const collected = await runtime.collect({ detached })
        if (record.cancelled) return
        if (collected?.running === true) {
          record.failures = 0
          schedule()
          return
        }
        if (typeof collected?.text !== 'string' || collected.text.trim() === '') {
          const error = new Error('The detached task finished without a reply.')
          error.code = ERROR_CODES.internal
          throw error
        }
        const finished = store.finishDetached(botId, taskId, collected.text)
        stop()
        if (finished !== null) kick(botId)
      } catch (error) {
        if (record.cancelled) return
        record.failures += 1
        if (error?.code === ERROR_CODES.machineStopped
          || error?.code === ERROR_CODES.tokenRequired
          || error?.code === ERROR_CODES.imageUnsupported
          || error?.code === ERROR_CODES.workerNoReply
          || record.failures >= 3) {
          store.failDetached(botId, taskId, error)
          stop()
          return
        }
        schedule()
      }
    }
    schedule()
  }

  function resumeDetached() {
    const pending = store.detachedSessions()
    if (pending.length === 0) return
    if (!detachedCapable()) {
      for (const item of pending) {
        const error = new Error('The detached runtime is unavailable; the cloud task cannot be collected.')
        error.code = ERROR_CODES.runtimeUnavailable
        store.failDetached(item.botId, item.detached.taskId, error)
      }
      return
    }
    for (const item of pending) startDetachedPoll(item.botId, item.detached.taskId)
  }

  function enqueueTurn(botId, text, options, waitForAcceptance) {
    if (runtime.available !== true) {
      const error = new Error('The cloud bot runtime is not wired in this build; no turn was sent.')
      error.code = ERROR_CODES.runtimeUnavailable
      throw error
    }
    const before = store.status(botId)
    const idle = !active.has(botId)
      && !detachedPolls.has(botId)
      && (before === null || (
        before.pending === 0
        && (before.state === 'idle' || before.state === 'failed' || before.state === 'interrupted')
      ))
    const result = store.enqueue(botId, text, options)
    let accepted
    if (waitForAcceptance && detachedCapable() && idle) {
      accepted = new Promise((resolve, reject) => {
        acceptances.set(`${botId}:${result.message.seq}`, { resolve, reject })
      })
    }
    try {
      kick(botId)
    } catch (error) {
      settleAcceptance(botId, result.message.seq, error)
      throw error
    }
    return { result, accepted }
  }

  /** Queue one turn without waiting; used by routines and the scheduler. */
  function send(botId, text, options = {}) {
    return enqueueTurn(botId, text, options, false).result
  }

  /**
   * Queue one turn and, when the bot is idle, resolve only after a detached
   * runtime has attached the cloud task. Callers can treat that as the point
   * after which closing the page/laptop no longer loses the turn.
   */
  async function sendAccepted(botId, text, options = {}) {
    const { result, accepted } = enqueueTurn(botId, text, options, true)
    if (accepted === undefined) return result
    const session = await accepted
    return { session, message: result.message }
  }

  async function settled(botId) {
    for (;;) {
      const job = active.get(botId)
      if (job) {
        await job
        continue
      }
      const poll = detachedPolls.get(botId)
      if (poll) {
        await poll.done
        continue
      }
      return
    }
  }

  function close() {
    for (const record of detachedPolls.values()) {
      record.cancelled = true
      if (record.timer) clearTimeout(record.timer)
      record.resolveDone()
    }
    detachedPolls.clear()
  }

  resumeDetached()

  return {
    send,
    sendAccepted,
    status: (botId) => store.status(botId),
    history: (botId, options) => store.history(botId, options),
    computer: (botId) => store.computer(botId),
    settled,
    close,
  }
}
