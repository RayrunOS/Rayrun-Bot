/**
 * Approval request/decision protocol and its append-only audit.
 *
 * This module is transport and audit only. ADR-019 makes the local DSH host the
 * approval authority and executor for typed local actions; `decide()` records
 * the local human decision, and `lib/approval-executor.js` performs the action
 * at most once. The cloud side may propose actions but never writes decisions
 * or execution claims.
 *
 * Requests and decisions are separate files under
 * `bots/<botId>/approvals/`, written once (no overwrite) with the atomic
 * temp+fsync+hard-link helper. The action hash is SHA-256 over a small,
 * documented canonical JSON payload, so a decision can only bind the exact
 * action the user saw.
 */
import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { assertBotId } from './bot-schema.js'
import { ERROR_CODES } from './errors.js'
import { ensureDirectory, writeJsonOnce } from './local-store.js'

export const APPROVAL_SCHEMA_VERSION = 1
export const DEFAULT_BACKGROUND_TTL_MS = 30 * 60 * 1000
export const ACTION_MAX_BYTES = 16 * 1024

const ID = /^[A-Za-z0-9._-]{1,80}$/
const NONCE = /^[A-Za-z0-9_-]{32,128}$/
const HASH = /^[a-f0-9]{64}$/
const RISK = /^[a-z][a-z0-9-]{0,31}$/
const ORIGINS = new Set(['chat', 'background'])
const DECISIONS = new Set(['approve', 'deny'])
const REQUEST_FIELDS = new Set([
  'schema', 'id', 'botId', 'actionId', 'nonce', 'actionHash', 'action',
  'risk', 'origin', 'createdAt', 'expiresAt',
])
const DECISION_FIELDS = new Set([
  'schema', 'id', 'botId', 'actionId', 'actionHash', 'nonce',
  'decision', 'decidedAt', 'decisionId',
])

/** The protocol records decisions; the local executor runs approved actions. */
export const EXECUTION = Object.freeze({
  available: true,
  mode: 'local',
})

/** A rejected approval operation. `field` names the offending input when known. */
export class ApprovalError extends Error {
  constructor(code, message, { field } = {}) {
    super(message)
    this.name = 'ApprovalError'
    this.code = code
    if (field) this.field = field
  }
}

const fail = (code, message, options) => { throw new ApprovalError(code, message, options) }
const invalid = (message, options) => fail(ERROR_CODES.approvalInvalid, message, options)
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function textOf(value, field, pattern) {
  if (typeof value !== 'string') invalid(`${field} must be a string.`, { field })
  const text = value.trim()
  if (text === '') invalid(`${field} is required.`, { field })
  if (pattern && !pattern.test(text)) invalid(`${field} has an invalid format.`, { field })
  return text
}

function timestampOf(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    invalid(`${field} must be an ISO 8601 timestamp.`, { field })
  }
  return new Date(Date.parse(value)).toISOString()
}

function isoNow(now) {
  const date = new Date(now)
  if (Number.isNaN(date.getTime())) invalid('now must be a valid date.', { field: 'now' })
  return date.toISOString()
}

function jsonSafe(value, field, { max = ACTION_MAX_BYTES, object = false } = {}) {
  if (object && !isObject(value)) invalid(`${field} must be a JSON object.`, { field })
  let text
  try {
    text = JSON.stringify(value)
  } catch {
    invalid(`${field} must be JSON-serializable.`, { field })
  }
  if (text === undefined) invalid(`${field} must be JSON-serializable.`, { field })
  if (Buffer.byteLength(text, 'utf8') > max) invalid(`${field} is too large.`, { field })
  return JSON.parse(text)
}

function riskOf(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    invalid('risk must be a non-empty array of at most 8 risk tags.', { field: 'risk' })
  }
  const seen = new Set()
  return value.map((item) => {
    const tag = textOf(item, 'risk', RISK)
    if (seen.has(tag)) invalid(`risk repeats ${tag}.`, { field: 'risk' })
    seen.add(tag)
    return tag
  })
}

function originOf(value) {
  const origin = textOf(value, 'origin')
  if (!ORIGINS.has(origin)) invalid('origin must be chat or background.', { field: 'origin' })
  return origin
}

function expiresAtOf(value, origin, createdAt, { defaultBackground = false } = {}) {
  const createdMs = Date.parse(createdAt)
  if (origin === 'chat') {
    if (value !== null && value !== undefined) invalid('chat requests must set expiresAt to null.', { field: 'expiresAt' })
    return null
  }
  let expiresAt
  if (value === undefined || value === null) {
    if (!defaultBackground) invalid('background requests require expiresAt.', { field: 'expiresAt' })
    expiresAt = new Date(createdMs + DEFAULT_BACKGROUND_TTL_MS).toISOString()
  } else {
    expiresAt = timestampOf(value, 'expiresAt')
  }
  const expiresMs = Date.parse(expiresAt)
  if (expiresMs <= createdMs) invalid('expiresAt must be after createdAt.', { field: 'expiresAt' })
  if (expiresMs > createdMs + DEFAULT_BACKGROUND_TTL_MS) {
    invalid('background requests expire within 30 minutes.', { field: 'expiresAt' })
  }
  return expiresAt
}

function compareCodePoints(left, right) {
  const a = Array.from(left)
  const b = Array.from(right)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const delta = a[index].codePointAt(0) - b[index].codePointAt(0)
    if (delta !== 0) return delta
  }
  return a.length - b.length
}

/** A small canonical serializer: sorted keys, no whitespace, JSON primitives. */
export function canonicalJson(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid('canonical JSON cannot encode a non-finite number.')
    return JSON.stringify(value)
  }
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (isObject(value)) {
    const keys = Object.keys(value).sort(compareCodePoints)
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return invalid('canonical JSON only accepts JSON values.')
}

/**
 * Hash the action-binding fields. The request stores this value; a decision
 * recomputes it locally and must match exactly.
 */
export function actionHashFor({ botId, actionId, action, risk, origin, expiresAt }) {
  const bot = assertBotId(botId)
  const id = textOf(actionId, 'actionId', ID)
  const payload = {
    schema: APPROVAL_SCHEMA_VERSION,
    botId: bot,
    actionId: id,
    action: jsonSafe(action, 'action', { object: true }),
    risk: riskOf(risk),
    origin: originOf(origin),
    expiresAt: expiresAt === null ? null : timestampOf(expiresAt, 'expiresAt'),
  }
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

function validateRequest(value) {
  if (!isObject(value)) invalid('approval request must be a JSON object.')
  for (const key of Object.keys(value)) {
    if (!REQUEST_FIELDS.has(key)) invalid(`unknown approval field: ${key}.`, { field: key })
  }
  if (value.schema !== APPROVAL_SCHEMA_VERSION) invalid('unsupported approval schema.', { field: 'schema' })
  const id = textOf(value.id, 'id', ID)
  let botId
  try {
    botId = assertBotId(value.botId)
  } catch {
    invalid('botId must be kebab-case.', { field: 'botId' })
  }
  const actionId = textOf(value.actionId, 'actionId', ID)
  const nonce = textOf(value.nonce, 'nonce', NONCE)
  const createdAt = timestampOf(value.createdAt, 'createdAt')
  const origin = originOf(value.origin)
  if (!Object.hasOwn(value, 'expiresAt')) invalid('expiresAt is required (null for chat).', { field: 'expiresAt' })
  const expiresAt = expiresAtOf(value.expiresAt, origin, createdAt)
  const action = jsonSafe(value.action, 'action', { object: true })
  const risk = riskOf(value.risk)
  const expected = actionHashFor({ botId, actionId, action, risk, origin, expiresAt })
  const actionHash = textOf(value.actionHash, 'actionHash', HASH)
  if (actionHash !== expected) invalid('actionHash does not match the action.', { field: 'actionHash' })
  return {
    schema: APPROVAL_SCHEMA_VERSION,
    id,
    botId,
    actionId,
    nonce,
    actionHash,
    action,
    risk,
    origin,
    createdAt,
    expiresAt,
  }
}

function validateDecision(value, request) {
  if (!isObject(value)) invalid('approval decision must be a JSON object.')
  for (const key of Object.keys(value)) {
    if (!DECISION_FIELDS.has(key)) invalid(`unknown decision field: ${key}.`, { field: key })
  }
  if (value.schema !== APPROVAL_SCHEMA_VERSION) invalid('unsupported decision schema.', { field: 'schema' })
  if (value.id !== request.id) invalid('decision id does not match the request.', { field: 'id' })
  if (value.botId !== request.botId) invalid('decision botId does not match the request.', { field: 'botId' })
  if (value.actionId !== request.actionId) invalid('decision actionId does not match the request.', { field: 'actionId' })
  if (value.nonce !== request.nonce) invalid('decision nonce does not match the request.', { field: 'nonce' })
  if (value.actionHash !== request.actionHash) invalid('decision actionHash does not match the request.', { field: 'actionHash' })
  if (!DECISIONS.has(value.decision)) invalid('decision must be approve or deny.', { field: 'decision' })
  const decidedAt = timestampOf(value.decidedAt, 'decidedAt')
  const decisionId = textOf(value.decisionId, 'decisionId', ID)
  return {
    schema: APPROVAL_SCHEMA_VERSION,
    id: request.id,
    botId: request.botId,
    actionId: request.actionId,
    actionHash: request.actionHash,
    nonce: request.nonce,
    decision: value.decision,
    decidedAt,
    decisionId,
  }
}

function isExpired(request, now) {
  return request.expiresAt !== null && Date.parse(request.expiresAt) <= now
}

function publicApproval(request, decision, now) {
  const state = decision
    ? (decision.decision === 'approve' ? 'approved' : 'denied')
    : isExpired(request, now) ? 'expired' : 'pending'
  return {
    id: request.id,
    botId: request.botId,
    actionId: request.actionId,
    action: request.action,
    risk: request.risk,
    origin: request.origin,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    state,
    ...(decision === null ? {} : {
      decision: {
        decision: decision.decision,
        decidedAt: decision.decidedAt,
        decisionId: decision.decisionId,
      },
    }),
  }
}

function readJsonFile(filename, { missing = null } = {}) {
  let text
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return missing
    throw error
  }
  try {
    return JSON.parse(text)
  } catch {
    invalid(`approval file is not valid JSON: ${path.basename(filename)}.`)
  }
}

export function appendAudit(root, line) {
  const directory = ensureDirectory(path.join(root, 'logs'))
  appendFileSync(path.join(directory, 'audit.log'), `${JSON.stringify(line)}\n`, { mode: 0o600 })
}

/**
 * Open the approval store under one state directory.
 * @param {string} stateRoot Absolute directory that also holds `bots/` and `logs/`.
 */
export function openApprovalStore(stateRoot) {
  const root = path.resolve(stateRoot)

  function botRoot(botId) {
    return path.join(root, 'bots', assertBotId(botId))
  }

  function approvalsRoot(botId) {
    return path.join(botRoot(botId), 'approvals')
  }

  function requestPath(botId, id) {
    return path.join(approvalsRoot(botId), `req-${id}.json`)
  }

  function decisionPath(botId, id) {
    return path.join(approvalsRoot(botId), `res-${id}.json`)
  }

  function requireBot(botId) {
    const bot = assertBotId(botId)
    if (!existsSync(path.join(root, 'bots', bot, 'bot.json'))) {
      const error = new Error(`Unknown bot: ${bot}.`)
      error.code = ERROR_CODES.botUnknown
      throw error
    }
    return bot
  }

  function readRequest(botId, id, { missing = 'unknown' } = {}) {
    const value = readJsonFile(requestPath(botId, id), { missing: null })
    if (value === null) {
      if (missing === 'unknown') fail(ERROR_CODES.approvalUnknown, `Unknown approval: ${id}.`)
      return null
    }
    const request = validateRequest(value)
    if (request.id !== id) invalid('request id does not match its filename.')
    return request
  }

  function readDecision(botId, id, request) {
    const value = readJsonFile(decisionPath(botId, id), { missing: null })
    return value === null ? null : validateDecision(value, request)
  }

  function createRequest(input, { now = Date.now() } = {}) {
    if (!isObject(input)) invalid('approval request input must be an object.')
    const botId = requireBot(input.botId)
    const id = input.id === undefined ? randomUUID() : textOf(input.id, 'id', ID)
    const actionId = textOf(input.actionId, 'actionId', ID)
    const createdAt = isoNow(now)
    const origin = originOf(input.origin)
    const expiresAt = expiresAtOf(input.expiresAt, origin, createdAt, { defaultBackground: true })
    const action = jsonSafe(input.action, 'action', { object: true })
    const risk = riskOf(input.risk)
    const nonce = input.nonce === undefined ? randomBytes(32).toString('hex') : textOf(input.nonce, 'nonce', NONCE)
    const request = validateRequest({
      schema: APPROVAL_SCHEMA_VERSION,
      id,
      botId,
      actionId,
      nonce,
      actionHash: actionHashFor({ botId, actionId, action, risk, origin, expiresAt }),
      action,
      risk,
      origin,
      createdAt,
      expiresAt,
    })
    ensureDirectory(approvalsRoot(botId))
    try {
      writeJsonOnce(requestPath(botId, id), request)
    } catch (error) {
      if (error?.code === 'EEXIST') fail(ERROR_CODES.approvalReplay, `Approval already exists: ${id}.`)
      throw error
    }
    appendAudit(root, {
      at: createdAt,
      event: 'request',
      requestId: id,
      botId,
      actionId,
      nonce,
      actionHash: request.actionHash,
      origin,
      expiresAt,
    })
    return publicApproval(request, null, now)
  }

  function list(botId, { now = Date.now() } = {}) {
    const bot = requireBot(botId)
    let entries
    try {
      entries = readdirSync(approvalsRoot(bot), { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return []
      throw error
    }
    const approvals = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith('req-') || !entry.name.endsWith('.json')) continue
      const id = entry.name.slice(4, -5)
      try {
        const request = readRequest(bot, id)
        const decision = readDecision(bot, id, request)
        approvals.push(publicApproval(request, decision, now))
      } catch (error) {
        approvals.push({
          id,
          botId: bot,
          state: 'invalid',
          code: error?.code ?? ERROR_CODES.approvalInvalid,
        })
      }
    }
    return approvals.sort((left, right) => {
      const a = left.createdAt ?? ''
      const b = right.createdAt ?? ''
      return b.localeCompare(a) || String(left.id).localeCompare(String(right.id))
    })
  }

  function get(botId, id, { now = Date.now() } = {}) {
    const bot = requireBot(botId)
    const requestId = textOf(id, 'id', ID)
    const request = readRequest(bot, requestId)
    const decision = readDecision(bot, requestId, request)
    return publicApproval(request, decision, now)
  }

  function decide(botId, id, decisionValue, { now = Date.now() } = {}) {
    const bot = requireBot(botId)
    const requestId = textOf(id, 'id', ID)
    if (!DECISIONS.has(decisionValue)) invalid('decision must be approve or deny.', { field: 'decision' })
    let request
    try {
      request = readRequest(bot, requestId)
    } catch (error) {
      appendAudit(root, { at: isoNow(now), event: 'refused', requestId, botId: bot, code: error?.code ?? ERROR_CODES.approvalInvalid })
      throw error
    }
    if (isExpired(request, now)) {
      appendAudit(root, { at: isoNow(now), event: 'refused', requestId, botId: bot, code: ERROR_CODES.approvalExpired })
      fail(ERROR_CODES.approvalExpired, `Approval expired: ${requestId}.`)
    }

    let existing
    try {
      existing = readDecision(bot, requestId, request)
    } catch (error) {
      appendAudit(root, { at: isoNow(now), event: 'refused', requestId, botId: bot, code: error?.code ?? ERROR_CODES.approvalInvalid })
      throw error
    }
    if (existing !== null) {
      if (existing.decision === decisionValue) {
        return { approval: publicApproval(request, existing, now), idempotent: true, execution: EXECUTION }
      }
      appendAudit(root, { at: isoNow(now), event: 'refused', requestId, botId: bot, code: ERROR_CODES.approvalReplay })
      fail(ERROR_CODES.approvalReplay, `Approval already decided: ${requestId}.`)
    }

    const decision = {
      schema: APPROVAL_SCHEMA_VERSION,
      id: request.id,
      botId: request.botId,
      actionId: request.actionId,
      actionHash: request.actionHash,
      nonce: request.nonce,
      decision: decisionValue,
      decidedAt: isoNow(now),
      decisionId: `dec-${randomUUID()}`,
    }
    const validated = validateDecision(decision, request)
    try {
      writeJsonOnce(decisionPath(bot, requestId), validated)
    } catch (error) {
      if (error?.code === 'EEXIST') {
        let winner
        try {
          winner = readDecision(bot, requestId, request)
        } catch (readError) {
          appendAudit(root, { at: isoNow(now), event: 'refused', requestId, botId: bot, code: readError?.code ?? ERROR_CODES.approvalInvalid })
          throw readError
        }
        if (winner !== null && winner.decision === decisionValue) {
          return { approval: publicApproval(request, winner, now), idempotent: true, execution: EXECUTION }
        }
        appendAudit(root, { at: isoNow(now), event: 'refused', requestId, botId: bot, code: ERROR_CODES.approvalReplay })
        fail(ERROR_CODES.approvalReplay, `Approval already decided: ${requestId}.`)
      }
      throw error
    }
    appendAudit(root, {
      at: validated.decidedAt,
      event: 'decision',
      requestId,
      botId: bot,
      actionId: request.actionId,
      nonce: request.nonce,
      actionHash: request.actionHash,
      decision: validated.decision,
      decidedAt: validated.decidedAt,
      decisionId: validated.decisionId,
    })
    return { approval: publicApproval(request, validated, now), idempotent: false, execution: EXECUTION }
  }

  return { list, get, createRequest, decide }
}
