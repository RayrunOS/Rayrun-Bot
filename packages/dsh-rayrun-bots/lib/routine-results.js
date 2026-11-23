/**
 * Routine results imported from the cloud host.
 *
 * A routine result is display-only history: the cloud host already ran the
 * turn. It is stored as one immutable JSON file per cloud task so a repeated
 * sync is idempotent. `session.history` merges these files after the local
 * transcript; they never modify `session.json` or its queue.
 */
import { Buffer } from 'node:buffer'
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { assertBotId } from './bot-schema.js'
import { ERROR_CODES } from './errors.js'
import { writeJsonAtomic } from './local-store.js'

export const ROUTINE_RESULT_MAX_BYTES = 64 * 1024
const ROUTINE_RESULT_FIELD_MAX_BYTES = 32 * 1024
export const ROUTINE_RESULT_MAX_COUNT = 400
export const ROUTINE_RESULT_KEEP = 400
export const ROUTINE_SYNTHETIC_SEQ_BASE = 1_000_000_000
const ROUTINE_RESULT_DEFAULT_LIMIT = 200

const TASK_ID = /^[A-Za-z0-9._-]{1,80}$/
const ROUTINE_ID = /^routine-[a-z0-9-]{1,60}$/
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const FIELDS = new Set(['schema', 'botId', 'taskId', 'text', 'reply', 'at', 'routineId'])

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export class RoutineResultError extends Error {
  constructor(message, { field } = {}) {
    super(message)
    this.name = 'RoutineResultError'
    this.code = ERROR_CODES.routineInvalid
    if (field) this.field = field
  }
}

const fail = (message, options) => { throw new RoutineResultError(message, options) }

function textOf(value, field) {
  if (typeof value !== 'string') fail(`${field} must be a string.`, { field })
  const result = value.trim()
  if (result === '') fail(`${field} is required.`, { field })
  if (CONTROL.test(result)) fail(`${field} contains control characters.`, { field })
  if (Buffer.byteLength(result, 'utf8') > ROUTINE_RESULT_FIELD_MAX_BYTES) fail(`${field} is too large.`, { field })
  return result
}

export function validateRoutineResult(value, { botId, filename } = {}) {
  if (!isObject(value)) fail('A routine result must be a JSON object.')
  for (const key of Object.keys(value)) {
    if (!FIELDS.has(key)) fail(`Unknown routine result field: ${key}.`)
  }
  if (value.schema !== 1) fail('Unsupported routine result schema.')
  if (value.botId !== botId) fail('The routine result belongs to a different bot.')
  if (typeof value.taskId !== 'string' || !TASK_ID.test(value.taskId)) fail('routine result taskId is invalid.')
  if (filename !== undefined && filename !== `${value.taskId}.json`) fail('routine result filename does not match taskId.')
  if (value.routineId !== undefined && (typeof value.routineId !== 'string' || !ROUTINE_ID.test(value.routineId))) {
    fail('routine result routineId is invalid.')
  }
  if (typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) fail('routine result at is invalid.')
  const result = {
    schema: 1,
    botId,
    taskId: value.taskId,
    text: textOf(value.text, 'text'),
    reply: textOf(value.reply, 'reply'),
    at: value.at,
    ...(value.routineId === undefined ? {} : { routineId: value.routineId }),
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > ROUTINE_RESULT_MAX_BYTES) {
    fail('routine result is too large.')
  }
  return result
}

export function routineResultsDirectory(stateRoot, botId) {
  return path.join(path.resolve(stateRoot), 'bots', assertBotId(botId), 'routine-results')
}

export function routineResultPath(stateRoot, botId, taskId) {
  if (typeof taskId !== 'string' || !TASK_ID.test(taskId)) fail('routine result taskId is invalid.')
  return path.join(routineResultsDirectory(stateRoot, botId), `${taskId}.json`)
}

export function routineResultExists(stateRoot, botId, taskId) {
  return existsSync(routineResultPath(stateRoot, botId, taskId))
}

export function validateStoredRoutineResult(value, botId, filename) {
  return validateRoutineResult(value, { botId, filename })
}

/** Read local imported results, newest last. Malformed files fail closed. */
export function readRoutineResults(stateRoot, botId, { limit = ROUTINE_RESULT_DEFAULT_LIMIT } = {}) {
  const id = assertBotId(botId)
  if (!Number.isInteger(limit) || limit < 1 || limit > ROUTINE_RESULT_MAX_COUNT) {
    fail(`routine result limit must be an integer from 1 through ${ROUTINE_RESULT_MAX_COUNT}.`)
  }
  const directory = routineResultsDirectory(stateRoot, id)
  let names
  try {
    names = readdirSync(directory).filter((name) => name.endsWith('.json') && !name.startsWith('.')).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const entries = []
  for (const name of names) {
    const file = path.join(directory, name)
    try {
      const info = statSync(file)
      entries.push({ name, file, size: info.size, mtime: info.mtimeMs })
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw error
    }
  }
  entries.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name))
  const results = []
  for (const entry of entries.slice(-limit)) {
    if (entry.size > ROUTINE_RESULT_MAX_BYTES * 2) fail(`routine result ${entry.name} is too large.`)
    let value
    try {
      value = JSON.parse(readFileSync(entry.file, 'utf8'))
    } catch {
      fail(`routine result ${entry.name} is not valid JSON.`)
    }
    results.push(validateStoredRoutineResult(value, id, entry.name))
  }
  results.sort((a, b) => a.at.localeCompare(b.at) || a.taskId.localeCompare(b.taskId))
  return results
}

function pruneRoutineResults(stateRoot, botId) {
  const directory = routineResultsDirectory(stateRoot, botId)
  try {
    const entries = readdirSync(directory)
      .filter((name) => name.endsWith('.json') && !name.startsWith('.'))
      .map((name) => ({ name, mtime: statSync(path.join(directory, name)).mtimeMs }))
      .sort((a, b) => a.mtime - b.mtime)
    for (const entry of entries.slice(0, Math.max(0, entries.length - ROUTINE_RESULT_KEEP))) {
      try { unlinkSync(path.join(directory, entry.name)) } catch { /* best effort */ }
    }
  } catch {
    // Retention must not fail the import.
  }
}

/** Store one validated result idempotently. */
export function writeRoutineResult(stateRoot, value, { botId } = {}) {
  const id = assertBotId(botId)
  if (!existsSync(path.join(path.resolve(stateRoot), 'bots', id, 'bot.json'))) {
    const error = new Error(`Unknown bot: ${id}.`)
    error.code = ERROR_CODES.botUnknown
    throw error
  }
  const result = validateRoutineResult(value, { botId: id, filename: `${value?.taskId}.json` })
  writeJsonAtomic(routineResultPath(stateRoot, id, result.taskId), result)
  pruneRoutineResults(stateRoot, id)
  return result
}
