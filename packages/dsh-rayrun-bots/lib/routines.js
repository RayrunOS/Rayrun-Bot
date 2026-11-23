/**
 * Per-bot routines: user intent for recurring prompts.
 *
 * A routine is stored apart from `bot.json` because its schedule state
 * (`nextAt`, `lastRunAt`) is runtime state and changes without a bot revision.
 * The local DSH host decides when a routine is due and enqueues one normal bot
 * turn; the cloud queue still executes turns serially. Routines are not a
 * second queue and do not add an approval bypass. Validation is fail-closed.
 */
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { assertBotId } from './bot-schema.js'
import { ERROR_CODES } from './errors.js'
import { writeJsonAtomic } from './local-store.js'

export const ROUTINE_SCHEMA_VERSION = 1
export const ROUTINE_MAX = 32
export const ROUTINE_TITLE_MAX = 80
export const ROUTINE_PROMPT_MAX_BYTES = 8 * 1024
export const ROUTINE_MIN_MINUTES = 1
export const ROUTINE_MAX_MINUTES = 7 * 24 * 60

const ID = /^routine-[a-z0-9-]{1,60}$/
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
const ONE_LINE_CONTROL = /[\u0000-\u001f\u007f]/
const FIELDS = new Set([
  'id', 'title', 'prompt', 'everyMinutes', 'enabled',
  'nextAt', 'lastRunAt', 'createdAt', 'updatedAt',
])
const CREATE_FIELDS = new Set(['title', 'prompt', 'everyMinutes', 'enabled'])
const UPDATE_FIELDS = new Set(['title', 'prompt', 'everyMinutes', 'enabled'])

/** A rejected routine operation. `field` names the offending input when known. */
export class RoutineError extends Error {
  constructor(code, message, { field } = {}) {
    super(message)
    this.name = 'RoutineError'
    this.code = code
    if (field) this.field = field
  }
}

const fail = (message, options) => { throw new RoutineError(ERROR_CODES.routineInvalid, message, options) }
const unknown = (id) => {
  const error = new RoutineError(ERROR_CODES.routineUnknown, `Unknown routine: ${id}.`)
  return error
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function textOf(value, field, { max, oneLine = false } = {}) {
  if (typeof value !== 'string') fail(`${field} must be a string.`, { field })
  const result = value.trim()
  if (result === '') fail(`${field} is required.`, { field })
  if (oneLine && ONE_LINE_CONTROL.test(result)) fail(`${field} must stay on one line.`, { field })
  if (!oneLine && CONTROL.test(result)) fail(`${field} contains control characters.`, { field })
  if (max !== undefined && [...result].length > max) fail(`${field} is too long (max ${max} characters).`, { field })
  return result
}

function promptOf(value) {
  if (typeof value !== 'string') fail('prompt must be a string.', { field: 'prompt' })
  const result = value.trim()
  if (result === '') fail('prompt is required.', { field: 'prompt' })
  if (CONTROL.test(result)) fail('prompt contains control characters.', { field: 'prompt' })
  if (Buffer.byteLength(result, 'utf8') > ROUTINE_PROMPT_MAX_BYTES) {
    fail(`prompt exceeds ${ROUTINE_PROMPT_MAX_BYTES} bytes.`, { field: 'prompt' })
  }
  return result
}

function minutesOf(value) {
  if (!Number.isInteger(value) || value < ROUTINE_MIN_MINUTES || value > ROUTINE_MAX_MINUTES) {
    fail(`everyMinutes must be an integer from ${ROUTINE_MIN_MINUTES} through ${ROUTINE_MAX_MINUTES}.`, {
      field: 'everyMinutes',
    })
  }
  return value
}

function enabledOf(value) {
  if (typeof value !== 'boolean') fail('enabled must be a boolean.', { field: 'enabled' })
  return value
}

function timestampOf(value, field) {
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

function nextAtFrom(now, everyMinutes) {
  return new Date(Date.parse(now) + everyMinutes * 60_000).toISOString()
}

function validateRoutine(value) {
  if (!isObject(value)) fail('A routine must be a JSON object.')
  for (const key of Object.keys(value)) {
    if (!FIELDS.has(key)) fail(`Unknown routine field: ${key}.`)
  }
  if (typeof value.id !== 'string' || !ID.test(value.id)) fail('routine.id is invalid.')
  const routine = {
    id: value.id,
    title: textOf(value.title, 'title', { max: ROUTINE_TITLE_MAX, oneLine: true }),
    prompt: promptOf(value.prompt),
    everyMinutes: minutesOf(value.everyMinutes),
    enabled: enabledOf(value.enabled),
    nextAt: timestampOf(value.nextAt, 'nextAt'),
    createdAt: timestampOf(value.createdAt, 'createdAt'),
    updatedAt: timestampOf(value.updatedAt, 'updatedAt'),
  }
  if (value.lastRunAt !== undefined) routine.lastRunAt = timestampOf(value.lastRunAt, 'lastRunAt')
  return routine
}

function validateFile(value, botId) {
  if (!isObject(value)) fail('routines.json must be a JSON object.')
  for (const key of Object.keys(value)) {
    if (!['schema', 'botId', 'routines'].includes(key)) fail(`Unknown routines file field: ${key}.`)
  }
  if (value.schema !== ROUTINE_SCHEMA_VERSION) fail('Unsupported routines schema.')
  if (value.botId !== botId) fail('routines.json belongs to a different bot.')
  if (!Array.isArray(value.routines) || value.routines.length > ROUTINE_MAX) {
    fail(`routines must be an array of at most ${ROUTINE_MAX} entries.`)
  }
  const routines = value.routines.map(validateRoutine)
  const seen = new Set()
  for (const routine of routines) {
    if (seen.has(routine.id)) fail(`Duplicate routine id: ${routine.id}.`)
    seen.add(routine.id)
  }
  return { schema: ROUTINE_SCHEMA_VERSION, botId, routines }
}

/**
 * Open the routine store under one state directory.
 * @param {string} stateRoot Absolute directory that also holds `bots/`.
 */
export function openRoutineStore(stateRoot) {
  const root = path.resolve(stateRoot)

  function botDirectory(id) {
    return path.join(root, 'bots', assertBotId(id))
  }

  function fileFor(id) {
    return path.join(botDirectory(id), 'routines.json')
  }

  function assertBot(id) {
    const botId = assertBotId(id)
    if (!existsSync(path.join(botDirectory(botId), 'bot.json'))) {
      const error = new Error(`Unknown bot: ${botId}.`)
      error.code = ERROR_CODES.botUnknown
      throw error
    }
    return botId
  }

  function load(botId) {
    const file = fileFor(botId)
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { schema: ROUTINE_SCHEMA_VERSION, botId, routines: [] }
      }
      throw error
    }
    let value
    try {
      value = JSON.parse(text)
    } catch {
      fail(`routines.json for ${botId} is not valid JSON.`)
    }
    return validateFile(value, botId)
  }

  function write(botId, value) {
    writeJsonAtomic(fileFor(botId), value)
  }

  function list(id) {
    const botId = assertBot(id)
    return [...load(botId).routines].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  function create(id, input, { now = Date.now() } = {}) {
    const botId = assertBot(id)
    if (!isObject(input)) fail('A routine must be a JSON object.')
    for (const key of Object.keys(input)) {
      if (!CREATE_FIELDS.has(key)) fail(`${key} is set by the host, not by the client.`)
    }
    const at = isoNow(now)
    const everyMinutes = minutesOf(input.everyMinutes)
    const routine = {
      id: `routine-${randomUUID()}`,
      title: textOf(input.title, 'title', { max: ROUTINE_TITLE_MAX, oneLine: true }),
      prompt: promptOf(input.prompt),
      everyMinutes,
      enabled: input.enabled === undefined ? true : enabledOf(input.enabled),
      nextAt: nextAtFrom(at, everyMinutes),
      createdAt: at,
      updatedAt: at,
    }
    const current = load(botId)
    if (current.routines.length >= ROUTINE_MAX) {
      fail(`A bot may have at most ${ROUTINE_MAX} routines.`)
    }
    write(botId, { ...current, routines: [...current.routines, routine] })
    return routine
  }

  function update(id, routineId, patch, { now = Date.now() } = {}) {
    const botId = assertBot(id)
    if (!isObject(patch)) fail('A routine update must be a JSON object.')
    const keys = Object.keys(patch)
    if (keys.length === 0) fail('A routine update must change at least one field.')
    for (const key of keys) {
      if (!UPDATE_FIELDS.has(key)) fail(`${key} cannot be changed.`)
    }
    if (typeof routineId !== 'string' || !ID.test(routineId)) fail('routine.id is invalid.')
    const current = load(botId)
    const index = current.routines.findIndex((routine) => routine.id === routineId)
    if (index < 0) throw unknown(routineId)
    const previous = current.routines[index]
    const next = {
      ...previous,
      ...(patch.title === undefined ? {} : { title: textOf(patch.title, 'title', { max: ROUTINE_TITLE_MAX, oneLine: true }) }),
      ...(patch.prompt === undefined ? {} : { prompt: promptOf(patch.prompt) }),
      ...(patch.everyMinutes === undefined ? {} : { everyMinutes: minutesOf(patch.everyMinutes) }),
      ...(patch.enabled === undefined ? {} : { enabled: enabledOf(patch.enabled) }),
    }
    const at = isoNow(now)
    const rescheduled = (patch.everyMinutes !== undefined && patch.everyMinutes !== previous.everyMinutes)
      || (patch.enabled === true && previous.enabled === false)
    next.updatedAt = at
    if (rescheduled) next.nextAt = nextAtFrom(at, next.everyMinutes)
    const routines = [...current.routines]
    routines[index] = next
    write(botId, { ...current, routines })
    return next
  }

  function remove(id, routineId) {
    const botId = assertBot(id)
    if (typeof routineId !== 'string' || !ID.test(routineId)) fail('routine.id is invalid.')
    const current = load(botId)
    const index = current.routines.findIndex((routine) => routine.id === routineId)
    if (index < 0) throw unknown(routineId)
    write(botId, { ...current, routines: current.routines.filter((routine) => routine.id !== routineId) })
    return current.routines[index]
  }

  function due(id, now = Date.now()) {
    const botId = assertBot(id)
    if (!Number.isFinite(now)) fail('now must be a numeric timestamp.')
    return list(botId)
      .filter((routine) => routine.enabled && Date.parse(routine.nextAt) <= now)
      .sort((a, b) => a.nextAt.localeCompare(b.nextAt) || a.id.localeCompare(b.id))
  }

  function markRun(id, routineId, { now = Date.now() } = {}) {
    const botId = assertBot(id)
    if (typeof routineId !== 'string' || !ID.test(routineId)) fail('routine.id is invalid.')
    const current = load(botId)
    const index = current.routines.findIndex((routine) => routine.id === routineId)
    if (index < 0) throw unknown(routineId)
    const at = isoNow(now)
    const next = {
      ...current.routines[index],
      lastRunAt: at,
      nextAt: nextAtFrom(at, current.routines[index].everyMinutes),
      updatedAt: at,
    }
    const routines = [...current.routines]
    routines[index] = next
    write(botId, { ...current, routines })
    return next
  }

  return { list, create, update, remove, due, markRun }
}

/**
 * Build the prompt for one routine turn. It is ordinary user content; the
 * cloud bot still has to request any external action through the approval path.
 * @param {{ title: string, prompt: string }} routine
 */
export function buildRoutinePrompt(routine) {
  return `Scheduled routine: ${routine.title}\n\n${routine.prompt}\n\nDo this routine now. Follow the bot instructions for any action outside this computer; never assume an action was approved.`
}
