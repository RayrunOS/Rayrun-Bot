/**
 * Shared host-side caller for `dsh-rayrun-computer`'s same-origin RPC.
 *
 * Both runtime adapters use it: the single-turn `rayrun_agent` tool path and the
 * detached `dsh.start/status/result` path. The Rayrun token stays inside the
 * dependency; this module only sends action names and task data, and never
 * reads a credential.
 */
import { ERROR_CODES } from './errors.js'

/** Mirrors the Bots client's preferred machine name. */
export const DEFAULT_COMPUTER = 'rayrun-bot'

const DEPENDENCY_CODES = new Map([
  ['token_required', ERROR_CODES.tokenRequired],
  ['unauthorized', ERROR_CODES.tokenRequired],
  ['invalid_token', ERROR_CODES.tokenRequired],
  ['key_required', ERROR_CODES.keyRequired],
  ['model_credential_required', ERROR_CODES.keyRequired],
  ['sandbox_required', ERROR_CODES.machineStopped],
  ['sandbox_missing', ERROR_CODES.machineStopped],
  ['sandbox_not_running', ERROR_CODES.machineStopped],
  ['sandbox_paused', ERROR_CODES.machinePaused],
  ['sandbox_busy', ERROR_CODES.machineBusy],
  ['guestd_outdated', ERROR_CODES.guestdOutdated],
  ['invalid_runtime_name', ERROR_CODES.runtimeInvalid],
  ['invalid_runtime_spec', ERROR_CODES.runtimeInvalid],
  ['runtime_not_found', ERROR_CODES.runtimeNotFound],
  ['runtimes_unavailable', ERROR_CODES.runtimesUnavailable],
  ['worker_files_unavailable', ERROR_CODES.runtimeUnavailable],
  ['workspace_locked', ERROR_CODES.machineBusy],
  ['balance_low', ERROR_CODES.balanceLow],
  ['insufficient_balance', ERROR_CODES.balanceLow],
  ['local_dir_required', ERROR_CODES.internal],
  ['local_dir_not_absolute', ERROR_CODES.internal],
  ['local_dir_missing', ERROR_CODES.internal],
  ['brief_incomplete', ERROR_CODES.internal],
  ['invalid_timeout', ERROR_CODES.internal],
  ['invalid_task_id', ERROR_CODES.internal],
  ['workspace_drift', ERROR_CODES.internal],
  ['workspace_not_mirrored', ERROR_CODES.internal],
  ['projection_not_applied', ERROR_CODES.internal],
  ['body_too_large', ERROR_CODES.internal],
  ['origin_mismatch', ERROR_CODES.internal],
  ['unsupported_action', ERROR_CODES.internal],
])

export function rayrunFailure(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** Map a dependency error to a stable host code without copying its payload. */
export function dependencyFailure(error) {
  const raw = typeof error?.code === 'string' ? error.code : ''
  let code = raw.startsWith('E_') ? raw : DEPENDENCY_CODES.get(raw)
  if (!code && error?.status === 401) code = ERROR_CODES.tokenRequired
  if (!code && error?.status === 402) code = ERROR_CODES.balanceLow
  if (!code && error?.status === 404) code = ERROR_CODES.depMissing
  if (!code && error?.status === 409) code = ERROR_CODES.machineBusy
  const failure = rayrunFailure(code ?? ERROR_CODES.internal, String(error?.message ?? error ?? 'The cloud turn failed.'))
  // Keep the dependency's raw code for callers that need to distinguish a
  // transient cold-start 404 from a genuinely missing resource.
  if (raw !== '') failure.detailCode = raw
  return failure
}

function rpcFailure(body, status) {
  const detail = body?.error
  if (typeof detail === 'string') {
    const error = new Error(detail)
    error.status = status
    return error
  }
  const error = new Error(detail?.message ?? `Cloud-computer RPC failed (${status}).`)
  error.code = detail?.code ?? `http_${status}`
  error.status = status
  return error
}

/**
 * Create a caller bound to one DSH web origin.
 * @param {{ getOrigin?: () => string | undefined, fetchImpl?: Function }} options
 */
export function createRayrunRpc({ getOrigin, fetchImpl = globalThis.fetch } = {}) {
  async function call(action, payload = {}, { timeoutMs = 30_000 } = {}) {
    const origin = getOrigin?.()
    if (!origin) {
      throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'The DSH web server is not available; no turn was sent.')
    }
    if (typeof fetchImpl !== 'function') {
      throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'This runtime has no fetch implementation; no turn was sent.')
    }

    let response
    try {
      response = await fetchImpl(new URL('/plugins/rayrun/rpc', origin), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...payload }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw rayrunFailure(ERROR_CODES.internal, `The cloud-computer RPC timed out (${action}); no turn was sent.`)
      }
      throw rayrunFailure(ERROR_CODES.depMissing, 'The cloud-computer plugin is not reachable; no turn was sent.')
    }

    let body = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (!response.ok || body?.ok !== true) throw dependencyFailure(rpcFailure(body, response.status))
    return body
  }

  async function resolveMachine() {
    const body = await call('overview')
    if (body.connection?.configured !== true) {
      throw rayrunFailure(ERROR_CODES.tokenRequired, 'Connect Rayrun in Bots setup before sending a message.')
    }
    const machines = Array.isArray(body.machines)
      ? body.machines.filter((machine) => machine?.status !== 'Terminated')
      : []
    const machine = machines.find((item) => item.name === DEFAULT_COMPUTER)
      ?? machines.find((item) => item.remote_desktop && item.desktop_url)
      ?? machines[0]
    if (!machine) {
      throw rayrunFailure(ERROR_CODES.machineStopped, 'No cloud computer yet; create one in Bots setup first.')
    }
    if (!machine.name && !machine.id) {
      throw rayrunFailure(ERROR_CODES.machineStopped, 'The cloud computer has no name or id; no turn was sent.')
    }
    return machine
  }

  return { call, resolveMachine }
}
