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
import { buildRoutinePrompt } from './prompt.mjs'
import {
  advanceRoutineState, buildRoutinePrompt as buildRoutinePromptForTask, dueRoutine, pruneRoutineState,
  readRoutineFile, readRoutineState, writeRoutineState,
} from './routines.mjs'

const BOT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const TASK_ID = /^[A-Za-z0-9._-]{1,80}$/
const TASK_MAX_BYTES = 64 * 1024
const TASK_ORIGINS = new Set(['chat', 'routine'])
const ROUTINE_ID = /^routine-[a-z0-9-]{1,60}$/
const ROUTINE_RESULT_KEEP = 200
const DELEGATION_MAX_WORKERS = 8
const DELEGATION_MAX_BYTES = 64 * 1024
const ROSTER_FIELDS = new Set(['id', 'name', 'label', 'instructions'])
const INSTRUCTIONS_MAX_BYTES = 8 * 1024
const DELEGATION_DEADLINE_MS = 10 * 60 * 1000
const DELEGATE_TASK_MAX_BYTES = 8 * 1024
const DELEGATION_KEEP = 200
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const SECRET = /(Bearer\s+)\S+|(sk-)[A-Za-z0-9_-]{8,}|((?:RAYRUN_TOKEN|DEEPSEEK_API_KEY|DEEPSEEK_KEY)\s*[=:]\s*)\S+/gi

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Bound the primary task's delegation metadata. Unknown fields, a missing
 * worker field, duplicates and oversize input fail the whole task closed.
 */
function delegationOf(value, botId) {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('task.delegation must be an object')
  }
  if (Object.keys(value).length !== 2 || value.primary !== true || !Array.isArray(value.roster)) {
    throw new Error('task.delegation must contain primary:true and a roster')
  }
  if (value.roster.length === 0 || value.roster.length > DELEGATION_MAX_WORKERS) {
    throw new Error('task.delegation.roster is empty or too large')
  }
  const seen = new Set()
  const roster = value.roster.map((worker) => {
    if (typeof worker !== 'object' || worker === null || Array.isArray(worker)) {
      throw new Error('task.delegation.roster entry must be an object')
    }
    for (const key of Object.keys(worker)) {
      if (!ROSTER_FIELDS.has(key)) throw new Error('task.delegation.roster entry has unknown fields')
    }
    for (const key of ROSTER_FIELDS) {
      if (typeof worker[key] !== 'string') {
        throw new Error(`task.delegation.roster entry needs ${key}`)
      }
    }
    if (worker.id === '' || worker.name.trim() === '' || worker.label.trim() === '') {
      throw new Error('task.delegation.roster entry needs id, name and label')
    }
    if (!BOT_ID.test(worker.id) || worker.id.length > 64) {
      throw new Error('task.delegation.roster entry id is invalid')
    }
    if (worker.id === botId) throw new Error('task.delegation.roster must not contain the primary bot')
    if ([...worker.name].length > 80 || /[\u0000-\u001f\u007f]/.test(worker.name)) {
      throw new Error('task.delegation.roster entry name is invalid')
    }
    if ([...worker.label].length > 120 || /[\u0000-\u001f\u007f]/.test(worker.label)) {
      throw new Error('task.delegation.roster entry label is invalid')
    }
    if (Buffer.byteLength(worker.instructions, 'utf8') > INSTRUCTIONS_MAX_BYTES
      || CONTROL.test(worker.instructions)) {
      throw new Error('task.delegation.roster entry instructions are invalid')
    }
    if (seen.has(worker.id)) throw new Error('task.delegation.roster entry id is duplicated')
    seen.add(worker.id)
    return { id: worker.id, name: worker.name, label: worker.label, instructions: worker.instructions }
  })
  if (Buffer.byteLength(JSON.stringify({ primary: true, roster }), 'utf8') > DELEGATION_MAX_BYTES) {
    throw new Error('task.delegation is too large')
  }
  return { primary: true, roster }
}

function delegateBlocks(text) {
  return [...String(text ?? '').matchAll(/```rayrun-delegate\s*\r?\n([\s\S]*?)\r?\n```/g)]
}

function stripDelegateBlocks(text) {
  return String(text ?? '').replace(/```rayrun-delegate\s*\r?\n[\s\S]*?\r?\n```/g, '').trim()
}

/**
 * Parse the single delegation block from a primary reply. Any malformed,
 * duplicated or unknown target request is reported and never executed.
 */
function parseDelegation(reply, roster) {
  const text = String(reply ?? '')
  const matches = delegateBlocks(text)
  if (matches.length === 0) return { text, worker: null, task: null, error: null }
  const cleaned = stripDelegateBlocks(text)
  if (matches.length > 1) {
    return { text: cleaned, worker: null, task: null, error: 'the reply contains more than one delegation block' }
  }
  let value
  try {
    value = JSON.parse(matches[0][1].trim())
  } catch {
    return { text: cleaned, worker: null, task: null, error: 'the delegation block is not valid JSON' }
  }
  if (!isObject(value)) {
    return { text: cleaned, worker: null, task: null, error: 'the delegation block must be an object' }
  }
  const keys = Object.keys(value)
  if (keys.length !== 2 || !keys.includes('bot') || !keys.includes('task')) {
    return { text: cleaned, worker: null, task: null, error: 'the delegation block must contain only "bot" and "task"' }
  }
  if (typeof value.bot !== 'string' || typeof value.task !== 'string' || value.task.trim() === '') {
    return { text: cleaned, worker: null, task: null, error: 'the delegation target and task are required' }
  }
  if (Buffer.byteLength(value.task, 'utf8') > DELEGATE_TASK_MAX_BYTES) {
    return { text: cleaned, worker: null, task: null, error: 'the delegated task is too large' }
  }
  const worker = roster.find((entry) => entry.id === value.bot)
  if (worker === undefined) {
    return { text: cleaned, worker: null, task: null, error: 'the delegation target is not in the teammate roster' }
  }
  return { text: cleaned, worker, task: value.task.trim(), error: null }
}

/**
 * Create one host instance. The caller owns the process lifecycle; this module
 * has no timers, so it can be used from tests.
 * @param {{
 *   root: string,
 *   logPath?: string | null,
 *   credentialPresent?: boolean,
 *   machine?: string,
 *   agent?: (input: { botId: string, taskId: string, text: string, origin: string, sessionId: string | null, approvalBotId?: string }) => Promise<string | { text: string, sessionId?: string, approval?: object }>,
 *   promptFor?: (input: { botId: string, task: object }) => string,
 *   now?: () => string,
 *   sleep?: (ms: number) => Promise<void>,
 *   taskDelayMs?: number,
 *   delegationDeadlineMs?: number,
 * }} options
 */
export function createCloudHost(options = {}) {
  const {
    root,
    logPath = null,
    credentialPresent = Boolean(process.env.DEEPSEEK_API_KEY),
    machine = '',
    agent = async ({ text }) => `echo:${text}`,
    promptFor = null,
    now = () => new Date().toISOString(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    taskDelayMs = 0,
    delegationDeadlineMs = DELEGATION_DEADLINE_MS,
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
      delegations: path.join(botRoot, 'delegations'),
      host: path.join(botRoot, 'host'),
      transcript: path.join(botRoot, 'transcript.jsonl'),
      state: path.join(botRoot, 'host', 'state.json'),
      session: path.join(botRoot, 'host', 'session-id'),
    }
  }

  function ensureBot(botId) {
    const paths = pathsFor(botId)
    for (const key of ['inbox', 'processing', 'done', 'failed', 'outbox', 'results', 'routineResults', 'delegations', 'host']) ensure(paths[key])
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

  function readDelegation(botId, name) {
    try {
      return JSON.parse(readFileSync(path.join(pathsFor(botId).delegations, name), 'utf8'))
    } catch {
      return null
    }
  }

  function findDelegation(botId, primaryTaskId) {
    try {
      for (const name of readdirSync(pathsFor(botId).delegations)) {
        if (!name.endsWith('.json') || name.startsWith('.')) continue
        const record = readDelegation(botId, name)
        if (record?.primaryTaskId === primaryTaskId) return record
      }
    } catch {
      // No delegation records yet.
    }
    return null
  }

  function writeDelegation(record) {
    record.updatedAt = now()
    atomicJson(path.join(pathsFor(record.primaryBotId).delegations, `${record.id}.json`), record)
    pruneDelegations(record.primaryBotId)
  }

  function pruneDelegations(botId) {
    try {
      const dir = pathsFor(botId).delegations
      const terminal = []
      for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json') || name.startsWith('.')) continue
        const record = readDelegation(botId, name)
        if (!isObject(record) || record.state === 'running') continue
        // Keep a record until its primary task has an outbox; recovery needs it.
        if (typeof record.primaryTaskId !== 'string'
          || !existsSync(path.join(pathsFor(botId).outbox, `${record.primaryTaskId}.json`))) continue
        terminal.push({ name, mtime: statSync(path.join(dir, name)).mtimeMs })
      }
      if (terminal.length <= DELEGATION_KEEP) return
      terminal.sort((a, b) => a.mtime - b.mtime)
      for (const entry of terminal.slice(0, terminal.length - DELEGATION_KEEP)) {
        try { unlinkSync(path.join(dir, entry.name)) } catch { /* best effort */ }
      }
    } catch {
      // Retention must not fail the task.
    }
  }

  /**
   * Run one agent turn and persist the DSH session id. `visible` appends the
   * reply to the bot transcript; callers write task results so a primary's
   * intermediate reply can stay out of the user-visible transcript.
   */
  async function runTurn(botId, task, {
    prompt, sessionId = readSessionId(botId), visible = true, approvalBotId, suppressApproval = false,
  } = {}) {
    const agentStartedAt = Date.now()
    let result
    try {
      result = await agent({
        botId,
        taskId: task.id,
        text: prompt,
        origin: task.origin,
        sessionId,
        ...(approvalBotId === undefined ? {} : { approvalBotId }),
        ...(suppressApproval ? { approvalDisabled: true } : {}),
      })
    } catch (error) {
      log('turn-failed', { botId, taskId: task.id, ms: Date.now() - agentStartedAt })
      throw error
    }
    const agentMs = Date.now() - agentStartedAt
    const reply = typeof result === 'string' ? result : result?.text
    if (typeof reply !== 'string' || reply.trim() === '') throw new Error('agent returned no reply')
    if (result && typeof result === 'object') writeSessionId(botId, result.sessionId)
    if (visible) appendMessage(botId, 'bot', reply, { replyTo: task.id })
    log('turn-done', {
      botId,
      taskId: task.id,
      ms: agentMs,
      visible,
      ...(isObject(result?.approval) ? { approval: true } : {}),
    })
    return {
      reply,
      approval: isObject(result?.approval) ? result.approval : null,
    }
  }

  function writeResult(botId, task, reply) {
    const paths = pathsFor(botId)
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
  }

  function deadlineError() {
    const error = new Error('the delegation chain exceeded its deadline')
    error.code = 'E_DELEGATION_DEADLINE'
    return error
  }

  async function withinDeadline(deadline, start) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw deadlineError()
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(start),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(deadlineError()), remaining)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  function workerPrompt(worker, text) {
    return buildRoutinePrompt({
      bot: { name: worker.name, label: worker.label, instructions: worker.instructions },
      text,
      machine,
    })
  }

  function summaryPrompt(worker, record, outcome) {
    const name = worker?.name?.trim() || record.targetBotId
    const lines = [
      `You asked teammate ${name} (${record.targetBotId}) to do this task:`,
      record.task,
      '',
    ]
    if (outcome === 'waiting-approval') {
      const action = record.approval
        ? `${record.approval.kind}${record.approval.machine ? ` on ${record.approval.machine}` : ''}`
        : 'an action'
      lines.push(
        `They are waiting for the user's approval for ${action}.`,
        'Their reply:',
        String(record.reply ?? '').trim().slice(0, 16 * 1024),
      )
    } else if (outcome === 'failed') {
      const detail = String(record.error ?? '').trim().replace(/\.$/, '')
      lines.push(detail
        ? `The teammate failed before completing the task: ${detail}.`
        : 'The teammate failed before completing the task.')
    } else {
      lines.push('Their reply:', String(record.reply ?? '').trim().slice(0, 16 * 1024))
    }
    lines.push(
      '',
      `Reply to the user with the final result. Do not delegate again and do not include a rayrun-delegate block. Do not claim more than the teammate result supports.${outcome === 'waiting-approval' ? ' The approval request has already been submitted; do not include a rayrun-approval block.' : ''}`,
    )
    return lines.join('\n')
  }

  function fallbackReply(worker, record, outcome) {
    const name = worker?.name?.trim() || record.targetBotId
    const lines = []
    if (outcome === 'waiting-approval') {
      const action = record.approval
        ? `${record.approval.kind}${record.approval.machine ? ` on ${record.approval.machine}` : ''}`
        : 'the requested action'
      lines.push(`${name} is waiting for your approval for ${action}.`)
      if (record.reply) lines.push('', 'Their reply:', String(record.reply).trim().slice(0, 8 * 1024))
    } else if (outcome === 'failed') {
      const detail = String(record.error ?? '').trim().replace(/\.$/, '')
      lines.push(detail
        ? `The delegated task to ${name} failed: ${detail}.`
        : `The delegated task to ${name} failed.`)
      if (record.reply) lines.push('', 'Their reply:', String(record.reply).trim().slice(0, 8 * 1024))
    } else {
      lines.push(`${name} finished the delegated task.`)
      if (record.reply) lines.push('', 'Their reply:', String(record.reply).trim().slice(0, 8 * 1024))
      lines.push('', 'The final summary could not be produced.')
    }
    return lines.join('\n')
  }

  /** Run the primary's final summarising turn; never rerun the worker. */
  async function runSummary(botId, task, record, roster, deadline) {
    const worker = roster.find((entry) => entry.id === record.targetBotId)
    const outcome = record.workerState ?? (record.state === 'running' ? 'done' : record.state)
    record.workerState = outcome
    record.state = 'running'
    record.phase = 'summary'
    writeDelegation(record)
    let reply = null
    try {
      const result = await withinDeadline(deadline, () => runTurn(botId, task, {
        prompt: summaryPrompt(worker, record, outcome),
        sessionId: readSessionId(botId),
        visible: false,
        // The host already turned the worker's block into a primary proposal;
        // a second block in the summary would create a duplicate card.
        suppressApproval: outcome === 'waiting-approval',
      }))
      const stripped = stripDelegateBlocks(result.reply)
      if (stripped !== result.reply) {
        log('delegation-ignored', { botId, taskId: task.id, delegationId: record.id, phase: 'summary' })
      }
      if (stripped !== '') reply = stripped
    } catch (error) {
      log('delegation-summary-failed', {
        botId, taskId: task.id, delegationId: record.id, message: redact(error.message),
      })
    }
    if (reply === null) reply = fallbackReply(worker, record, outcome)
    if (outcome === 'waiting-approval') {
      const action = record.approval
        ? `${record.approval.kind}${record.approval.machine ? ` on ${record.approval.machine}` : ''}`
        : 'the requested action'
      reply = `${reply}\n\nApproval needed: ${action}. Waiting for your decision.`
    }
    record.state = outcome
    record.phase = 'summary'
    record.finalReply = reply
    writeDelegation(record)
    return { reply }
  }

  /**
   * Run one primary task through at most one worker delegation and one
   * summarising primary turn. Worker side effects are never replayed after a
   * restart; the record decides whether only the summary is retried.
   */
  async function runDelegatedTask(botId, task, prompt) {
    const roster = task.delegation.roster
    const deadline = Date.now() + delegationDeadlineMs
    let record = findDelegation(botId, task.id)

    if (record !== null) {
      const worker = roster.find((entry) => entry.id === record.targetBotId)
      if (record.state === 'running' && record.phase === 'worker') {
        record.state = 'failed'
        record.errorCode = 'E_DELEGATION_INTERRUPTED'
        record.error = 'the cloud host restarted while the teammate was working'
        writeDelegation(record)
        log('delegation-interrupted', { botId, taskId: task.id, delegationId: record.id })
        return { reply: fallbackReply(worker, record, 'failed') }
      }
      if (typeof record.finalReply === 'string' && record.finalReply.trim() !== '') {
        return { reply: record.finalReply }
      }
      if (record.state === 'waiting-approval') {
        return { reply: fallbackReply(worker, record, 'waiting-approval') }
      }
      if ((record.state === 'done' && record.phase === 'worker')
        || (record.state === 'running' && record.phase === 'summary')
        || record.state === 'failed') {
        return runSummary(botId, task, record, roster, deadline)
      }
      throw new Error('delegation record is invalid')
    }

    const first = await withinDeadline(deadline, () => runTurn(botId, task, {
      prompt,
      sessionId: readSessionId(botId),
      visible: false,
    }))
    const parsed = parseDelegation(first.reply, roster)
    if (parsed.error !== null) {
      log('delegation-invalid', { botId, taskId: task.id, message: redact(parsed.error) })
      const notice = `The delegation request was not executed: ${parsed.error}.`
      return { reply: parsed.text === '' ? notice : `${parsed.text}\n\n${notice}` }
    }
    if (parsed.worker === null) return { reply: first.reply }

    const worker = parsed.worker
    record = {
      schema: 1,
      id: `delegation-${randomUUID()}`,
      primaryTaskId: task.id,
      primaryBotId: botId,
      targetBotId: worker.id,
      state: 'running',
      phase: 'worker',
      task: parsed.task,
      createdAt: now(),
      updatedAt: now(),
    }
    writeDelegation(record)
    log('delegation-start', { botId, taskId: task.id, delegationId: record.id, targetBotId: worker.id })

    const workerTask = { id: record.id, origin: 'chat', text: parsed.task }
    ensureBot(worker.id)
    if (!hasUser(worker.id, record.id)) appendMessage(worker.id, 'user', parsed.task, { taskId: record.id })
    let outcome
    try {
      const workerResult = await withinDeadline(deadline, () => runTurn(worker.id, workerTask, {
        prompt: workerPrompt(worker, parsed.task),
        sessionId: readSessionId(worker.id),
        approvalBotId: botId,
      }))
      record.reply = workerResult.reply
      if (workerResult.approval) {
        record.approval = {
          kind: String(workerResult.approval.kind ?? ''),
          machine: String(workerResult.approval.machine ?? ''),
        }
        record.state = 'waiting-approval'
      } else {
        record.state = 'done'
      }
      outcome = record.state
      writeResult(worker.id, workerTask, workerResult.reply)
    } catch (error) {
      record.state = 'failed'
      record.errorCode = typeof error?.code === 'string' ? error.code : 'E_DELEGATION_WORKER'
      record.error = redact(error.message) || 'the teammate turn failed'
      outcome = 'failed'
    }
    writeDelegation(record)
    log(`delegation-${outcome}`, { botId, taskId: task.id, delegationId: record.id, targetBotId: worker.id })
    return runSummary(botId, task, record, roster, deadline)
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

  function validateTask(task, botId) {
    if (typeof task?.id !== 'string' || !TASK_ID.test(task.id)) throw new Error('task.id is invalid')
    if (typeof task?.text !== 'string' || task.text.trim() === '') throw new Error('task.text is required')
    if (Buffer.byteLength(task.text, 'utf8') > TASK_MAX_BYTES) throw new Error('task.text is too large')
    const origin = task.origin === undefined ? 'chat' : task.origin
    if (!TASK_ORIGINS.has(origin)) throw new Error('task.origin is invalid')
    if (task.routineId !== undefined && (typeof task.routineId !== 'string' || !ROUTINE_ID.test(task.routineId))) {
      throw new Error('task.routineId is invalid')
    }
    const delegation = delegationOf(task.delegation, botId)
    return {
      id: task.id,
      text: task.text,
      origin,
      ...(task.routineId === undefined ? {} : { routineId: task.routineId }),
      ...(delegation === undefined ? {} : { delegation }),
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
      task = validateTask(JSON.parse(readFileSync(file, 'utf8')), botId)
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
    const taskStartedAt = Date.now()
    try {
      if (taskDelayMs > 0) await sleep(taskDelayMs)
      let prompt = task.text
      if (task.origin === 'routine' && typeof promptFor === 'function') {
        prompt = promptFor({ botId, task })
        if (typeof prompt !== 'string' || prompt.trim() === '') {
          throw new Error('routine prompt builder returned no prompt')
        }
      }
      const result = task.delegation === undefined
        ? await runTurn(botId, task, { prompt, sessionId: readSessionId(botId) })
        : await runDelegatedTask(botId, task, prompt)
      const reply = result.reply
      if (task.delegation !== undefined) appendMessage(botId, 'bot', reply, { replyTo: task.id })
      writeResult(botId, task, reply)
      renameSync(file, path.join(paths.done, `${task.id}.json`))
      log('task-done', { botId, taskId: task.id, ms: Date.now() - taskStartedAt })
      writeState()
      return { botId, taskId: task.id, reply }
    } catch (error) {
      if (task.origin === 'routine') {
        try {
          atomicJson(path.join(paths.routineResults, `${task.id}.json`), {
            schema: 1,
            botId,
            taskId: task.id,
            text: task.text,
            at: now(),
            state: 'failed',
            error: redact(error.message) || 'The routine turn failed.',
            ...(task.routineId === undefined ? {} : { routineId: task.routineId }),
          })
          pruneRoutineResults(paths)
        } catch (writeError) {
          log('routine-result-failed', { botId, taskId: task.id, message: redact(writeError.message) })
        }
      }
      if (task.origin !== 'routine') {
        try {
          atomicJson(path.join(paths.outbox, `${task.id}.json`), {
            schema: 1,
            botId,
            taskId: task.id,
            error: redact(error.message) || 'The cloud bot host failed the turn.',
            at: now(),
          })
        } catch (writeError) {
          log('outbox-failed', { botId, taskId: task.id, message: redact(writeError.message) })
        }
      }
      renameSync(file, path.join(paths.failed, `${task.id || name}.json`))
      log('task-failed', { botId, taskId: task.id, ms: Date.now() - taskStartedAt, message: redact(error.message) })
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
          text: buildRoutinePromptForTask(routine),
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
