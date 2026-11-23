/**
 * Cloud-side routine definitions and schedule state.
 *
 * The local DSH host writes `bots/<id>/routines.json`; this module treats it as
 * untrusted input, validates it again, and keeps the cloud-side schedule state
 * in `bots/<id>/host/routines-state.json`. The cloud scheduler claims a run by
 * advancing that state before writing the inbox task, so a crash cannot replay
 * a routine turn. This is not an approval or credential boundary.
 */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync,
} from 'node:fs'
import path from 'node:path'

const ROUTINE_ID = /^routine-[a-z0-9-]{1,60}$/
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const ONE_LINE = /[\u0000-\u001f\u007f]/
const ROUTINE_MAX = 32
const TITLE_MAX = 80
const PROMPT_MAX_BYTES = 8 * 1024
const MIN_MINUTES = 1
const MAX_MINUTES = 7 * 24 * 60

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function fail(message) { throw new Error(message) }

function textOf(value, field, { max, oneLine = false } = {}) {
  if (typeof value !== 'string') fail(`${field} must be a string`)
  const result = value.trim()
  if (result === '') fail(`${field} is required`)
  if (oneLine && ONE_LINE.test(result)) fail(`${field} must stay on one line`)
  if (!oneLine && CONTROL.test(result)) fail(`${field} contains control characters`)
  if (max !== undefined && [...result].length > max) fail(`${field} is too long`)
  return result
}

function minutesOf(value) {
  if (!Number.isInteger(value) || value < MIN_MINUTES || value > MAX_MINUTES) {
    fail('everyMinutes is invalid')
  }
  return value
}

function timestampOf(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) fail(`${field} is invalid`)
  return value
}

function validateRoutine(value) {
  if (!isObject(value)) fail('routine must be an object')
  for (const key of Object.keys(value)) {
    if (!['id', 'title', 'prompt', 'everyMinutes', 'enabled', 'nextAt', 'lastRunAt', 'createdAt', 'updatedAt'].includes(key)) {
      fail(`unknown routine field: ${key}`)
    }
  }
  if (typeof value.id !== 'string' || !ROUTINE_ID.test(value.id)) fail('routine id is invalid')
  if (typeof value.enabled !== 'boolean') fail('routine enabled is invalid')
  const prompt = value.prompt
  if (typeof prompt !== 'string' || prompt.trim() === '') fail('routine prompt is required')
  if (CONTROL.test(prompt)) fail('routine prompt contains control characters')
  if (Buffer.byteLength(prompt, 'utf8') > PROMPT_MAX_BYTES) fail('routine prompt is too large')
  const routine = {
    id: value.id,
    title: textOf(value.title, 'routine title', { max: TITLE_MAX, oneLine: true }),
    prompt: prompt.trim(),
    everyMinutes: minutesOf(value.everyMinutes),
    enabled: value.enabled,
    nextAt: timestampOf(value.nextAt, 'nextAt'),
    createdAt: timestampOf(value.createdAt, 'createdAt'),
    updatedAt: timestampOf(value.updatedAt, 'updatedAt'),
  }
  if (value.lastRunAt !== undefined) routine.lastRunAt = timestampOf(value.lastRunAt, 'lastRunAt')
  return routine
}

function validateFile(value) {
  if (!isObject(value)) fail('routines.json must be an object')
  for (const key of Object.keys(value)) {
    if (!['schema', 'botId', 'routines'].includes(key)) fail(`unknown routines file field: ${key}`)
  }
  if (value.schema !== 1) fail('unsupported routines schema')
  if (!Array.isArray(value.routines) || value.routines.length > ROUTINE_MAX) fail('routines array is invalid')
  const routines = value.routines.map(validateRoutine)
  const seen = new Set()
  for (const routine of routines) {
    if (seen.has(routine.id)) fail(`duplicate routine id: ${routine.id}`)
    seen.add(routine.id)
  }
  return routines
}

function validateState(value, botId) {
  if (!isObject(value)) fail('routine state must be an object')
  for (const key of Object.keys(value)) {
    if (!['schema', 'botId', 'routines'].includes(key)) fail(`unknown routine state field: ${key}`)
  }
  if (value.schema !== 1 || value.botId !== botId) fail('routine state is invalid')
  if (!isObject(value.routines)) fail('routine state routines must be an object')
  const routines = {}
  for (const [id, entry] of Object.entries(value.routines)) {
    if (!ROUTINE_ID.test(id) || !isObject(entry)) fail('routine state entry is invalid')
    for (const key of Object.keys(entry)) {
      if (!['updatedAt', 'nextAt', 'lastRunAt'].includes(key)) fail(`unknown routine state field: ${key}`)
    }
    routines[id] = {
      updatedAt: timestampOf(entry.updatedAt, 'state.updatedAt'),
      nextAt: timestampOf(entry.nextAt, 'state.nextAt'),
      ...(entry.lastRunAt === undefined ? {} : { lastRunAt: timestampOf(entry.lastRunAt, 'state.lastRunAt') }),
    }
  }
  return { schema: 1, botId, routines }
}

function stateFile(root, botId) {
  return path.join(root, 'bots', botId, 'host', 'routines-state.json')
}

function writeState(root, botId, state) {
  const file = stateFile(root, botId)
  const directory = path.dirname(file)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temp = path.join(directory, `.${path.basename(file)}.tmp-${randomUUID()}`)
  const data = Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8')
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

/** Read and validate the local host's mirrored routine definitions. */
export function readRoutineFile(root, botId) {
  const file = path.join(root, 'bots', botId, 'routines.json')
  if (!existsSync(file)) return []
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    fail('routines.json could not be read')
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    fail('routines.json is not valid JSON')
  }
  if (value?.botId !== botId) fail('routines.json belongs to a different bot')
  return validateFile(value)
}

export function readRoutineState(root, botId) {
  const file = stateFile(root, botId)
  if (!existsSync(file)) return { schema: 1, botId, routines: {} }
  let value
  try {
    value = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    fail('routines-state.json is not valid JSON')
  }
  return validateState(value, botId)
}

/** Remove state for routines that no longer exist. */
export function pruneRoutineState(state, routines) {
  const ids = new Set(routines.map((routine) => routine.id))
  const kept = {}
  for (const [id, entry] of Object.entries(state.routines)) {
    if (ids.has(id)) kept[id] = entry
  }
  return { ...state, routines: kept }
}

/**
 * Pick the first due routine. A state entry only applies while the definition's
 * `updatedAt` is unchanged; an edit restarts from the definition's `nextAt`.
 */
export function dueRoutine(routines, state, nowMs) {
  const due = []
  for (const routine of routines) {
    if (!routine.enabled) continue
    const entry = state.routines[routine.id]
    const nextAt = entry && entry.updatedAt === routine.updatedAt ? entry.nextAt : routine.nextAt
    if (Date.parse(nextAt) <= nowMs) due.push({ routine, nextAt })
  }
  due.sort((a, b) => a.nextAt.localeCompare(b.nextAt) || a.routine.id.localeCompare(b.routine.id))
  return due[0] ?? null
}

/** Claim one run before enqueueing it. */
export function advanceRoutineState(state, routine, nowMs) {
  const at = new Date(nowMs).toISOString()
  return {
    ...state,
    routines: {
      ...state.routines,
      [routine.id]: {
        updatedAt: routine.updatedAt,
        lastRunAt: at,
        nextAt: new Date(nowMs + routine.everyMinutes * 60_000).toISOString(),
      },
    },
  }
}

export function writeRoutineState(root, botId, state) {
  writeState(root, botId, state)
}

/** The prompt sent for one routine turn; the local scheduler uses the same text. */
export function buildRoutinePrompt(routine) {
  return `Scheduled routine: ${routine.title}\n\n${routine.prompt}\n\nDo this routine now. Follow the bot instructions for any action outside this computer; never assume an action was approved.`
}
