/**
 * Local state directory and atomic JSON writes.
 *
 * State lives under `$DSH_HOME/state/rayrun-bot/`. `DSH_HOME` comes from the
 * environment; without it the profile directory (`<DSH_HOME>/profiles/<name>`)
 * or the documented `~/.dsh` default is used. This module never writes outside
 * the directory it is given.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Resolve the Rayrun Bot state directory.
 * @param {{ profileDir?: string, env?: NodeJS.ProcessEnv, home?: string }} [options]
 * @returns {string} Absolute path under the DSH home.
 */
export function resolveStateRoot({ profileDir, env = process.env, home = homedir() } = {}) {
  const configured = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  if (configured) return path.join(configured, 'state', 'rayrun-bot')

  if (profileDir) {
    const profiles = path.dirname(profileDir)
    if (path.basename(profiles) === 'profiles') {
      return path.join(path.dirname(profiles), 'state', 'rayrun-bot')
    }
  }

  return path.join(home, '.dsh', 'state', 'rayrun-bot')
}

/** Create a private directory, including parents, and return it. */
export function ensureDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  return directory
}

/**
 * Write one JSON file atomically: a private temp file, fsync, then rename.
 * A failed write leaves the previous file untouched.
 * @param {string} filename Target file.
 * @param {unknown} value JSON-serializable value.
 */
export function writeJsonAtomic(filename, value) {
  const directory = path.dirname(filename)
  ensureDirectory(directory)
  const temp = path.join(directory, `.${path.basename(filename)}.tmp-${randomUUID()}`)
  const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
  const fd = openSync(temp, 'wx', 0o600)
  try {
    let offset = 0
    while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(temp, filename)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {
      // The rename is what failed; the temp cleanup is best effort.
    }
    throw error
  }
}
