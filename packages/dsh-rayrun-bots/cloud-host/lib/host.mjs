/**
 * Cloud bot host — one process, one serial queue, many bots.
 *
 * The host runs inside a Rayrun machine under a platform `runtimes` entry. It
 * discovers bot roots under `<root>/bots/<botId>/` and processes their inboxes
 * one task at a time in round-robin order. Each bot keeps its own transcript,
 * outbox and DSH session id; the DSH profile is shared. The default agent only
 * echoes; the CLI wires the headless DSH agent.
 *
 * The workspace is writable by the cloud agent. This is queue/session code,
 * not an approval or credential boundary.
 */
import {
  appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync,
  readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  advanceRoutineState, buildRoutinePrompt, dueRoutine, pruneRoutineState, readRoutineFile,
  readRoutineState, writeRoutineState,
} from './routines.mjs'

const BOT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TASK_ID = /^[A-Za-z0-9._-]{1,80}$/
const TASK_MAX_BYTES = 64 * 1024
const TASK_ORIGINS = new Set(['chat', 'routine'])
const ROUTINE_ID = /^routine-[a-z0-9-]{1,60}$/
const ROUTINE_RESULT_KEEP = 200
const SECRET = /(Bearer\s+)\S+|(sk-)[A-Za-z0-9_-]{8,}|((?:RAYRUN_TOKEN|DEEPSEEK_API_KEY|DEEPSEEK_KEY)\s*[=:]\s*)\S+/gi

/**
 * Create one host instance. The caller owns the process lifecycle; this module
 * has no timers, so it can be used from tests.
 * @param {{
 *   root: string,
 *   logPath?: string | null,
 *   credentialPresent?: boolean,
 *   agent?: (input: { botId: string, taskId: string, text: string, origin: string, sessionId: string | null }) => Promise<string | { text: string, sessionId?: string }>,
 *   promptFor?: (input: { botId: string, task: object }) => string,
 *   now?: () => string,
 *   sleep?: (ms: number) => Promise<void>,
 *   taskDelayMs?: number,
 * }} options
 */
export function createCloudHost(options = {}) {
  const {
    root,
    logPath = null,
    credentialPresent = Boolean(process.env.DEEPSEEK_API_KEY),
    agent = async ({ text }) => `echo:${text}`,
    promptFor = null,
    now = () => new Date().toISOString(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    taskDelayMs = 0,
  } = options
  if (typeof root !== 'string' || root.trim() === '') throw new Error('root is required')

  const botsRoot = path.join(root, 'bots')
  const hostDir = path.join(root, 'host')
  const statePath = path.join(hostDir, 'state.json')
  const startedAt = now()
  let lastTask = null
  let lastBot = null
  const routineErrors = new Map()

  const ensure = (dir) => mkdirSync(dir, { recursive: true, mode: 0o700 })

  function botIdOf(value) {
    if (typeof value !== 'string' || !BOT_ID.test(value) || value.length > 64) {
      throw new Error('botId must be a kebab-case path segment')
    }
    return value
  }

  function pathsFor(botId) {
    const id = botIdOf(botId)
    const botRoot = path.join(botsRoot, id)
    return {
      root: botRoot,
      inbox: path.join(botRoot, 'inbox'),
      processing: path.join(botRoot, 'processing'),
      done: path.join(botRoot, 'done'),
      failed: path.join(botRoot, 'failed'),
      outbox: path.join(botRoot, 'outbox'),
      results: path.join(botRoot, 'results'),
      routineResults: path.join(botRoot, 'routine-results'),
      host: path.join(botRoot, 'host'),
      transcript: path.join(botRoot, 'transcript.jsonl'),
      state: path.join(botRoot, 'host', 'state.json'),
      session: path.join(botRoot, 'host', 'session-id'),
    }
  }

  function ensureBot(botId) {
    const paths = pathsFor(botId)
    for (const key of ['inbox', 'processing', 'done', 'failed', 'outbox', 'results', 'routineResults', 'host']) ensure(paths[key])
    return paths
  }

  function listBots() {
    try {
      return readdirSync(botsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && BOT_ID.test(entry.name))
        .map((entry) => entry.name)
        .sort()
    } catch {
      return []
    }
  }

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

  function readSessionId(botId) {
    try {
      const value = readFileSync(pathsFor(botId).session, 'utf8').trim()
      return value === '' ? null : value
    } catch {
      return null
    }
  }

  function writeSessionId(botId, value) {
    if (typeof value === 'string' && value.trim() !== '') atomicText(pathsFor(botId).session, value.trim())
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
      appendFileSync(logPath, `${JSON.stringify({ at: now(), event, ...extra })}\n`, { mode: 0o600 })
    } catch {
      // Logging must not stop the queue; stdout is still captured by the platform.
    }
  }

  function transcript(botId) {
    const file = pathsFor(botId).transcript
    if (!existsSync(file)) return []
    const messages = []
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue
      try {
        messages.push(JSON.parse(line))
      } catch {
        // Ignore a torn last line; the next append writes a complete line.
      }
    }
    return messages
  }

  function hasUser(botId, taskId) {
    return transcript(botId).some((message) => message.role === 'user' && message.taskId === taskId)
  }

  function hasBot(botId, taskId) {
    return transcript(botId).some((message) => message.role === 'bot' && message.replyTo === taskId)
  }

  function appendMessage(botId, role, text, extra = {}) {
    const messages = transcript(botId)
    const seq = messages.reduce((max, message) => Math.max(max, Number(message.seq) || 0), 0) + 1
    const message = { seq, at: now(), role, text, ...extra }
    appendFileSync(pathsFor(botId).transcript, `${JSON.stringify(message)}\n`, { mode: 0o600 })
    return message
  }

  function listInbox(botId) {
    try {
      return readdirSync(pathsFor(botId).inbox)
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

  function pruneRoutineResults(paths) {
    try {
      const entries = readdirSync(paths.routineResults)
        .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
        .map((name) => ({ name, mtime: statSync(path.join(paths.routineResults, name)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime)
      for (const entry of entries.slice(0, Math.max(0, entries.length - ROUTINE_RESULT_KEEP))) {
        try { unlinkSync(path.join(paths.routineResults, entry.name)) } catch { /* best effort */ }
      }
    } catch {
      // Retention must not fail the task.
    }
  }

  function describeBot(botId) {
    const paths = pathsFor(botId)
    const messages = transcript(botId)
    return {
      botId,
      queueDepth: listInbox(botId).length + count(paths.processing),
      processed: count(paths.done),
      sessionId: readSessionId(botId),
      lastSeq: messages.length === 0 ? 0 : messages[messages.length - 1].seq,
    }
  }

  function writeState(state = 'running') {
    const bots = listBots().map(describeBot)
    const value = {
      schema: 1,
      state,
      pid: process.pid,
      startedAt,
      heartbeatAt: now(),
      hasCredential: credentialPresent,
      bots,
      queueDepth: bots.reduce((sum, bot) => sum + bot.queueDepth, 0),
      processed: bots.reduce((sum, bot) => sum + bot.processed, 0),
      lastTask,
      lastBot,
    }
    atomicJson(statePath, value)
    return value
  }

  function recover() {
    ensure(botsRoot)
    ensure(hostDir)
    let moved = 0
    for (const botId of listBots()) {
      ensureBot(botId)
      const paths = pathsFor(botId)
      for (const name of readdirSync(paths.processing)) {
        if (!name.endsWith('.json')) continue
        const from = path.join(paths.processing, name)
        let task = null
        try {
          task = JSON.parse(readFileSync(from, 'utf8'))
        } catch {
          renameSync(from, path.join(paths.failed, `${name}.unreadable-${randomUUID()}`))
          continue
        }
        if (task?.id && hasBot(botId, task.id)) {
          renameSync(from, path.join(paths.done, `${task.id}.json`))
          continue
        }
        renameSync(from, path.join(paths.inbox, `recovered-${randomUUID()}.json`))
        moved += 1
      }
    }
    return moved
  }

  function claim(botId, name) {
    const paths = pathsFor(botId)
    try {
      const to = path.join(paths.processing, name)
      renameSync(path.join(paths.inbox, name), to)
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
    const origin = task.origin === undefined ? 'chat' : task.origin
    if (!TASK_ORIGINS.has(origin)) throw new Error('task.origin is invalid')
    if (task.routineId !== undefined && (typeof task.routineId !== 'string' || !ROUTINE_ID.test(task.routineId))) {
      throw new Error('task.routineId is invalid')
    }
    return {
      id: task.id,
      text: task.text,
      origin,
      ...(task.routineId === undefined ? {} : { routineId: task.routineId }),
    }
  }

  /** Pick the next bot with pending work, round-robin after the last one. */
  function nextTask() {
    const bots = listBots()
    if (bots.length === 0) return null
    const start = lastBot === null ? 0 : (bots.indexOf(lastBot) + 1 + bots.length) % bots.length
    for (let offset = 0; offset < bots.length; offset += 1) {
      const botId = bots[(start + offset) % bots.length]
      const [name] = listInbox(botId)
      if (name) return { botId, name }
    }
    return null
  }

  /** Process one task from any bot; returns `null` when all inboxes are empty. */
  async function processNext() {
    const next = nextTask()
    if (next === null) return null
    const { botId, name } = next
    ensureBot(botId)
    const file = claim(botId, name)
    if (file === null) return null
    const paths = pathsFor(botId)

    let task
    try {
      task = validateTask(JSON.parse(readFileSync(file, 'utf8')))
    } catch (error) {
      renameSync(file, path.join(paths.failed, `${name}.invalid-${randomUUID()}`))
      log('task-invalid', { botId, message: redact(error.message) })
      return { botId, taskId: null, error: redact(error.message) }
    }

    if (hasBot(botId, task.id)) {
      renameSync(file, path.join(paths.done, `${task.id}.json`))
      log('task-skipped', { botId, taskId: task.id })
      return { botId, taskId: task.id, skipped: true }
    }

    if (!hasUser(botId, task.id)) {
      appendMessage(botId, 'user', task.text, {
        taskId: task.id,
        ...(task.origin === 'routine' ? { origin: 'routine' } : {}),
      })
    }
    lastTask = task.id
    lastBot = botId
    log('task-start', { botId, taskId: task.id })
    try {
      if (taskDelayMs > 0) await sleep(taskDelayMs)
      let prompt = task.text
      if (task.origin === 'routine' && typeof promptFor === 'function') {
        prompt = promptFor({ botId, task })
        if (typeof prompt !== 'string' || prompt.trim() === '') {
          throw new Error('routine prompt builder returned no prompt')
        }
      }
      const result = await agent({
        botId,
        taskId: task.id,
        text: prompt,
        origin: task.origin,
        sessionId: readSessionId(botId),
      })
      const reply = typeof result === 'string' ? result : result?.text
      if (typeof reply !== 'string' || reply.trim() === '') throw new Error('agent returned no reply')
      if (result && typeof result === 'object') writeSessionId(botId, result.sessionId)
      appendMessage(botId, 'bot', reply, { replyTo: task.id })
      atomicJson(path.join(paths.outbox, `${task.id}.json`), {
        schema: 1, botId, taskId: task.id, reply, at: now(),
      })
      atomicJson(path.join(paths.results, `${task.id}.json`), {
        schema: 1, botId, taskId: task.id, reply, at: now(),
      })
      if (task.origin === 'routine') {
        atomicJson(path.join(paths.routineResults, `${task.id}.json`), {
          schema: 1,
          botId,
          taskId: task.id,
          text: task.text,
          reply,
          at: now(),
          ...(task.routineId === undefined ? {} : { routineId: task.routineId }),
        })
        pruneRoutineResults(paths)
      }
      renameSync(file, path.join(paths.done, `${task.id}.json`))
      log('task-done', { botId, taskId: task.id })
      writeState()
      return { botId, taskId: task.id, reply }
    } catch (error) {
      renameSync(file, path.join(paths.failed, `${task.id || name}.json`))
      log('task-failed', { botId, taskId: task.id, message: redact(error.message) })
      return { botId, taskId: task.id, error: redact(error.message) }
    }
  }

  /**
   * Enqueue at most one due routine per idle bot. The schedule state is written
   * before the inbox task, so a crash cannot replay the same interval. A bot
   * with queued or in-flight work is left for a later tick.
   */
  function enqueueDueRoutines() {
    const at = now()
    const nowMs = Date.parse(at)
    if (!Number.isFinite(nowMs)) return []
    const enqueued = []
    for (const botId of listBots()) {
      const paths = ensureBot(botId)
      if (listInbox(botId).length + count(paths.processing) > 0) continue
      let routines
      let state
      let due
      try {
        routines = readRoutineFile(root, botId)
        state = pruneRoutineState(readRoutineState(root, botId), routines)
        due = dueRoutine(routines, state, nowMs)
        routineErrors.delete(botId)
      } catch (error) {
        const message = redact(error.message)
        if (routineErrors.get(botId) !== message) {
          routineErrors.set(botId, message)
          log('routine-invalid', { botId, message })
        }
        continue
      }
      if (due === null) continue
      const routine = due.routine
      const taskId = `routine-${randomUUID()}`
      try {
        writeRoutineState(root, botId, advanceRoutineState(state, routine, nowMs))
      } catch (error) {
        log('routine-state-failed', { botId, routineId: routine.id, message: redact(error.message) })
        continue
      }
      try {
        atomicJson(path.join(paths.inbox, `${taskId}.json`), {
          schema: 1,
          id: taskId,
          text: buildRoutinePrompt(routine),
          at,
          origin: 'routine',
          routineId: routine.id,
        })
      } catch (error) {
        // The run is claimed already; do not replay it this interval.
        log('routine-enqueue-failed', { botId, routineId: routine.id, message: redact(error.message) })
        continue
      }
      log('routine-enqueued', { botId, routineId: routine.id, taskId })
      enqueued.push({ botId, routineId: routine.id, taskId })
    }
    return enqueued
  }

  return {
    paths: { root, bots: botsRoot, host: hostDir, state: statePath, log: logPath },
    startedAt,
    listBots,
    pathsFor: ensureBot,
    recover,
    processNext,
    enqueueDueRoutines,
    writeState,
    listInbox,
    log,
  }
}
