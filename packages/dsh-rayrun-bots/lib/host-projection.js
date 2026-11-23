/**
 * Project the cloud-host assets into the user's machine workspace.
 *
 * The host entry point is shipped with this package, then uploaded through the
 * dependency's `rayrun_files` tool into a versioned directory:
 *
 *   /workspace/.rayrun/host/<version>/host.mjs
 *   /workspace/.rayrun/host/<version>/lib/host.mjs
 *   /workspace/.rayrun/host/<version>/lib/dsh-agent.mjs
 *   /workspace/.rayrun/host/<version>/lib/proposal.mjs
 *   /workspace/.rayrun/host/<version>/lib/routines.mjs
 *   /workspace/.rayrun/host/<version>/lib/prompt.mjs
 *   /workspace/.rayrun/host/<version>/bin/propose.mjs
 *
 * A SHA-256 manifest makes a partial or tampered projection fail closed. The
 * workspace is writable by the cloud agent; this is code delivery, not a
 * security boundary. ADR-019 keeps approval authority and local actions on the
 * user's side.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ERROR_CODES } from './errors.js'
import { rayrunFailure } from './rayrun-rpc.js'

const PACKAGE = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  } catch {
    return {}
  }
})()

/** Version directory for the projected host. */
export const HOST_ASSET_VERSION = typeof PACKAGE.version === 'string' ? PACKAGE.version : '0.0.0'
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const HOST_ROOT = new URL('../cloud-host/', import.meta.url)
const HOST_FILES = ['host.mjs', 'lib/host.mjs', 'lib/dsh-agent.mjs', 'lib/proposal.mjs', 'lib/routines.mjs', 'lib/prompt.mjs', 'bin/propose.mjs']

function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}

/** Read the shipped host assets. Exported for tests and diagnostics. */
export function hostAssetFiles() {
  return HOST_FILES.map((relative) => {
    const content = readFileSync(fileURLToPath(new URL(relative, HOST_ROOT)), 'utf8')
    return { path: relative, content, sha256: sha256(content), bytes: Buffer.byteLength(content, 'utf8') }
  })
}

/** Deterministic manifest object for one version. */
export function hostAssetManifest(version = HOST_ASSET_VERSION) {
  return {
    schema: 1,
    version,
    files: hostAssetFiles().map(({ path: file, sha256: hash, bytes }) => ({ path: file, sha256: hash, bytes })),
  }
}

function sameManifest(left, right) {
  if (left?.schema !== 1 || left?.version !== right.version) return false
  if (!Array.isArray(left.files) || left.files.length !== right.files.length) return false
  for (let index = 0; index < right.files.length; index += 1) {
    const a = left.files[index]
    const b = right.files[index]
    if (a?.path !== b.path || a?.sha256 !== b.sha256 || a?.bytes !== b.bytes) return false
  }
  return true
}

/**
 * Ensure the versioned host assets and manifest are present and match.
 *
 * `read(path)` returns the remote text or null when the file is missing;
 * `write(path, text)` uploads it. Paths are relative to `/workspace`.
 * @param {{ read: (path: string) => Promise<string | null>, write: (path: string, text: string) => Promise<unknown>, version?: string }} options
 */
export async function projectHost({ read, write, version = HOST_ASSET_VERSION } = {}) {
  if (typeof read !== 'function' || typeof write !== 'function') {
    throw new TypeError('projectHost requires read and write functions')
  }
  if (!VERSION_PATTERN.test(version)) {
    throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'The cloud host version is not a safe path segment.')
  }
  const root = `.rayrun/host/${version}`
  const manifestPath = `${root}/manifest.json`
  const manifest = hostAssetManifest(version)
  const files = hostAssetFiles()
  const script = `/workspace/${root}/host.mjs`

  try {
    let remote = null
    const remoteText = await read(manifestPath)
    if (remoteText !== null) {
      try { remote = JSON.parse(remoteText) } catch { remote = null }
    }

    let needsUpload = !sameManifest(remote, manifest)
    if (!needsUpload) {
      for (const file of files) {
        const text = await read(`${root}/${file.path}`)
        if (text === null || sha256(text) !== file.sha256) {
          needsUpload = true
          break
        }
      }
    }

    if (needsUpload) {
      for (const file of files) {
        await write(`${root}/${file.path}`, file.content)
      }
      await write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

      const checkText = await read(manifestPath)
      let check = null
      try { check = checkText === null ? null : JSON.parse(checkText) } catch { check = null }
      if (!sameManifest(check, manifest)) {
        throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'The cloud host projection manifest did not survive upload.')
      }
      for (const file of files) {
        const text = await read(`${root}/${file.path}`)
        if (text === null || sha256(text) !== file.sha256) {
          throw rayrunFailure(ERROR_CODES.runtimeUnavailable, `The cloud host projection of ${file.path} is corrupt.`)
        }
      }
    }

    return { version, root, manifestPath, script, cached: !needsUpload }
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('E_')) throw error
    throw rayrunFailure(ERROR_CODES.runtimeUnavailable, `The cloud host projection failed: ${String(error?.message ?? error).slice(0, 200)}`)
  }
}
