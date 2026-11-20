/**
 * Update manifest: canonical JSON, Ed25519 signatures, semver checks and shape
 * validation. Prototype only; see README.md for the production gaps.
 */
import { createPublicKey, sign, verify } from 'node:crypto'

export class UpdateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'UpdateError'
    this.code = code
  }
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const SHA256_RE = /^[0-9a-f]{64}$/

export function parseVersion(value) {
  if (typeof value !== 'string') {
    throw new UpdateError('E_VERSION', 'Version must be a string.')
  }
  const match = SEMVER_RE.exec(value)
  if (!match) {
    throw new UpdateError('E_VERSION', `Invalid semver: ${value}`)
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ? match[4].split('.') : [],
  }
}

function comparePrerelease(a, b) {
  if (!a.length && !b.length) return 0
  if (!a.length) return 1
  if (!b.length) return -1
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const left = a[i]
    const right = b[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const leftNumeric = /^\d+$/.test(left)
    const rightNumeric = /^\d+$/.test(right)
    if (leftNumeric && rightNumeric) {
      const diff = Number(left) - Number(right)
      if (diff !== 0) return diff > 0 ? 1 : -1
    } else if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    } else if (left !== right) {
      return left > right ? 1 : -1
    }
  }
  return 0
}

export function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left
  const b = typeof right === 'string' ? parseVersion(right) : right
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  return comparePrerelease(a.pre, b.pre)
}

export function canonicalize(value) {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new UpdateError('E_MANIFEST', 'Manifest contains a non-finite number.')
    }
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new UpdateError('E_MANIFEST', 'Manifest contains a non-plain object.')
    }
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`
  }
  throw new UpdateError('E_MANIFEST', `Manifest contains an unsupported value: ${typeof value}`)
}

export function manifestBody(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new UpdateError('E_MANIFEST', 'Manifest must be an object.')
  }
  const body = { ...manifest }
  delete body.signature
  return body
}

export function signManifest(manifest, privateKey) {
  const body = manifestBody(manifest)
  const signature = sign(null, Buffer.from(canonicalize(body)), privateKey).toString('base64')
  return { ...body, signature }
}

function verifySignature(manifest, publicKey) {
  if (!publicKey) {
    throw new UpdateError('E_SIGNATURE', 'A pinned public key is required.')
  }
  const signature = manifest.signature
  if (typeof signature !== 'string' || Buffer.from(signature, 'base64').length !== 64) {
    throw new UpdateError('E_SIGNATURE', 'Manifest signature is missing or malformed.')
  }
  let key
  try {
    key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey
  } catch {
    throw new UpdateError('E_SIGNATURE', 'The pinned public key is invalid.')
  }
  const ok = verify(
    null,
    Buffer.from(canonicalize(manifestBody(manifest))),
    key,
    Buffer.from(signature, 'base64'),
  )
  if (!ok) {
    throw new UpdateError('E_SIGNATURE', 'Manifest signature is invalid.')
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.includes('\0')) return false
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) return false
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new UpdateError('E_MANIFEST', `${name} must be a non-empty string.`)
  }
}

export function validateManifest(manifest, options = {}) {
  const { app, installedVersion, publicKey } = options
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new UpdateError('E_MANIFEST', 'Manifest must be an object.')
  }
  if (manifest.schema !== 1) {
    throw new UpdateError('E_MANIFEST', 'Unsupported manifest schema.')
  }
  requireString(manifest.app, 'app')
  if (app !== undefined && manifest.app !== app) {
    throw new UpdateError('E_MANIFEST', `Manifest is for ${manifest.app}, not ${app}.`)
  }
  requireString(manifest.version, 'version')
  requireString(manifest.minVersion, 'minVersion')
  if (manifest.dsh !== undefined) requireString(manifest.dsh, 'dsh')
  if (manifest.plugins !== undefined) {
    if (!manifest.plugins || typeof manifest.plugins !== 'object' || Array.isArray(manifest.plugins)) {
      throw new UpdateError('E_MANIFEST', 'plugins must be an object.')
    }
    for (const [name, version] of Object.entries(manifest.plugins)) {
      requireString(name, 'plugins key')
      requireString(version, `plugins.${name}`)
    }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new UpdateError('E_MANIFEST', 'files must be a non-empty array.')
  }
  const seen = new Set()
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new UpdateError('E_MANIFEST', 'Each file entry must be an object.')
    }
    if (!isSafeRelativePath(file.path)) {
      throw new UpdateError('E_MANIFEST', `Unsafe file path: ${String(file.path)}`)
    }
    if (seen.has(file.path)) {
      throw new UpdateError('E_MANIFEST', `Duplicate file path: ${file.path}`)
    }
    seen.add(file.path)
    if (typeof file.sha256 !== 'string' || !SHA256_RE.test(file.sha256)) {
      throw new UpdateError('E_MANIFEST', `Invalid sha256 for ${file.path}.`)
    }
  }

  verifySignature(manifest, publicKey)

  const target = parseVersion(manifest.version)
  const minimum = parseVersion(manifest.minVersion)
  if (compareVersions(minimum, target) > 0) {
    throw new UpdateError('E_VERSION', 'minVersion is newer than the target version.')
  }
  if (installedVersion !== undefined) {
    const installed = parseVersion(installedVersion)
    if (compareVersions(installed, minimum) < 0) {
      throw new UpdateError('E_VERSION', `Installed ${installedVersion} is below minVersion ${manifest.minVersion}.`)
    }
    if (compareVersions(target, installed) <= 0) {
      throw new UpdateError('E_VERSION', `Target ${manifest.version} is not newer than installed ${installedVersion}.`)
    }
  }
  return manifest
}
