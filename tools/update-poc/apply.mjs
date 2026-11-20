/**
 * Staged, fail-closed update application: verify the manifest and artifact,
 * copy into a staging directory, switch a version pointer, keep one rollback
 * target. Prototype only; see README.md for the production gaps.
 */
import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  copyFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { UpdateError, parseVersion, validateManifest } from './manifest.mjs'

const STATE_FILE = 'state.json'
const VERSIONS_DIR = 'versions'

function suffix() {
  return `${process.pid}-${randomBytes(8).toString('hex')}`
}

function assertInside(root, target) {
  const rootPath = resolve(root)
  const targetPath = resolve(target)
  if (targetPath !== rootPath && !targetPath.startsWith(rootPath + sep)) {
    throw new UpdateError('E_PATH', `Path escapes the target root: ${target}`)
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function statePath(targetRoot) {
  return join(targetRoot, STATE_FILE)
}

function validVersionEntry(entry, name) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new UpdateError('E_STATE', `${name} must be an object.`)
  }
  if (typeof entry.version !== 'string' || entry.version.length === 0) {
    throw new UpdateError('E_STATE', `${name}.version must be a string.`)
  }
  try {
    parseVersion(entry.version)
  } catch {
    throw new UpdateError('E_STATE', `${name}.version is not a semver string.`)
  }
  if (entry.dir !== `${VERSIONS_DIR}/${entry.version}`) {
    throw new UpdateError('E_STATE', `${name}.dir must be versions/<version>.`)
  }
}

export function readState(targetRoot) {
  const path = statePath(targetRoot)
  if (!existsSync(path)) return null
  let state
  try {
    state = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw new UpdateError('E_STATE', 'state.json is not valid JSON.')
  }
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.schema !== 1) {
    throw new UpdateError('E_STATE', 'state.json has an unsupported schema.')
  }
  if (typeof state.app !== 'string' || state.app.length === 0) {
    throw new UpdateError('E_STATE', 'state.json is missing app.')
  }
  validVersionEntry(state.current, 'current')
  if (state.previous !== null) validVersionEntry(state.previous, 'previous')
  return state
}

function writeState(targetRoot, state) {
  mkdirSync(targetRoot, { recursive: true })
  const path = statePath(targetRoot)
  const temporary = join(targetRoot, `.state-${suffix()}.tmp`)
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

function walkFiles(directory, base = directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new UpdateError('E_ARTIFACT', `Artifact directory is missing: ${directory}`)
  }
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new UpdateError('E_ARTIFACT', `Symlinks are not allowed: ${relative(base, full)}`)
    }
    if (entry.isDirectory()) {
      files.push(...walkFiles(full, base))
    } else if (entry.isFile()) {
      files.push(relative(base, full).split(sep).join('/'))
    } else {
      throw new UpdateError('E_ARTIFACT', `Unsupported artifact entry: ${relative(base, full)}`)
    }
  }
  return files
}

function verifyArtifact(artifactDir, manifest) {
  const present = walkFiles(artifactDir).sort()
  const expected = new Set(manifest.files.map((file) => file.path))
  for (const path of present) {
    if (!expected.has(path)) {
      throw new UpdateError('E_ARTIFACT', `Unexpected artifact file: ${path}`)
    }
  }
  for (const file of manifest.files) {
    const full = join(artifactDir, file.path)
    assertInside(artifactDir, full)
    if (!existsSync(full) || !statSync(full).isFile()) {
      throw new UpdateError('E_ARTIFACT', `Missing artifact file: ${file.path}`)
    }
    if (sha256File(full) !== file.sha256) {
      throw new UpdateError('E_HASH', `Hash mismatch for ${file.path}.`)
    }
  }
}

/**
 * Apply a verified update. The target layout is:
 *
 *   targetRoot/
 *   ├── versions/<version>/...
 *   ├── versions/<previous>/...
 *   └── state.json
 *
 * The switch is one atomic state.json rename; the previous version stays for
 * rollback. Any failure before the rename removes the staging directory.
 */
export function stageUpdate({
  artifactDir,
  manifest,
  targetRoot,
  publicKey,
  installedVersion,
  app,
  hooks = {},
}) {
  if (typeof installedVersion !== 'string') {
    throw new UpdateError('E_STATE', 'installedVersion is required.')
  }
  const verified = validateManifest(manifest, { app, installedVersion, publicKey })
  verifyArtifact(artifactDir, verified)

  mkdirSync(targetRoot, { recursive: true })
  const versionsDir = join(targetRoot, VERSIONS_DIR)
  mkdirSync(versionsDir, { recursive: true })

  const state = readState(targetRoot)
  if (state && state.current.version !== installedVersion) {
    throw new UpdateError(
      'E_STATE',
      `Installed state is ${state.current.version}, not ${installedVersion}.`,
    )
  }
  if (state) {
    if (state.app !== verified.app) {
      throw new UpdateError('E_STATE', `Installed app is ${state.app}, not ${verified.app}.`)
    }
    const currentDir = join(targetRoot, state.current.dir)
    assertInside(targetRoot, currentDir)
    if (!existsSync(currentDir) || !statSync(currentDir).isDirectory()) {
      throw new UpdateError('E_STATE', 'The current version directory is missing.')
    }
  }

  const versionDir = join(versionsDir, verified.version)
  assertInside(targetRoot, versionDir)
  if (existsSync(versionDir)) {
    throw new UpdateError('E_STATE', `Version directory already exists: ${verified.version}`)
  }

  const staging = join(versionsDir, `.staging-${suffix()}`)
  mkdirSync(staging, { recursive: true })
  let switched = false
  try {
    for (const file of verified.files) {
      const source = join(artifactDir, file.path)
      const destination = join(staging, file.path)
      assertInside(staging, destination)
      mkdirSync(dirname(destination), { recursive: true })
      copyFileSync(source, destination)
      if (sha256File(destination) !== file.sha256) {
        throw new UpdateError('E_HASH', `Hash mismatch after copy for ${file.path}.`)
      }
    }

    if (typeof hooks.beforeSwitch === 'function') {
      hooks.beforeSwitch({ staging, versionDir, state })
    }

    renameSync(staging, versionDir)
    switched = true

    const next = {
      schema: 1,
      app: verified.app,
      current: { version: verified.version, dir: `${VERSIONS_DIR}/${verified.version}` },
      previous: state ? state.current : null,
      updatedAt: new Date().toISOString(),
    }
    writeState(targetRoot, next)
    return next
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (switched) {
      rmSync(versionDir, { recursive: true, force: true })
    }
    throw error
  }
}

export function applyUpdate({ feedDir, targetRoot, publicKey, installedVersion, app, hooks = {} }) {
  const manifestPath = join(feedDir, 'manifest.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new UpdateError('E_MANIFEST', `Cannot read manifest: ${manifestPath}`)
  }
  return stageUpdate({
    artifactDir: join(feedDir, 'artifact'),
    manifest,
    targetRoot,
    publicKey,
    installedVersion,
    app,
    hooks,
  })
}

export function rollback({ targetRoot }) {
  const state = readState(targetRoot)
  if (!state || !state.previous) {
    throw new UpdateError('E_STATE', 'No previous version is available to roll back to.')
  }
  const previousDir = join(targetRoot, state.previous.dir)
  assertInside(targetRoot, previousDir)
  if (!existsSync(previousDir) || !statSync(previousDir).isDirectory()) {
    throw new UpdateError('E_STATE', 'The previous version directory is missing.')
  }
  const failedDir = join(targetRoot, state.current.dir)
  assertInside(targetRoot, failedDir)
  const next = {
    schema: 1,
    app: state.app,
    current: state.previous,
    previous: null,
    updatedAt: new Date().toISOString(),
  }
  writeState(targetRoot, next)
  rmSync(failedDir, { recursive: true, force: true })
  return next
}

export function currentVersion(targetRoot) {
  const state = readState(targetRoot)
  return state ? state.current.version : null
}
