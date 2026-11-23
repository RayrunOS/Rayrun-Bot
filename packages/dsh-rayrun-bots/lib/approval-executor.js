/**
 * Local, at-most-once execution for approved actions.
 *
 * The decision and the execution claim are separate files next to the request.
 * A claim is written before the side effect; if the process dies after that,
 * the claim stays `executing` and is never retried automatically. Repeating the
 * same approved decision returns the existing claim, so it cannot execute the
 * action twice. The cloud side never writes these files.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { assertBotId } from './bot-schema.js'
import { normalizeApprovalAction } from './approval-actions.js'
import { appendAudit, openApprovalStore } from './approvals.js'
import { ERROR_CODES } from './errors.js'
import { ensureDirectory, writeJsonAtomic, writeJsonOnce } from './local-store.js'

const CLAIM_SCHEMA_VERSION = 1
const SECRET = /(Bearer\s+)\S+|(sk-)[A-Za-z0-9_-]{8,}|((?:RAYRUN_TOKEN|DEEPSEEK_API_KEY|DEEPSEEK_KEY)\s*[=:]\s*)\S+/gi
const ID = /^[A-Za-z0-9._-]{1,80}$/

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
const isoNow = (now) => new Date(now()).toISOString()

function redact(value) {
  return String(value ?? '').replace(SECRET, (_match, bearer, openai, assignment) => {
    if (bearer) return `${bearer}[redacted]`
    if (openai) return '[redacted]'
    return `${assignment}[redacted]`
  }).slice(0, 300)
}

function readClaim(filename) {
  let text
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    const error = new Error('The approval execution record is not valid JSON.')
    error.code = ERROR_CODES.approvalInvalid
    throw error
  }
  if (!isObject(value)) {
    const error = new Error('The approval execution record is invalid.')
    error.code = ERROR_CODES.approvalInvalid
    throw error
  }
  if (value.schema !== CLAIM_SCHEMA_VERSION || !ID.test(String(value.id ?? ''))
    || !ID.test(String(value.actionId ?? '')) || typeof value.state !== 'string') {
    const error = new Error('The approval execution record is invalid.')
    error.code = ERROR_CODES.approvalInvalid
    throw error
  }
  return value
}

function publicExecution(claim) {
  return {
    available: true,
    mode: 'local',
    state: claim.state,
    startedAt: claim.startedAt ?? null,
    finishedAt: claim.finishedAt ?? null,
    ...(claim.result === undefined ? {} : { result: claim.result }),
    ...(claim.code === undefined ? {} : { code: claim.code }),
    ...(claim.error === undefined ? {} : { error: claim.error }),
  }
}

/**
 * @param {{
 *   stateRoot: string,
 *   execute: (action: object) => Promise<object>,
 *   now?: () => number,
 * }} options
 */
export function openApprovalExecutor({ stateRoot, execute, now = Date.now } = {}) {
  if (typeof execute !== 'function') throw new TypeError('approval executor needs an execute function.')
  const root = path.resolve(stateRoot)
  const store = openApprovalStore(root)

  function claimPath(botId, id) {
    return path.join(root, 'bots', assertBotId(botId), 'approvals', `exec-${id}.json`)
  }

  function refuse(botId, approval, code, message) {
    const file = claimPath(botId, approval.id)
    const at = isoNow(now)
    const claim = {
      schema: CLAIM_SCHEMA_VERSION,
      id: approval.id,
      botId,
      actionId: approval.actionId,
      state: 'refused',
      startedAt: at,
      finishedAt: at,
      code,
      error: redact(message),
    }
    ensureDirectory(path.dirname(file))
    try {
      writeJsonOnce(file, claim)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const existing = readClaim(file)
      if (existing === null) throw error
      return { ...publicExecution(existing), idempotent: true }
    }
    appendAudit(root, {
      at,
      event: 'execution-refused',
      requestId: approval.id,
      botId,
      actionId: approval.actionId,
      code,
    })
    return { ...publicExecution(claim), idempotent: false }
  }

  /**
   * Execute one approved request. Returns a structured status; a failed action
   * is recorded, not retried.
   */
  async function run(botId, id) {
    const bot = assertBotId(botId)
    if (!ID.test(String(id ?? ''))) {
      const error = new Error('approval id is invalid.')
      error.code = ERROR_CODES.approvalInvalid
      throw error
    }
    const approval = store.get(bot, id)
    if (approval.state !== 'approved') {
      return {
        available: true,
        mode: 'local',
        state: approval.state === 'expired' ? 'expired' : 'not_executed',
        reason: approval.state,
      }
    }
    const file = claimPath(bot, approval.id)
    const existing = readClaim(file)
    if (existing !== null) return { ...publicExecution(existing), idempotent: true }
    if (approval.expiresAt !== null && Date.parse(approval.expiresAt) <= now()) {
      return refuse(bot, approval, ERROR_CODES.approvalExpired, 'The approval expired before it was executed.')
    }
    try {
      normalizeApprovalAction(approval.action)
    } catch (error) {
      return refuse(bot, approval, error?.code ?? ERROR_CODES.approvalUnsupported, error?.message ?? 'Unsupported action.')
    }

    const claim = {
      schema: CLAIM_SCHEMA_VERSION,
      id: approval.id,
      botId: bot,
      actionId: approval.actionId,
      state: 'executing',
      startedAt: isoNow(now),
    }
    try {
      ensureDirectory(path.dirname(file))
      writeJsonOnce(file, claim)
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      const raced = readClaim(file)
      if (raced === null) throw error
      return { ...publicExecution(raced), idempotent: true }
    }

    appendAudit(root, {
      at: claim.startedAt,
      event: 'execution-start',
      requestId: approval.id,
      botId: bot,
      actionId: approval.actionId,
    })
    try {
      const result = await execute(approval.action)
      const done = {
        ...claim,
        state: 'done',
        finishedAt: isoNow(now),
        result: isObject(result) ? result : { value: redact(result) },
      }
      writeJsonAtomic(file, done)
      appendAudit(root, {
        at: done.finishedAt,
        event: 'execution-done',
        requestId: approval.id,
        botId: bot,
        actionId: approval.actionId,
      })
      return { ...publicExecution(done), idempotent: false }
    } catch (error) {
      const failed = {
        ...claim,
        state: 'failed',
        finishedAt: isoNow(now),
        code: typeof error?.code === 'string' ? error.code : ERROR_CODES.approvalExecution,
        error: redact(error?.message ?? error),
      }
      writeJsonAtomic(file, failed)
      appendAudit(root, {
        at: failed.finishedAt,
        event: 'execution-failed',
        requestId: approval.id,
        botId: bot,
        actionId: approval.actionId,
        code: failed.code,
      })
      return { ...publicExecution(failed), idempotent: false }
    }
  }

  /** Return the recorded execution state, or null when it has not started. */
  function status(botId, id) {
    const bot = assertBotId(botId)
    if (!ID.test(String(id ?? ''))) {
      const error = new Error('approval id is invalid.')
      error.code = ERROR_CODES.approvalInvalid
      throw error
    }
    const claim = readClaim(claimPath(bot, id))
    return claim === null ? null : publicExecution(claim)
  }

  return { run, status }
}
