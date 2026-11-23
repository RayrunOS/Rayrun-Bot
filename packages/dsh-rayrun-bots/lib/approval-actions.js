/**
 * Typed, local-only actions that may follow an approved proposal.
 *
 * The cloud bot may propose these actions, but it cannot execute them or write
 * a decision. The local host validates the action against this allowlist and
 * executes it with credentials that stay on this side. Never accept a shell
 * command, URL, or arbitrary executable payload here.
 */
import { ERROR_CODES } from './errors.js'

const MACHINE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const ACTION_FIELDS = new Set(['kind', 'machine'])

/**
 * Every allowed action is a typed Rayrun machine lifecycle change.
 * `destroy` and machine creation are deliberately absent.
 */
export const APPROVAL_ACTIONS = Object.freeze([
  Object.freeze({ kind: 'rayrun.machine.start', verb: 'start', risk: Object.freeze(['outside', 'cost']) }),
  Object.freeze({ kind: 'rayrun.machine.stop', verb: 'stop', risk: Object.freeze(['outside']) }),
  Object.freeze({ kind: 'rayrun.machine.pause', verb: 'pause', risk: Object.freeze(['outside']) }),
  Object.freeze({ kind: 'rayrun.machine.resume', verb: 'resume', risk: Object.freeze(['outside', 'cost']) }),
])

const BY_KIND = new Map(APPROVAL_ACTIONS.map((entry) => [entry.kind, entry]))

export class ApprovalActionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApprovalActionError'
    this.code = code
  }
}

const fail = (code, message) => { throw new ApprovalActionError(code, message) }
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Validate an action proposed by the cloud. Unknown kinds and fields are
 * refused; risk is derived here, not trusted from the proposal.
 * @param {unknown} value
 */
export function normalizeApprovalAction(value) {
  if (!isObject(value)) fail(ERROR_CODES.approvalInvalid, 'The approval action must be an object.')
  for (const key of Object.keys(value)) {
    if (!ACTION_FIELDS.has(key)) fail(ERROR_CODES.approvalUnsupported, `Unsupported approval action field: ${key}.`)
  }
  const kind = typeof value.kind === 'string' ? value.kind.trim() : ''
  const definition = BY_KIND.get(kind)
  if (!definition) fail(ERROR_CODES.approvalUnsupported, 'This approval action is not supported.')
  const machine = typeof value.machine === 'string' ? value.machine.trim() : ''
  if (!MACHINE.test(machine)) {
    fail(ERROR_CODES.approvalInvalid, 'The approval action must name exactly one cloud computer.')
  }
  return {
    action: { kind, machine },
    verb: definition.verb,
    risk: [...definition.risk],
  }
}

/**
 * Build the local executor for typed approval actions. It uses only the
 * dependency's host-side Rayrun RPC; the token never enters the action or its
 * result.
 * @param {{ rpc: { call: (action: string, payload?: object, options?: object) => Promise<any> } }} options
 */
export function createApprovalActionExecutor({ rpc } = {}) {
  if (typeof rpc?.call !== 'function') throw new TypeError('approval action executor needs a Rayrun RPC client.')
  return async function execute(action) {
    const normalized = normalizeApprovalAction(action)
    let overview
    try {
      overview = await rpc.call('overview')
    } catch {
      fail(ERROR_CODES.approvalExecution, 'The local Rayrun connection is unavailable; no action was taken.')
    }
    const machines = Array.isArray(overview?.machines) ? overview.machines : []
    const matches = machines.filter((machine) => (
      machine?.id === normalized.action.machine || machine?.name === normalized.action.machine
    ))
    if (matches.length === 0) {
      fail(ERROR_CODES.machineStopped, 'The target cloud computer was not found; no action was taken.')
    }
    if (matches.length > 1) {
      fail(ERROR_CODES.approvalInvalid, 'The action target is ambiguous; no action was taken.')
    }
    const machine = matches[0]
    if (machine.status === 'Terminated') {
      fail(ERROR_CODES.machineStopped, 'The target cloud computer no longer exists; no action was taken.')
    }
    let result
    try {
      result = await rpc.call('machine.action', { id: machine.id, verb: normalized.verb }, { timeoutMs: 120_000 })
    } catch {
      fail(ERROR_CODES.approvalExecution, 'The cloud computer action failed; no further action was taken.')
    }
    if (!result?.machine || typeof result.machine !== 'object') {
      fail(ERROR_CODES.approvalExecution, 'The cloud computer returned no state; no further action was taken.')
    }
    return {
      kind: normalized.action.kind,
      verb: normalized.verb,
      machine: String(result.machine.name ?? machine.name ?? machine.id),
      machineId: String(result.machine.id ?? machine.id),
      status: typeof result.machine.status === 'string' ? result.machine.status : null,
    }
  }
}
