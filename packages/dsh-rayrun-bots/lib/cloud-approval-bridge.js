/**
 * Import typed approval proposals from the bot's cloud workspace.
 *
 * The cloud bot only writes proposals; this bridge treats them as untrusted.
 * It lists `.rayrun/bots/<botId>/proposals/` through the dependency's
 * `rayrun_files` tool, re-validates each action against the local allowlist,
 * and creates a local request with local nonce/hash/risk. Decisions and execution
 * claims never cross this boundary. Results are written back to
 * `.rayrun/bots/<botId>/approval-results/` for the next bot turn.
 *
 * Syncing never starts a stopped machine; a stopped machine simply has no new
 * proposals to import (the bot is not running). No Rayrun token is read here.
 */
import { readdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { openApprovalStore } from './approvals.js'
import { normalizeApprovalAction } from './approval-actions.js'
import { assertBotId } from './bot-schema.js'
import { ERROR_CODES } from './errors.js'
import { ensureDirectory, writeJsonAtomic } from './local-store.js'
import { rayrunFailure } from './rayrun-rpc.js'

const MAX_PROPOSALS = 20
const MAX_PENDING_APPROVALS = 20
const MAX_PROPOSAL_BYTES = 16 * 1024
const MAX_RESULT_BYTES = 16 * 1024
const ID = /^[A-Za-z0-9._-]{1,80}$/
const ORIGINS = new Set(['chat', 'background'])
const PROPOSAL_FIELDS = new Set(['schema', 'id', 'botId', 'actionId', 'action', 'origin', 'createdAt'])

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function missingFile(error) {
  return error?.status === 404
    || error?.code === 'not_found'
    || error?.code === 'file_not_found'
    || /not found|404/i.test(String(error?.message ?? ''))
}

function parseListing(output) {
  const entries = []
  for (const line of String(output ?? '').split('\n')) {
    const match = /^-\s+(\S+)(?:\s+(\d+)\s+B)?\s*$/.exec(line.trim())
    if (!match) continue
    const name = match[1]
    if (!name.endsWith('.json') || name.startsWith('.')) continue
    entries.push({ name, size: match[2] === undefined ? null : Number(match[2]) })
  }
  return entries
}

function validateProposal(value, { botId, filename }) {
  if (!isObject(value)) fail('proposal must be a JSON object.')
  for (const key of Object.keys(value)) {
    if (!PROPOSAL_FIELDS.has(key)) fail(`unsupported proposal field: ${key}.`)
  }
  if (value.schema !== 1) fail('unsupported proposal schema.')
  if (typeof value.id !== 'string' || !ID.test(value.id) || filename !== `${value.id}.json`) {
    fail('proposal id must match its file name.')
  }
  if (value.botId !== botId) fail('proposal botId does not match the bot.')
  if (typeof value.actionId !== 'string' || !ID.test(value.actionId)) fail('proposal actionId is invalid.')
  if (!ORIGINS.has(value.origin)) fail('proposal origin must be chat or background.')
  if (value.createdAt !== undefined
    && (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)))) {
    fail('proposal createdAt must be an ISO timestamp.')
  }
  const normalized = normalizeApprovalAction(value.action)
  return {
    id: value.id,
    botId,
    actionId: value.actionId,
    action: normalized.action,
    risk: normalized.risk,
    origin: value.origin,
  }
}

function fail(message) {
  const error = new Error(message)
  error.code = ERROR_CODES.approvalInvalid
  throw error
}

/**
 * @param {{
 *   stateRoot: string,
 *   getTools?: () => object,
 *   getMachine?: () => Promise<{ id: string, name?: string, status?: string }>,
 *   now?: () => number,
 * }} options
 */
export function createCloudApprovalBridge({ stateRoot, getTools, getMachine, now = Date.now } = {}) {
  if (typeof stateRoot !== 'string' || stateRoot.trim() === '') {
    throw new TypeError('cloud approval bridge needs a stateRoot.')
  }
  if (typeof getMachine !== 'function') throw new TypeError('cloud approval bridge needs getMachine.')
  const root = stateRoot
  const store = openApprovalStore(root)

  function filesTool() {
    let tool
    try {
      tool = getTools?.()?.get?.('rayrun_files')
    } catch {
      tool = undefined
    }
    if (typeof tool?.execute !== 'function') {
      throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'dsh-rayrun-computer is missing the rayrun_files tool.')
    }
    return tool
  }

  async function machineForSync() {
    let machine
    try {
      machine = await getMachine()
    } catch (error) {
      if (error?.code === ERROR_CODES.machineStopped) return null
      throw error
    }
    if (!machine || machine.status !== 'Running') return null
    return machine
  }

  async function readProposal(tool, sandbox, botId, name, size) {
    if (size !== null && size > MAX_PROPOSAL_BYTES) {
      fail(`proposal ${name} is too large.`)
    }
    const text = await tool.execute({
      action: 'download',
      sandbox,
      path: `.rayrun/bots/${botId}/proposals/${name}`,
    }, { signal: AbortSignal.timeout(60_000) })
    if (typeof text !== 'string') fail(`proposal ${name} could not be read.`)
    if (Buffer.byteLength(text, 'utf8') > MAX_PROPOSAL_BYTES) fail(`proposal ${name} is too large.`)
    let value
    try {
      value = JSON.parse(text)
    } catch {
      fail(`proposal ${name} is not valid JSON.`)
    }
    return validateProposal(value, { botId, filename: name })
  }

  function localResultsDirectory(botId) {
    return path.join(root, 'bots', botId, 'approval-results')
  }

  /** Upload results that were queued while the machine was stopped. */
  async function flushResults(botId, machine) {
    let entries
    try {
      entries = readdirSync(localResultsDirectory(botId)).filter((name) => name.endsWith('.json')).sort()
    } catch (error) {
      if (error?.code === 'ENOENT') return 0
      throw error
    }
    if (entries.length === 0) return 0
    const tool = filesTool()
    const sandbox = machine.name || machine.id
    let flushed = 0
    for (const name of entries) {
      const local = path.join(localResultsDirectory(botId), name)
      const text = readFileSync(local, 'utf8')
      await tool.execute({
        action: 'upload',
        sandbox,
        path: `.rayrun/bots/${botId}/approval-results/${name}`,
        text,
      }, { signal: AbortSignal.timeout(60_000) })
      try { unlinkSync(local) } catch { /* a later sync will retry the upload */ }
      flushed += 1
    }
    return flushed
  }

  /** Import new proposals for one bot; never executes anything. */
  async function sync(botId) {
    const bot = assertBotId(botId)
    const machine = await machineForSync()
    if (machine === null) {
      return {
        imported: [], duplicates: 0, rejected: 0, truncated: false, flushed: 0, skipped: 'machine_not_running',
      }
    }
    let flushed = 0
    try {
      flushed = await flushResults(bot, machine)
    } catch {
      // Keep results queued; importing proposals must still work.
    }
    const tool = filesTool()
    const sandbox = machine.name || machine.id
    let output
    try {
      output = await tool.execute({
        action: 'list',
        sandbox,
        path: `.rayrun/bots/${bot}/proposals`,
      }, { signal: AbortSignal.timeout(60_000) })
    } catch (error) {
      if (missingFile(error)) {
        return { imported: [], duplicates: 0, rejected: 0, truncated: false, flushed }
      }
      throw error
    }
    const listed = parseListing(output)
    const pending = store.list(bot).filter((approval) => approval.state === 'pending').length
    const capacity = Math.max(0, MAX_PENDING_APPROVALS - pending)
    const selected = listed.slice(0, Math.min(MAX_PROPOSALS, capacity))
    const truncated = listed.length > selected.length
    const imported = []
    let duplicates = 0
    let rejected = 0

    for (const entry of selected) {
      let proposal
      try {
        proposal = await readProposal(tool, sandbox, bot, entry.name, entry.size)
      } catch (error) {
        if (error?.code === ERROR_CODES.approvalInvalid) {
          rejected += 1
          continue
        }
        if (missingFile(error)) {
          rejected += 1
          continue
        }
        throw error
      }
      try {
        store.createRequest({
          id: proposal.id,
          botId: bot,
          actionId: proposal.actionId,
          action: proposal.action,
          risk: proposal.risk,
          origin: proposal.origin,
        }, { now: now() })
        imported.push(proposal.id)
      } catch (error) {
        if (error?.code === ERROR_CODES.approvalReplay) {
          duplicates += 1
          continue
        }
        throw error
      }
    }

    return { imported, duplicates, rejected, truncated, flushed }
  }

  function sanitizeResult(value) {
    if (!isObject(value)) fail('approval result must be an object.')
    const execution = isObject(value.execution) ? value.execution : {}
    const result = isObject(execution.result) ? execution.result : null
    const sanitized = {
      schema: 1,
      state: typeof value.state === 'string' ? value.state.slice(0, 40) : 'unknown',
      execution: {
        state: typeof execution.state === 'string' ? execution.state.slice(0, 40) : null,
        ...(typeof execution.code === 'string' ? { code: execution.code.slice(0, 80) } : {}),
        ...(result === null ? {} : {
          result: {
            kind: typeof result.kind === 'string' ? result.kind.slice(0, 80) : null,
            verb: typeof result.verb === 'string' ? result.verb.slice(0, 40) : null,
            machine: typeof result.machine === 'string' ? result.machine.slice(0, 128) : null,
            machineId: typeof result.machineId === 'string' ? result.machineId.slice(0, 128) : null,
            status: typeof result.status === 'string' ? result.status.slice(0, 40) : null,
          },
        }),
      },
    }
    const text = JSON.stringify(sanitized)
    if (Buffer.byteLength(text, 'utf8') > MAX_RESULT_BYTES) fail('approval result is too large.')
    return sanitized
  }

  /** Write a sanitized decision/execution result for the next bot turn. */
  async function writeResult(botId, id, value) {
    const bot = assertBotId(botId)
    if (typeof id !== 'string' || !ID.test(id)) fail('approval result id is invalid.')
    const result = sanitizeResult(value)
    const payload = { ...result, id, botId: bot, at: new Date(now()).toISOString() }
    const directory = ensureDirectory(localResultsDirectory(bot))
    const local = path.join(directory, `${id}.json`)
    writeJsonAtomic(local, payload)

    const machine = await machineForSync()
    if (machine === null) return { ...payload, queued: true }
    const tool = filesTool()
    const sandbox = machine.name || machine.id
    await tool.execute({
      action: 'upload',
      sandbox,
      path: `.rayrun/bots/${bot}/approval-results/${id}.json`,
      text: `${JSON.stringify(payload, null, 2)}\n`,
    }, { signal: AbortSignal.timeout(60_000) })
    try { unlinkSync(local) } catch { /* the next sync retries if the upload succeeded */ }
    return { ...payload, queued: false }
  }

  return { sync, writeResult }
}

export { MAX_PENDING_APPROVALS, MAX_PROPOSALS, MAX_PROPOSAL_BYTES, MAX_RESULT_BYTES }
