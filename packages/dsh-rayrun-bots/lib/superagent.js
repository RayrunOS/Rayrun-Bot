/**
 * Account-level primary bot identity.
 *
 * One DSH profile (one Rayrun account) has one primary bot. The reference
 * lives outside `bot.json` so a bot definition stays unchanged when its role
 * changes: `<state>/superagent.json` is `{ schema: 1, botId, createdAt }`.
 *
 * The store is idempotent and fails closed: a corrupt reference is an error,
 * not a reason to invent a second primary. A reference to a deleted bot is
 * rebuilt, but a corrupt `bot.json` is not treated as deletion.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { assertBotId } from './bot-schema.js'
import { ERROR_CODES } from './errors.js'
import { writeJsonAtomic } from './local-store.js'

export const SUPERAGENT_SCHEMA_VERSION = 1
export const PRIMARY_ID_BASE = 'superagent'
export const PRIMARY_DEFAULT_NAME = 'Superagent'
export const PRIMARY_DEFAULT_LABEL = 'Coordinates your bots'
export const PRIMARY_DEFAULT_INSTRUCTIONS = [
  'You are the user\'s primary teammate. Coordinate the other bots when a task matches one of them;',
  'answer directly when no specialist fits. Do not claim work you have not verified.',
].join(' ')

function invalid(message) {
  const error = new Error(message)
  error.code = ERROR_CODES.superagentInvalid
  return error
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Open the primary reference stored under one state directory.
 * @param {string} stateRoot Absolute Rayrun Bot state directory.
 */
export function openSuperagentStore(stateRoot) {
  const file = path.join(path.resolve(stateRoot), 'superagent.json')

  /** @returns {{ schema: number, botId: string, createdAt: string } | null} */
  function read() {
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
      throw invalid(`The primary bot record is not valid JSON: ${file}.`)
    }
    if (!isObject(value)) throw invalid(`The primary bot record must be an object: ${file}.`)
    const keys = Object.keys(value).sort()
    if (keys.join(',') !== 'botId,createdAt,schema') {
      throw invalid(`The primary bot record has unexpected fields: ${file}.`)
    }
    if (value.schema !== SUPERAGENT_SCHEMA_VERSION) {
      throw invalid(`Unsupported primary bot schema: ${String(value.schema)}.`)
    }
    try {
      assertBotId(value.botId)
    } catch {
      throw invalid(`The primary bot record has an invalid bot id: ${file}.`)
    }
    if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt))) {
      throw invalid(`The primary bot record has an invalid createdAt: ${file}.`)
    }
    return { schema: SUPERAGENT_SCHEMA_VERSION, botId: value.botId, createdAt: value.createdAt }
  }

  /** Read-only primary id; never creates or repairs. */
  function primaryBotId() {
    return read()?.botId ?? null
  }

  /**
   * Return the record and its bot, creating the default primary when needed.
   * Idempotent: an existing primary and bot are returned without a write.
   * @param {{ get(id: string): object, create(input: object): object }} botStore
   */
  function ensure(botStore) {
    const existing = read()
    if (existing) {
      try {
        const bot = botStore.get(existing.botId)
        return { record: existing, bot, created: false }
      } catch (error) {
        if (error?.code !== ERROR_CODES.botUnknown) throw error
        // The bot was deleted; rebuild below. A corrupt bot.json keeps failing closed.
      }
    }

    const base = existing?.botId ?? PRIMARY_ID_BASE
    let bot
    let id = base
    for (let suffix = 2; ; suffix += 1) {
      try {
        bot = botStore.create({
          id,
          name: PRIMARY_DEFAULT_NAME,
          label: PRIMARY_DEFAULT_LABEL,
          instructions: PRIMARY_DEFAULT_INSTRUCTIONS,
        })
        break
      } catch (error) {
        if (error?.code !== ERROR_CODES.botExists) throw error
        id = `${base}-${suffix}`
      }
    }

    const record = {
      schema: SUPERAGENT_SCHEMA_VERSION,
      botId: bot.id,
      createdAt: existing?.createdAt ?? bot.createdAt,
    }
    writeJsonAtomic(file, record)
    return { record, bot, created: true }
  }

  return { file, read, ensure, primaryBotId }
}
