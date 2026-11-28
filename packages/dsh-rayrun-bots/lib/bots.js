/**
 * Persistent bot roster.
 *
 * Until the cloud runtime lands, the user's intent lives in the DSH state
 * directory: `<state>/bots/<id>/bot.json`. Each definition is validated with
 * `lib/bot-schema.js` before it is written or returned, and every write is
 * atomic. The machine remains the runtime truth once the runtime exists; this
 * roster is what gets mirrored there.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  BotValidationError, assertBotId, botIdFromName, createBot, validateBot,
} from './bot-schema.js'
import { ERROR_CODES } from './errors.js'
import { ensureDirectory, writeJsonAtomic } from './local-store.js'

const UPDATE_FIELDS = new Set(['name', 'label', 'avatar', 'instructions', 'skills'])

function unknownBot(id) {
  const error = new Error(`Unknown bot: ${id}.`)
  error.code = ERROR_CODES.botUnknown
  return error
}

function duplicateBot(id) {
  const error = new Error(`A bot with id ${id} already exists.`)
  error.code = ERROR_CODES.botExists
  return error
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Open the roster stored under one state directory. Creating the object is
 * idempotent; it creates the private `bots/` directory when missing.
 * @param {string} stateRoot Absolute state directory.
 */
export function openBotStore(stateRoot) {
  const botsDir = ensureDirectory(path.join(stateRoot, 'bots'))

  function botDir(id) {
    return path.join(botsDir, assertBotId(id))
  }

  function exists(id) {
    try {
      return statSync(botDir(id)).isDirectory()
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw error
    }
  }

  function read(id) {
    const botId = assertBotId(id)
    const file = path.join(botsDir, botId, 'bot.json')
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') throw unknownBot(botId)
      throw error
    }
    let value
    try {
      value = JSON.parse(text)
    } catch {
      throw new BotValidationError('bot', `bot.json for ${botId} is not valid JSON.`)
    }
    const bot = validateBot(value)
    if (bot.id !== botId) {
      throw new BotValidationError('id', `bot.json in ${botId}/ declares id ${bot.id}.`)
    }
    return bot
  }

  function uniqueId(name) {
    let base
    try {
      base = botIdFromName(name)
    } catch (error) {
      if (error?.code !== ERROR_CODES.botInvalid || error.field !== 'id') throw error
      base = 'bot'
    }
    let id = base
    let suffix = 2
    while (exists(id)) {
      id = `${base}-${suffix}`
      suffix += 1
    }
    return id
  }

  /** @returns {object[]} Bots ordered by creation time, then id. */
  function list() {
    const bots = readdirSync(botsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => read(entry.name))
    return bots.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  /** @param {string} id @returns {object} */
  function get(id) {
    return read(id)
  }

  /**
   * Create and persist one bot. The host derives a unique kebab-case id when
   * the client does not send one.
   * @param {object} input User-supplied fields.
   * @param {{ now?: string | number | Date, template?: string }} [options]
   * @returns {object}
   */
  function create(input, options = {}) {
    if (!isObject(input)) throw new BotValidationError('bot', 'A bot definition must be a JSON object.')
    let id
    if (input.id === undefined) {
      id = uniqueId(input.name)
    } else {
      id = assertBotId(input.id)
      if (exists(id)) throw duplicateBot(id)
    }
    const bot = createBot({ ...input, id }, options)
    const directory = path.join(botsDir, bot.id)
    try {
      mkdirSync(directory, { mode: 0o700 })
    } catch (error) {
      if (error?.code === 'EEXIST') throw duplicateBot(bot.id)
      throw error
    }
    writeJsonAtomic(path.join(directory, 'bot.json'), bot)
    return bot
  }

  /**
   * Update the editable fields of one bot and bump its revision.
   * @param {string} id
   * @param {object} patch Editable fields: name, label, avatar, instructions, skills.
   * @param {{ now?: string | number | Date, workspace?: object | null }} [options]
   *   `workspace` is host-only: undefined keeps it, null unbinds, an object binds.
   * @returns {object}
   */
  function update(id, patch, { now = Date.now(), workspace } = {}) {
    if (!isObject(patch)) throw new BotValidationError('bot', 'A bot update must be a JSON object.')
    for (const key of Object.keys(patch)) {
      if (!UPDATE_FIELDS.has(key)) throw new BotValidationError(key, `${key} cannot be changed.`)
    }
    const current = read(id)
    const at = new Date(now)
    if (Number.isNaN(at.getTime())) throw new BotValidationError('updatedAt', 'now must be a valid date.')
    const merged = {
      ...current,
      ...patch,
      updatedAt: at.toISOString(),
      revision: current.revision + 1,
    }
    if (workspace === null) delete merged.workspace
    else if (workspace !== undefined) merged.workspace = workspace
    const next = validateBot(merged)
    writeJsonAtomic(path.join(botDir(id), 'bot.json'), next)
    return next
  }

  /** @param {string} id @returns {string} The removed id. */
  function remove(id) {
    const directory = botDir(id)
    if (!exists(id)) throw unknownBot(id)
    rmSync(directory, { recursive: true, force: true })
    return id
  }

  return { list, get, create, update, remove }
}
