/**
 * Detect the cloud-computer plugin this bundle builds on and check its version.
 *
 * The dependency stays a separate project; this module only reads the installed
 * package metadata from the current DSH profile. It never loads the dependency's
 * code and never touches a token.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const DEPENDENCY_NAME = 'dsh-rayrun-computer'

/** The supported dependency line. v0.1 uses the 1.x releases. */
export const DEPENDENCY_RANGE = '>=1.0.0 <2.0.0'

/** `dsh.start/status/result` arrived in the 1.1 line. */
export const DETACHED_MIN_VERSION = '1.1.0'

/** `runtime.*` arrived in the 1.2 line. */
export const RUNTIME_RPC_MIN_VERSION = '1.2.0'

/**
 * Whether an installed 1.x dependency exposes the host-callable detached RPC.
 * 1.0.x uses the single-turn `rayrun_agent` tool instead.
 * @param {string | null | undefined} version
 * @returns {boolean}
 */
export function supportsDetached(version) {
  if (typeof version !== 'string') return false
  const match = /^1\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version)
  if (!match) return false
  const minor = Number(match[1])
  return minor > 1 || (minor === 1 && Number(match[2]) >= 0)
}

/**
 * Whether an installed 1.x dependency exposes the host-callable `runtime.*`
 * RPC used by the persistent cloud bot host.
 * @param {string | null | undefined} version
 * @returns {boolean}
 */
export function supportsRuntimeRpc(version) {
  if (typeof version !== 'string') return false
  const match = /^1\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version)
  if (!match) return false
  const minor = Number(match[1])
  const patch = Number(match[2])
  return minor > 2 || (minor === 2 && patch >= 0)
}

/** Read the installed package manifest, distinguishing a missing package from a broken one. */
function readInstalled(profileDir) {
  const filename = path.join(profileDir, 'node_modules', DEPENDENCY_NAME, 'package.json')
  let text
  try {
    text = readFileSync(filename, 'utf8')
  } catch (error) {
    return error?.code === 'ENOENT' ? { found: false } : { found: true, broken: true }
  }
  try {
    const manifest = JSON.parse(text)
    if (typeof manifest?.version === 'string' && manifest.version.trim() !== '') {
      return { found: true, version: manifest.version.trim() }
    }
  } catch {
    // Fall through: an unreadable manifest is treated as an incompatible install.
  }
  return { found: true, broken: true }
}

/**
 * Check the dependency for one profile directory.
 *
 * - No profile context (tests, non-profile launches): `unknown`.
 * - Package absent: `missing` + `E_DEP_MISSING`.
 * - Package present but not 1.x or unreadable: `incompatible` + `E_DEP_VERSION`.
 *   The version boundary is intentionally fail-closed.
 *
 * @param {string | undefined} profileDir Absolute DSH profile directory.
 * @returns {{ name: string, required: string, version: string | null, status: string, code: string | null }}
 */
export function checkDependency(profileDir) {
  const base = { name: DEPENDENCY_NAME, required: DEPENDENCY_RANGE }
  if (!profileDir) return { ...base, version: null, status: 'unknown', code: null }

  const installed = readInstalled(profileDir)
  if (!installed.found) return { ...base, version: null, status: 'missing', code: 'E_DEP_MISSING' }
  if (installed.broken) return { ...base, version: null, status: 'incompatible', code: 'E_DEP_VERSION' }

  const version = installed.version
  const supported = /^1\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
  return {
    ...base,
    version,
    status: supported ? 'ok' : 'incompatible',
    code: supported ? null : 'E_DEP_VERSION',
  }
}
