/**
 * Host-side client for `dsh-rayrun-computer` 1.2+ `runtime.*` RPC.
 *
 * The platform supervises a long-lived process on the user's machine (R-G008).
 * This module only names the action and forwards the spec; the dependency owns
 * the Rayrun token and the platform call. Runtime names and specs are validated
 * by the dependency; callers must not put credential values in `spec.env`.
 */
import { createRayrunRpc } from './rayrun-rpc.js'

const RUNTIME_TIMEOUT_MS = 60_000

/** @param {{ getOrigin?: () => string | undefined, fetchImpl?: Function }} options */
export function createRuntimeRpc({ getOrigin, fetchImpl } = {}) {
  const rpc = createRayrunRpc({ getOrigin, fetchImpl })
  const call = (action, payload) => rpc.call(action, payload, { timeoutMs: RUNTIME_TIMEOUT_MS })
  return {
    put: (sandbox, name, spec) => call('runtime.put', { sandbox, name, spec }),
    list: (sandbox) => call('runtime.list', { sandbox }),
    get: (sandbox, name) => call('runtime.get', { sandbox, name }),
    start: (sandbox, name) => call('runtime.start', { sandbox, name }),
    stop: (sandbox, name) => call('runtime.stop', { sandbox, name }),
    restart: (sandbox, name) => call('runtime.restart', { sandbox, name }),
    delete: (sandbox, name) => call('runtime.delete', { sandbox, name }),
  }
}

/**
 * Create the runtime only when it is absent; leave an existing one untouched.
 * Updating a running host is an explicit `put` by the caller.
 * @param {ReturnType<typeof createRuntimeRpc>} client
 * @param {{ sandbox: string, name: string, spec: object }} input
 */
export async function ensureRuntime(client, { sandbox, name, spec }) {
  const current = await client.get(sandbox, name)
  if (current?.runtime) return { ...current, created: false }
  const created = await client.put(sandbox, name, spec)
  return { ...created, created: true }
}
