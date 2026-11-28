/**
 * A per-bot local git checkout for detached cloud tasks.
 *
 * The dependency's `dsh.start` requires an absolute local git checkout so it
 * can mirror the workspace before posting a task and collect results back into
 * `.dsh/results/<taskId>/`. This module creates that checkout under the bot's
 * state directory and never touches the user's own repository. The `.dsh/`
 * subtree is ignored so results and handoffs do not become bot workspace
 * content.
 *
 * A bot may bind a DSH workspace (a project directory). The bound checkout is
 * a source-authoritative mirror of that directory, refreshed before each
 * detached turn: files present in the source are copied, files absent from it
 * are removed, and `.dsh/`/`.rayrun/`/`lost+found/` are preserved. Secrets,
 * `.git`, `node_modules` and symlinks are never copied. The source directory
 * is never written.
 */
import { execFileSync } from 'node:child_process'
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { assertBotId } from './bot-schema.js'
import { ERROR_CODES } from './errors.js'
import { writeJsonAtomic } from './local-store.js'

export const WORKSPACE_META_SCHEMA = 1
export const WORKSPACE_COPY_LIMITS = Object.freeze({
  maxFiles: 2000,
  maxTotalBytes: 32 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxDepth: 24,
})

const PROTECTED = new Set(['.git', '.dsh', '.rayrun', 'lost+found'])
const IGNORED_NAMES = new Set([
  '.git', '.dsh', '.rayrun', 'node_modules', 'lost+found', '.ssh',
  '.npmrc', '.netrc', '.git-credentials', 'credentials', 'credentials.json', 'secrets',
])
const IGNORED_PREFIXES = ['.env', 'id_rsa', 'id_ed25519', 'id_ecdsa']
const IGNORED_SUFFIXES = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.secret']

function workspaceError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** True when the basename is skipped at any depth. */
function isIgnored(name) {
  const lower = name.toLowerCase()
  if (IGNORED_NAMES.has(lower)) return true
  if (IGNORED_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}.`) || lower.startsWith(`${prefix}-`))) return true
  if (IGNORED_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true
  if (lower.startsWith('secrets.') || lower.startsWith('credentials.')) return true
  return false
}

/** True when `child` is `parent` or inside it (both already resolved). */
function isInside(parent, child) {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? '').trim().slice(0, 300)
    const failure = new Error(`git ${args[0]} failed${detail ? `: ${detail}` : '.'}`)
    failure.code = ERROR_CODES.internal
    throw failure
  }
}

/** Absolute path of one bot's detached-task workspace. */
export function botWorkspacePath(stateRoot, botId) {
  return path.join(path.resolve(stateRoot), 'bots', assertBotId(botId), 'workspace')
}

/** Absolute path of the mirror metadata. */
export function workspaceMetaPath(stateRoot, botId) {
  return path.join(path.resolve(stateRoot), 'bots', assertBotId(botId), 'workspace.json')
}

/**
 * Normalize a DSH Workspace record into the stored binding shape.
 * @param {{ id: string, path: string, title: string }} record
 */
export function workspaceBindingOf(record) {
  const id = typeof record?.id === 'string' ? record.id.trim() : ''
  const sourcePath = typeof record?.path === 'string' ? record.path : ''
  const title = typeof record?.title === 'string' ? record.title.trim() : ''
  if (!id || sourcePath === '' || !path.isAbsolute(sourcePath) || !title) {
    throw workspaceError(ERROR_CODES.workspaceInvalid, 'The workspace record has no usable id, path or title.')
  }
  return { id, path: sourcePath, title }
}

/**
 * Resolve a client-supplied workspace id through the DSH registry.
 * `undefined`/`null` means no change / unbind and does not need the registry.
 */
export function resolveWorkspaceBinding(registry, id) {
  if (id === undefined || id === null) return undefined
  if (typeof id !== 'string' || id.trim() === '') {
    throw workspaceError(ERROR_CODES.workspaceInvalid, 'workspaceId must be a non-empty string.')
  }
  if (!registry || typeof registry.get !== 'function') {
    throw workspaceError(ERROR_CODES.workspaceUnavailable, 'Workspace binding is unavailable on this host.')
  }
  const record = registry.get(id.trim())
  if (!record) throw workspaceError(ERROR_CODES.workspaceUnknown, `Unknown workspace: ${id}.`)
  return workspaceBindingOf(record)
}

/**
 * Derive whether a stored binding no longer points at a live workspace.
 * A missing registry, a removed record, a changed path or `missing-dir` all
 * count as stale. Never persisted.
 */
export async function workspaceIsStale(binding, registry) {
  if (!binding) return false
  try {
    if (!registry || typeof registry.get !== 'function') return true
    const record = registry.get(binding.id)
    if (!record) return true
    if (record.path !== binding.path) return true
    if (typeof record.status !== 'function') return true
    return (await record.status()) !== 'ok'
  } catch {
    return true
  }
}

function scanSource(source) {
  const stats = { files: 0, bytes: 0, ignored: 0, symlinks: 0, special: 0 }
  const stack = [{ dir: source, depth: 0 }]
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (isIgnored(entry.name)) {
        stats.ignored += 1
        continue
      }
      const full = path.join(dir, entry.name)
      let info
      try {
        info = lstatSync(full)
      } catch {
        continue
      }
      if (info.isSymbolicLink()) {
        stats.symlinks += 1
        continue
      }
      if (info.isDirectory()) {
        if (depth + 1 > WORKSPACE_COPY_LIMITS.maxDepth) {
          throw workspaceError(ERROR_CODES.workspaceTooLarge, `The workspace is deeper than ${WORKSPACE_COPY_LIMITS.maxDepth} directories.`)
        }
        stack.push({ dir: full, depth: depth + 1 })
        continue
      }
      if (!info.isFile()) {
        stats.special += 1
        continue
      }
      stats.files += 1
      stats.bytes += info.size
      if (stats.files > WORKSPACE_COPY_LIMITS.maxFiles
        || stats.bytes > WORKSPACE_COPY_LIMITS.maxTotalBytes
        || info.size > WORKSPACE_COPY_LIMITS.maxFileBytes) {
        throw workspaceError(ERROR_CODES.workspaceTooLarge, 'The workspace exceeds the copy limits.')
      }
    }
  }
  return stats
}

function mirrorDirectory(source, destination) {
  const sourceEntries = new Map()
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (isIgnored(entry.name)) continue
    const from = path.join(source, entry.name)
    let info
    try {
      info = lstatSync(from)
    } catch {
      continue
    }
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) continue
    sourceEntries.set(entry.name, info)
    const to = path.join(destination, entry.name)
    if (info.isDirectory()) {
      if (!existsSync(to)) mkdirSync(to, { mode: 0o700 })
      mirrorDirectory(from, to)
      continue
    }
    let current = null
    try {
      current = statSync(to)
    } catch {
      current = null
    }
    if (!current || current.size !== info.size || Math.abs(current.mtimeMs - info.mtimeMs) > 1) {
      copyFileSync(from, to)
      chmodSync(to, info.mode & 0o777)
    }
  }
  for (const entry of readdirSync(destination, { withFileTypes: true })) {
    if (PROTECTED.has(entry.name) || isIgnored(entry.name)) continue
    if (!sourceEntries.has(entry.name)) {
      rmSync(path.join(destination, entry.name), { recursive: true, force: true })
    }
  }
}

function commitWorkspace(directory) {
  const info = path.join(directory, '.git', 'info')
  mkdirSync(info, { recursive: true, mode: 0o700 })
  writeFileSync(path.join(info, 'exclude'), '.dsh/\n.rayrun/\nlost+found/\n', { mode: 0o600 })
  git(directory, ['add', '-A', '-f', '--', '.', ':(exclude).dsh', ':(exclude).rayrun', ':(exclude)lost+found'])
  const status = git(directory, ['status', '--porcelain']).trim()
  if (status === '') {
    try {
      git(directory, ['rev-parse', '--verify', 'HEAD'])
      return
    } catch {
      // No HEAD yet; the first commit below creates it.
    }
  }
  git(directory, [
    '-c', 'user.name=Rayrun Bot',
    '-c', 'user.email=rayrun-bot@localhost',
    'commit', '-qm', 'sync workspace',
  ])
}

function syncBoundWorkspace(stateRoot, botId, directory, workspace) {
  const source = path.resolve(workspace.path)
  const root = path.resolve(stateRoot)
  if (isInside(root, source) || isInside(source, root)) {
    throw workspaceError(ERROR_CODES.workspaceInvalid, 'A bot workspace cannot be the state directory or contain it.')
  }
  let info
  try {
    info = statSync(source)
  } catch {
    throw workspaceError(ERROR_CODES.workspaceStale, `The bound workspace is missing: ${source}.`)
  }
  if (!info.isDirectory()) {
    throw workspaceError(ERROR_CODES.workspaceStale, `The bound workspace is not a directory: ${source}.`)
  }
  const stats = scanSource(source)

  const metaFile = workspaceMetaPath(stateRoot, botId)
  let previous = null
  try {
    previous = JSON.parse(readFileSync(metaFile, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw workspaceError(ERROR_CODES.workspaceInvalid, `The workspace metadata is corrupt: ${metaFile}.`)
    }
  }
  if (previous
    && (previous.sourceWorkspaceId !== workspace.id || previous.sourcePath !== workspace.path)
    && existsSync(directory)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    renameSync(directory, `${directory}.previous-${stamp}`)
  }

  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (!existsSync(path.join(directory, '.git'))) git(directory, ['init', '-q'])
  writeJsonAtomic(metaFile, {
    schema: WORKSPACE_META_SCHEMA,
    sourceWorkspaceId: workspace.id,
    sourcePath: workspace.path,
    strategy: 'mirror',
    state: 'syncing',
    syncedAt: new Date().toISOString(),
    files: 0,
    bytes: 0,
    skipped: { ignored: stats.ignored, symlinks: stats.symlinks, special: stats.special },
  })
  mirrorDirectory(source, directory)
  commitWorkspace(directory)
  writeJsonAtomic(metaFile, {
    schema: WORKSPACE_META_SCHEMA,
    sourceWorkspaceId: workspace.id,
    sourcePath: workspace.path,
    strategy: 'mirror',
    state: 'ready',
    syncedAt: new Date().toISOString(),
    files: stats.files,
    bytes: stats.bytes,
    skipped: { ignored: stats.ignored, symlinks: stats.symlinks, special: stats.special },
  })
  return directory
}

/**
 * Create the workspace once and verify an existing one is a git checkout.
 * With a workspace binding, refresh the controlled mirror from the source
 * directory first; the source itself is never written.
 * @param {string} stateRoot Absolute Rayrun Bot state directory.
 * @param {string} botId Bot id.
 * @param {{ name?: string, workspace?: { id: string, path: string, title: string } | null }} [options]
 * @returns {string} Absolute workspace path.
 */
export function ensureBotWorkspace(stateRoot, botId, { name, workspace } = {}) {
  const dir = botWorkspacePath(stateRoot, botId)
  if (workspace !== undefined && workspace !== null) {
    return syncBoundWorkspace(stateRoot, botId, dir, workspace)
  }
  if (existsSync(dir)) {
    if (!existsSync(path.join(dir, '.git'))) {
      const error = new Error(`The bot workspace is not a git checkout: ${dir}.`)
      error.code = ERROR_CODES.internal
      throw error
    }
    const inside = git(dir, ['rev-parse', '--is-inside-work-tree']).trim()
    if (inside !== 'true') {
      const error = new Error(`The bot workspace is not a usable git work tree: ${dir}.`)
      error.code = ERROR_CODES.internal
      throw error
    }
    return dir
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 })
  git(dir, ['init', '-q'])
  writeFileSync(path.join(dir, '.gitignore'), '.dsh/\n', { mode: 0o600 })
  writeFileSync(path.join(dir, 'README.md'), `# ${String(name ?? botId).trim() || botId}\n`, { mode: 0o600 })
  git(dir, ['add', '.'])
  git(dir, [
    '-c', 'user.name=Rayrun Bot',
    '-c', 'user.email=rayrun-bot@localhost',
    'commit', '-qm', 'init',
  ])
  return dir
}
