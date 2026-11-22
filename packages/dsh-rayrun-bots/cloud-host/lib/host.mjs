/**
 * Cloud bot host POC — queue, transcript, heartbeat and a pluggable agent.
 *
 * This is a proof of concept, not the shipped cloud runtime. It runs inside a
 * Rayrun machine under a platform `runtimes` entry. The default agent only
 * echoes; a later slice replaces it with a DSH session. The host owns state
 * under `<root>` and writes one heartbeat/state file; it never reads the
 * Rayrun token.
 */
import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, writeSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const TASK_ID = /^[A-Za-z0-9._-]{1,80}$/
const TASK_MAX_BYTES = 64 * 1024
const SECRET = /(Bearer\s+)\S+|(sk-)[A-Za-z0-9_-]{8,}|((?:RAYRUN_TOKEN|DEEPSEEK_API_KEY|DEEPSEEK_KEY)\s*[=:]\s*)\S+/gi

/**
 * Create one host instance. The caller owns the process lifecycle; this module
 * has no timers, so it can be used from tests.
 * @param {{
 *   root: string,
 *   botId?: string,
 *   logPath?: string | null,
 *   credentialPresent?: boolean,
 *   agent?: (input: { taskId: string, text: string, sessionId: string | null }) => Promise<string | { text: string, sessionId?: string }>,
 *   now?: () => string,
 *   sleep?: (ms: number) => Promise<void>,
 *   taskDelayMs?: number,
 * }} options
 */
export function createCloudHost(options = {}) {
  const {
    root,
    botId = 'demo',
    logPath = null,
    credentialPresent = Boolean(process.env.DEEPSEEK_API_KEY),
    agent = async ({ text }) => `echo:${text}`,
    now = () => new Date().toISOString(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    taskDelayMs = 0,
  } = options
  if (typeof root !== 'string' || root.trim() === '') throw new Error('root is required')
  if (!TASK_ID.test(botId)) throw new Error('botId must be a safe path segment')

  const dirs = {
    inbox: path.join(root, 'inbox'),
    processing: path.join(root, 'processing'),
    done: path.join(root, 'done'),
    failed: path.join(root, 'failed'),
    outbox: path.join(root, 'outbox'),
    results: path.join(root, 'results'),
    host: path.join(root, 'host'),
  }
  const transcriptPath = path.join(root, 'transcript.jsonl')
  const statePath = path.join(dirs.host, 'state.json')
  const sessionPath = path.join(dirs.host, 'session-id')
  const startedAt = now()
  let lastTask = null

  const ensure = (dir) => mkdirSync(dir, { recursive: true, mode: 0o700 })

  function atomicJson(file, value) {
    ensure(path.dirname(file))
    const temp = `${file}.tmp-${randomUUID()}`
    const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    const fd = openSync(temp, 'wx', 0o600)
    try {
      let offset = 0
      while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, file)
  }

  function atomicText(file, value) {
    ensure(path.dirname(file))
    const temp = `${file}.tmp-${randomUUID()}`
    const data = Buffer.from(`${value}\n`, 'utf8')
    const fd = openSync(temp, 'wx', 0o600)
    try {
      let offset = 0
      while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temp, file)
  }

  function readSessionId() {
    try {
      const value = readFileSync(sessionPath, 'utf8').trim()
      return value === '' ? null : value
    } catch {
      return null
    }
  }

  function writeSessionId(value) {
    if (typeof value === 'string' && value.trim() !== '') atomicText(sessionPath, value.trim())
  }

  function redact(value) {
    return String(value ?? '').replace(SECRET, (_match, bearer, openai, assignment) => {
      if (bearer) return `${bearer}[redacted]`
      if (openai) return '[redacted]'
      return `${assignment}[redacted]`
    }).slice(0, 300)
  }

  function log(event, extra = {}) {
    if (logPath === null) return
    try {
      ensure(path.dirname(logPath))
      appendFileSync(logPath, `${JSON.stringify({ at: now(), event, botId, ...extra })}\n`, { mode: 0o600 })
    } catch {
      // Logging must not stop the queue; stdout is still captured by the platform.
    }
  }

  function transcript() {
    if (!existsSync(transcriptPath)) return []
    const messages = []
    for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
      if (!line) continue
      try {
        messages.push(JSON.parse(line))
      } catch {
        // Ignore a torn last line; the next append writes a complete line.
      }
    }
    return messages
  }

  function hasUser(taskId) {
    return transcript().some((message) => message.role === 'user' && message.taskId === taskId)
  }

  function hasBot(taskId) {
    return transcript().some((message) => message.role === 'bot' && message.replyTo === taskId)
  }

  function appendMessage(role, text, extra = {}) {
    const messages = transcript()
    const seq = messages.reduce((max, message) => Math.max(max, Number(message.seq) || 0), 0) + 1
    const message = { seq, at: now(), role, text, ...extra }
    appendFileSync(transcriptPath, `${JSON.stringify(message)}\n`, { mode: 0o600 })
    return message
  }

  function listInbox() {
    try {
      return readdirSync(dirs.inbox)
        .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
        .sort()
    } catch {
      return []
    }
  }

  function count(dir) {
    try {
      return readdirSync(dir).filter((name) => name.endsWith('.json')).length
    } catch {
      return 0
    }
  }

  function writeState(state = 'running') {
    const messages = transcript()
    const value = {
      schema: 1,
      botId,
      state,
      pid: process.pid,
      startedAt,
      heartbeatAt: now(),
      processed: count(dirs.done),
      queueDepth: listInbox().length + count(dirs.processing),
      hasCredential: credentialPresent,
      sessionId: readSessionId(),
      lastSeq: messages.length === 0 ? 0 : messages[messages.length - 1].seq,
      lastTask,
    }
    atomicJson(statePath, value)
    return value
  }

  function recover() {
    for (const dir of Object.values(dirs)) ensure(dir)
    let moved = 0
    for (const name of readdirSync(dirs.processing)) {
      if (!name.endsWith('.json')) continue
      const from = path.join(dirs.processing, name)
      let task = null
      try {
        task = JSON.parse(readFileSync(from, 'utf8'))
      } catch {
        renameSync(from, path.join(dirs.failed, `${name}.unreadable-${randomUUID()}`))
        continue
      }
      if (task?.id && hasBot(task.id)) {
        renameSync(from, path.join(dirs.done, `${task.id}.json`))
        continue
      }
      renameSync(from, path.join(dirs.inbox, `recovered-${randomUUID()}.json`))
      moved += 1
    }
    return moved
  }

  function claim(name) {
    try {
      const to = path.join(dirs.processing, name)
      renameSync(path.join(dirs.inbox, name), to)
      return to
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  function validateTask(task) {
    if (typeof task?.id !== 'string' || !TASK_ID.test(task.id)) throw new Error('task.id is invalid')
    if (typeof task?.text !== 'string' || task.text.trim() === '') throw new Error('task.text is required')
    if (Buffer.byteLength(task.text, 'utf8') > TASK_MAX_BYTES) throw new Error('task.text is too large')
    return { id: task.id, text: task.text }
  }

  /** Process the first inbox task; returns `null` when the inbox is empty. */
  async function processNext() {
    const [name] = listInbox()
    if (!name) return null
    const file = claim(name)
    if (file === null) return null

    let task
    try {
      task = validateTask(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      renameSync(file, path.join(dirs.failed, `${name}.invalid-${randomUUID()}`))
      log('task-invalid', { message: redact(error.message) })
      return { taskId: null, error: redact(error.message) }
    }

    if (hasBot(task.id)) {
      renameSync(file, path.join(dirs.done, `${task.id}.json`))
      log('task-skipped', { taskId: task.id })
      return { taskId: task.id, skipped: true }
    }

    if (!hasUser(task.id)) appendMessage('user', task.text, { taskId: task.id })
    lastTask = task.id
    log('task-start', { taskId: task.id })
    try {
      if (taskDelayMs > 0) await sleep(taskDelayMs)
      const sessionId = readSessionId()
      const result = await agent({ taskId: task.id, text: task.text, sessionId })
      const reply = typeof result === 'string' ? result : result?.text
      if (typeof reply !== 'string' || reply.trim() === '') throw new Error('agent returned no reply')
      if (result && typeof result === 'object') writeSessionId(result.sessionId)
      appendMessage('bot', reply, { replyTo: task.id })
      atomicJson(path.join(dirs.outbox, `${task.id}.json`), {
        schema: 1, botId, taskId: task.id, reply, at: now(),
      })
      atomicJson(path.join(dirs.results, `${task.id}.json`), {
        schema: 1, taskId: task.id, reply, at: now(),
      })
      renameSync(file, path.join(dirs.done, `${task.id}.json`))
      log('task-done', { taskId: task.id })
      writeState()
      return { taskId: task.id, reply }
    } catch (error) {
      renameSync(file, path.join(dirs.failed, `${task.id || name}.json`))
      log('task-failed', { taskId: task.id, message: redact(error.message) })
      return { taskId: task.id, error: redact(error.message) }
    }
  }

  return {
    paths: { ...dirs, transcript: transcriptPath, state: statePath },
    startedAt,
    recover,
    processNext,
    writeState,
    listInbox,
    log,
  }
}
