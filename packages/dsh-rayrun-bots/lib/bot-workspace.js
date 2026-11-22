/**
 * A per-bot local git checkout for detached cloud tasks.
 *
 * The dependency's `dsh.start` requires an absolute local git checkout so it
 * can mirror the workspace before posting a task and collect results back into
 * `.dsh/results/<taskId>/`. This module creates that checkout under the bot's
 * state directory and never touches the user's own repository. The `.dsh/`
 * subtree is ignored so results and handoffs do not become bot workspace
 * content.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { assertBotId } from './bot-schema.js'
import { ERROR_CODES } from './errors.js'

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

/**
 * Create the workspace once and verify an existing one is a git checkout.
 * @param {string} stateRoot Absolute Rayrun Bot state directory.
 * @param {string} botId Bot id.
 * @param {{ name?: string }} [options] Display name for the initial README.
 * @returns {string} Absolute workspace path.
 */
export function ensureBotWorkspace(stateRoot, botId, { name } = {}) {
  const dir = botWorkspacePath(stateRoot, botId)
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
