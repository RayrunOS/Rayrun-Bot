/**
 * Runtime adapter contract for one bot turn.
 *
 * The host half never talks to Rayrun directly and never reads a credential.
 * The `rayrun_agent` adapter implements the single-turn `run` contract; the
 * `rayrun-detached` adapter implements `start/status/collect` so a cloud task
 * can outlive this host. Without either adapter every send fails closed. Tests
 * inject a runtime through `apply(ctx, { runtime })`.
 */

export const RUNTIME_CONTRACT_VERSION = 1

/**
 * Check the shape of a runtime injected by the bridge or a test.
 *
 * Single-turn runtimes implement:
 *   `run({ bot, text, history, sessionId, messageSeq }) -> Promise<{ text: string }>`
 * Detached runtimes set `detached: true` and implement:
 *   `start(input) -> { taskId, sandbox, localDir, timeoutSeconds, startedAt? }`
 *   `status({ detached }) -> { running: boolean }`
 *   `collect({ detached }) -> { running: boolean, text?: string }`
 * A detached runtime that reads the local checkout may also set
 * `usesLocalWorkspace: true`; the host then rejects a stale bound workspace
 * before queueing a turn.
 * `text` is the turn to answer; `history` is the chronological transcript.
 * @param {unknown} runtime
 * @returns {object} The validated runtime.
 */
export function validateRuntime(runtime) {
  if (typeof runtime !== 'object' || runtime === null) {
    throw new TypeError('runtime must be an object.')
  }
  if (typeof runtime.name !== 'string' || runtime.name.trim() === '') {
    throw new TypeError('runtime.name must be a non-empty string.')
  }
  if (runtime.available !== true && runtime.available !== false) {
    throw new TypeError('runtime.available must be a boolean.')
  }
  if (runtime.detached === true) {
    for (const method of ['start', 'status', 'collect']) {
      if (typeof runtime[method] !== 'function') {
        throw new TypeError(`runtime.${method} must be a function for a detached runtime.`)
      }
    }
  } else if (typeof runtime.run !== 'function') {
    throw new TypeError('runtime.run must be a function.')
  }
  if (runtime.contract !== undefined && runtime.contract !== RUNTIME_CONTRACT_VERSION) {
    throw new TypeError(`Unsupported runtime contract: ${runtime.contract}.`)
  }
  return runtime
}
