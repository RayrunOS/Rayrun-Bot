/**
 * Runtime adapter contract for one bot turn.
 *
 * The host half never talks to Rayrun directly and never reads a credential.
 * A runtime object executes one turn and returns the bot's reply; the cloud
 * bridge that will implement this contract is not wired in this build. The
 * default runtime refuses every turn with `E_RUNTIME_UNAVAILABLE`, so a page
 * cannot mistake a preview for a real reply. Tests and the next slice inject a
 * runtime through `apply(ctx, { runtime })`.
 */
import { ERROR_CODES } from './errors.js'

export const RUNTIME_CONTRACT_VERSION = 1

/**
 * A runtime that refuses every turn. Fail closed; never fabricate a reply.
 * @param {string} [reason] One actionable line for the user.
 * @returns {{ contract: number, name: string, available: false, run: Function }}
 */
export function createUnavailableRuntime(reason = 'The cloud bot runtime is not wired in this build; no turn was sent.') {
  return Object.freeze({
    contract: RUNTIME_CONTRACT_VERSION,
    name: 'unavailable',
    available: false,
    async run() {
      const error = new Error(reason)
      error.code = ERROR_CODES.runtimeUnavailable
      throw error
    },
  })
}

/**
 * Check the shape of a runtime injected by the bridge or a test.
 *
 * A runtime runs one turn:
 *   `run({ bot, text, history, sessionId }) -> Promise<{ text: string }>`
 * where `text` is the turn to answer and `history` is the chronological
 * transcript, oldest first. The current message may already appear in history;
 * `text` is authoritative.
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
