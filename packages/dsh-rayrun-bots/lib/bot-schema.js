/**
 * `bot.json` schema, validation and creation defaults.
 *
 * The definition is user intent; the running state (session, memory, queue)
 * lives on the cloud computer. Validation is fail-closed: unknown fields,
 * wrong types and invalid values raise `E_BOT_INVALID` instead of being
 * silently dropped.
 */
import { Buffer } from 'node:buffer'
import path from 'node:path'
import { ERROR_CODES } from './errors.js'

export const BOT_SCHEMA_VERSION = 1
export const INSTRUCTIONS_MAX_BYTES = 8 * 1024

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CONTROL = /[\u0000-\u001f\u007f]/
const FIELDS = new Set([
  'schema', 'id', 'name', 'label', 'avatar', 'instructions', 'skills',
  'model', 'workspace', 'createdAt', 'updatedAt', 'revision', 'deletedAt',
])
const CREATE_FIELDS = new Set(['id', 'name', 'label', 'avatar', 'instructions', 'skills', 'model'])

/** A rejected bot definition. `field` names the offending field when known. */
export class BotValidationError extends Error {
  constructor(field, message) {
    super(message)
    this.name = 'BotValidationError'
    this.code = ERROR_CODES.botInvalid
    this.field = field
  }
}

const fail = (field, message) => { throw new BotValidationError(field, message) }
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function text(value, field, { max, oneLine = false } = {}) {
  if (typeof value !== 'string') fail(field, `${field} must be a string.`)
  const result = value.trim()
  if (result === '') fail(field, `${field} is required.`)
  if (oneLine && CONTROL.test(result)) fail(field, `${field} must stay on one line.`)
  if (max !== undefined && [...result].length > max) fail(field, `${field} is too long (max ${max} characters).`)
  return result
}

function instructionsOf(value) {
  if (typeof value !== 'string') fail('instructions', 'instructions must be a string.')
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    fail('instructions', 'instructions contain control characters.')
  }
  if (Buffer.byteLength(value, 'utf8') > INSTRUCTIONS_MAX_BYTES) {
    fail('instructions', `instructions exceed ${INSTRUCTIONS_MAX_BYTES} bytes.`)
  }
  return value
}

function avatarOf(value) {
  if (!isObject(value)) fail('avatar', 'avatar must be an object.')
  for (const key of Object.keys(value)) {
    if (!['kind', 'letter', 'hue'].includes(key)) fail('avatar', `Unknown avatar field: ${key}.`)
  }
  if (value.kind !== 'monogram') fail('kind', 'v0.1 only supports the monogram avatar.')
  if (typeof value.letter !== 'string' || [...value.letter].length !== 1 || value.letter.trim() === '' || CONTROL.test(value.letter)) {
    fail('letter', 'avatar.letter must be one visible character.')
  }
  if (!Number.isInteger(value.hue) || value.hue < 0 || value.hue > 359) {
    fail('hue', 'avatar.hue must be an integer from 0 through 359.')
  }
  return { kind: 'monogram', letter: value.letter, hue: value.hue }
}

function skillsOf(value) {
  if (!Array.isArray(value)) fail('skills', 'skills must be an array of names.')
  if (value.length > 64) fail('skills', 'skills may list at most 64 names.')
  const seen = new Set()
  return value.map((name) => {
    const skill = text(name, 'skills', { max: 128, oneLine: true })
    if (seen.has(skill)) fail('skills', `Duplicate skill: ${skill}.`)
    seen.add(skill)
    return skill
  })
}

function workspaceOf(value) {
  if (!isObject(value)) fail('workspace', 'workspace must be an object.')
  for (const key of Object.keys(value)) {
    if (!['id', 'path', 'title'].includes(key)) fail('workspace', `Unknown workspace field: ${key}.`)
  }
  const id = text(value.id, 'workspace.id', { max: 128, oneLine: true })
  if (typeof value.path !== 'string' || value.path === '' || !path.isAbsolute(value.path)) {
    fail('workspace.path', 'workspace.path must be an absolute path.')
  }
  if (Buffer.byteLength(value.path, 'utf8') > 4096 || CONTROL.test(value.path)) {
    fail('workspace.path', 'workspace.path is invalid.')
  }
  const title = text(value.title, 'workspace.title', { max: 200, oneLine: true })
  return { id, path: value.path, title }
}

function timestampOf(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    fail(field, `${field} must be an ISO 8601 timestamp.`)
  }
  return value
}

/**
 * Derive the kebab-case id from a display name. Names that cannot produce an
 * ASCII id (for example, CJK-only names) require the caller to supply one.
 * @param {string} name Display name.
 * @returns {string}
 */
export function botIdFromName(name) {
  const display = text(name, 'name', { max: 80, oneLine: true })
  const id = display
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  if (id === '') fail('id', 'Enter a kebab-case id; one cannot be derived from this name.')
  return id
}

/**
 * Fill the localized instruction template. The template is content, not code.
 * @param {string} template Template containing `{name}` and `{job}`.
 * @param {{ name: string, job: string }} values
 * @returns {string}
 */
export function fillTemplate(template, { name, job }) {
  if (typeof template !== 'string') return ''
  return template.replaceAll('{name}', name).replaceAll('{job}', job)
}

function defaultAvatar(name, id) {
  const letter = Array.from(name)[0].toUpperCase()
  let hue = 7
  for (const char of id) hue = (hue * 31 + char.codePointAt(0)) >>> 0
  return { kind: 'monogram', letter, hue: hue % 360 }
}

/**
 * Validate one bot id before it is used in a lookup or a file path.
 * @param {unknown} value
 * @returns {string}
 * @throws {BotValidationError} When the id is not kebab-case.
 */
export function assertBotId(value) {
  const id = text(value, 'id', { max: 64 })
  if (!ID_PATTERN.test(id)) fail('id', 'id must be kebab-case (lowercase letters, digits and single hyphens).')
  return id
}

/**
 * Validate and normalize a stored `bot.json`.
 * @param {unknown} value Parsed JSON value.
 * @returns {object} A normalized bot definition.
 * @throws {BotValidationError} For any invalid or unknown field.
 */
export function validateBot(value) {
  if (!isObject(value)) fail('bot', 'A bot definition must be a JSON object.')
  if (value.schema !== BOT_SCHEMA_VERSION) {
    fail('schema', value.schema > BOT_SCHEMA_VERSION
      ? 'This bot uses a newer schema; update the plugin.'
      : `Unsupported bot schema; expected ${BOT_SCHEMA_VERSION}.`)
  }
  for (const key of Object.keys(value)) {
    if (!FIELDS.has(key)) fail(key, `Unknown bot field: ${key}.`)
  }

  const id = assertBotId(value.id)
  const name = text(value.name, 'name', { max: 80, oneLine: true })
  const label = text(value.label, 'label', { max: 120, oneLine: true })
  const avatar = avatarOf(value.avatar)
  const instructions = instructionsOf(value.instructions)
  const skills = skillsOf(value.skills)
  const model = value.model === undefined ? 'deepseek' : value.model
  if (model !== 'deepseek') fail('model', 'v0.1 only supports the DeepSeek model.')
  const createdAt = timestampOf(value.createdAt, 'createdAt')
  const updatedAt = timestampOf(value.updatedAt, 'updatedAt')
  const revision = value.revision === undefined ? 1 : value.revision
  if (!Number.isInteger(revision) || revision < 0) fail('revision', 'revision must be a non-negative integer.')

  const bot = {
    schema: BOT_SCHEMA_VERSION, id, name, label, avatar, instructions, skills,
    model, createdAt, updatedAt, revision,
  }
  if (value.workspace !== undefined) bot.workspace = workspaceOf(value.workspace)
  if (value.deletedAt !== undefined) bot.deletedAt = timestampOf(value.deletedAt, 'deletedAt')
  return bot
}

/**
 * Build a new bot. The host supplies timestamps and the initial revision; a
 * localized `template` fills instructions when the user leaves them empty.
 * @param {object} input User-supplied fields: id, name, label, avatar, instructions, skills, model.
 * @param {{ now?: string | number | Date, template?: string, workspace?: object }} [options]
 * @returns {object} A validated bot definition.
 * @throws {BotValidationError} For invalid input or host-only fields.
 */
export function createBot(input, { now = Date.now(), template, workspace } = {}) {
  if (!isObject(input)) fail('bot', 'A bot definition must be a JSON object.')
  for (const key of Object.keys(input)) {
    if (!CREATE_FIELDS.has(key)) fail(key, `${key} is set by the host, not by the client.`)
  }
  const name = text(input.name, 'name', { max: 80, oneLine: true })
  const label = text(input.label, 'label', { max: 120, oneLine: true })
  const id = input.id === undefined ? botIdFromName(name) : text(input.id, 'id', { max: 64 })
  const avatar = input.avatar === undefined ? defaultAvatar(name, id) : avatarOf(input.avatar)
  const instructions = typeof input.instructions === 'string' && input.instructions.trim() !== ''
    ? input.instructions
    : fillTemplate(template, { name, job: label })
  const skills = input.skills === undefined ? [] : skillsOf(input.skills)
  const model = input.model === undefined ? 'deepseek' : input.model
  const at = new Date(now)
  if (Number.isNaN(at.getTime())) fail('createdAt', 'now must be a valid date.')
  const createdAt = at.toISOString()
  const bot = {
    schema: BOT_SCHEMA_VERSION, id, name, label, avatar, instructions, skills,
    model, createdAt, updatedAt: createdAt, revision: 1,
  }
  if (workspace !== undefined && workspace !== null) bot.workspace = workspace
  return validateBot(bot)
}
