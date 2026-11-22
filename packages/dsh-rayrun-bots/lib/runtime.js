/**
 * Runtime adapter contract for one bot turn.
 *
 * The host half never talks to Rayrun directly and never reads a credential.
 * The `rayrun_agent` adapter implements this contract when the dependency's
 * tool is registered; without it the adapter reports unavailable and every send
 * fails closed. Tests inject a runtime through `apply(ctx, { runtime })`.
 */

export const RUNTIME_CONTRACT_VERSION = 1

/**
 * Check the shape of a runtime injected by the bridge or a test.
 *
 * A runtime runs one turn:
 *   `run({ bot, text, history, sessionId, messageSeq }) -> Promise<{ text: string }>`
 * where `text` is the turn to answer, `messageSeq` is its transcript sequence
 * (when known), and `history` is the chronological transcript, oldest first.
 * The current message may already appear in history; `text` is authoritative.
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
  if (typeof runtime.run !== 'function') {
    throw new TypeError('runtime.run must be a function.')
  }
  if (runtime.contract !== undefined && runtime.contract !== RUNTIME_CONTRACT_VERSION) {
    throw new TypeError(`Unsupported runtime contract: ${runtime.contract}.`)
  }
  return runtime
}
