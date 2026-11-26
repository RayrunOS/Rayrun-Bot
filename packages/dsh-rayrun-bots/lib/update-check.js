/**
 * Read-only update check used by the Settings page.
 *
 * This module only reads the public npm dist-tags document for this package.
 * It does not download, install, modify the profile or touch a credential. The
 * page calls it explicitly through the same-origin host RPC; no background
 * polling and no telemetry.
 */
import { Buffer } from 'node:buffer'

export const UPDATE_PACKAGE = 'dsh-rayrun-bots'
export const UPDATE_REGISTRY = 'https://registry.npmjs.org'
const MAX_RESPONSE_BYTES = 64 * 1024
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

const parseVersion = (value) => {
  const match = VERSION.exec(String(value ?? ''))
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  }
}

function comparePre(left, right) {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (index >= left.length) return -1
    if (index >= right.length) return 1
    const a = left[index]
    const b = right[index]
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) {
      const diff = Number(a) - Number(b)
      if (diff !== 0) return diff < 0 ? -1 : 1
    } else if (aNumeric) {
      return -1
    } else if (bNumeric) {
      return 1
    } else if (a !== b) {
      return a < b ? -1 : 1
    }
  }
  return 0
}

/** Compare two semver strings; returns -1, 0 or 1. */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) throw new Error('compareVersions needs two semver strings.')
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  return comparePre(a.pre, b.pre)
}

/** Build the copyable update command. It is never executed by the plugin. */
export function updateCommand({ latest } = {}) {
  if (parseVersion(latest) === null) throw new Error('A valid update version is required.')
  return `npm_config_registry=${UPDATE_REGISTRY} dsh plugin --profile web add ${UPDATE_PACKAGE}@${latest}`
}

/**
 * Read npm dist-tags and compare the channel that matches this build.
 *
 * @param {{ current: string, fetchImpl?: typeof fetch, registry?: string, timeoutMs?: number }} options
 */
export async function checkForUpdate({
  current,
  fetchImpl = globalThis.fetch,
  registry = UPDATE_REGISTRY,
  timeoutMs = 8000,
} = {}) {
  if (typeof current !== 'string' || parseVersion(current) === null) {
    throw new Error('The current version is not valid semver.')
  }
  if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation is available.')
  const channel = current.includes('-') ? 'alpha' : 'latest'
  const url = `${registry}/-/package/${encodeURIComponent(UPDATE_PACKAGE)}/dist-tags`
  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response?.ok) {
    throw new Error(`npm returned HTTP ${Number(response?.status) || 0}.`)
  }
  const text = await response.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('npm returned an oversized dist-tags response.')
  }
  let tags
  try {
    tags = JSON.parse(text)
  } catch {
    throw new Error('npm returned invalid JSON.')
  }
  if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) {
    throw new Error('npm returned an invalid dist-tags document.')
  }
  const tagged = tags[channel]
  if (parseVersion(tagged) === null) {
    return { current, channel, latest: null, updateAvailable: false }
  }
  return {
    current,
    channel,
    latest: tagged,
    updateAvailable: compareVersions(tagged, current) > 0,
  }
}

export { parseVersion }
