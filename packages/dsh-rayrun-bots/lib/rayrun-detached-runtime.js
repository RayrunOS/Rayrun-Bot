/**
 * Detached runtime adapter for `dsh-rayrun-computer` 1.1+.
 *
 * `dsh.start` posts a worker task and returns a task id immediately; the cloud
 * worker keeps running after the local DSH page closes. The session runner
 * persists that task id and polls `dsh.status`/`dsh.result` from this host, so
 * reopening the page (or restarting DSH) resumes collection. The worker writes
 * its user-facing reply to `reply.md` in the task result directory; this module
 * reads only that file, never the Rayrun token.
 *
 * The task prompt carries the bot definition and transcript replay. Each turn
 * gets a new task id so a missing reply can never collect a stale one.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { ensureBotWorkspace } from './bot-workspace.js'
import { ERROR_CODES } from './errors.js'
import { buildPrompt } from './rayrun-runtime.js'
import { createRayrunRpc, rayrunFailure } from './rayrun-rpc.js'
import { RUNTIME_CONTRACT_VERSION } from './runtime.js'

const TASK_TIMEOUT_SECONDS = 900
const REPLY_MAX_BYTES = 64 * 1024
const DETACHED_IMAGE = 'deepseek-harness@1'
const SHELL_ONESHOT_IMAGES = new Set(['dsh-bot@1', 'dsh-bot-devcheck@1'])

function assertImageSupported(machine) {
  const image = typeof machine?.agent === 'string' ? machine.agent.trim() : ''
  if (!SHELL_ONESHOT_IMAGES.has(image)) return
  throw rayrunFailure(
    ERROR_CODES.imageUnsupported,
    `The cloud computer image "${image}" runs a shell oneshot, not a DSH worker; detached turns cannot run. Recreate the computer with an image such as ${DETACHED_IMAGE}.`,
  )
}

function resultNames(body) {
  return Array.isArray(body?.files) && body.files.length ? body.files.join(', ') : 'none'
}

/**
 * Create the detached adapter. `getOrigin` is lazy because it is only available
 * after the DSH web server is injected.
 * @param {{ getOrigin?: () => string | undefined, fetchImpl?: Function }} options
 */
export function createRayrunDetachedRuntime({ getOrigin, fetchImpl = globalThis.fetch } = {}) {
  const rpc = createRayrunRpc({ getOrigin, fetchImpl })

  return {
    contract: RUNTIME_CONTRACT_VERSION,
    name: 'rayrun-detached',
    detached: true,
    get available() {
      return Boolean(getOrigin?.())
    },
    async start({ bot, text, history = [], messageSeq, botId, stateRoot } = {}) {
      const machine = await rpc.resolveMachine()
      assertImageSupported(machine)
      const localDir = ensureBotWorkspace(stateRoot, botId, { name: bot?.name })
      const objective = [
        buildPrompt({ bot, text, history, messageSeq }),
        '',
        'Write the user-facing reply to `reply.md` in this task\'s result directory (`.dsh/results/<task id>/reply.md`). Do not write the reply anywhere else.',
      ].join('\n')
      const acceptance = [
        'The task result directory contains reply.md with a self-contained reply to the latest user message.',
        'No external side effect was performed.',
      ]
      const body = await rpc.call('dsh.start', {
        sandbox: machine.name || machine.id,
        local_dir: localDir,
        objective,
        acceptance,
        context: `The turn came from the Bots UI for bot ${botId}. reply.md is the only user-facing output.`,
        task_id: `task-${randomUUID()}`,
        timeout: TASK_TIMEOUT_SECONDS,
      }, { timeoutMs: 240_000 })
      if (typeof body.task_id !== 'string' || body.task_id.trim() === '') {
        throw rayrunFailure(ERROR_CODES.internal, 'The detached RPC returned no task id.')
      }
      return {
        taskId: body.task_id,
        sandbox: typeof body.sandbox === 'string' && body.sandbox.trim() ? body.sandbox : (machine.name || machine.id),
        localDir,
        timeoutSeconds: TASK_TIMEOUT_SECONDS,
        startedAt: typeof body.started_at === 'string' ? body.started_at : new Date().toISOString(),
      }
    },
    async status({ detached } = {}) {
      const body = await rpc.call('dsh.status', {
        sandbox: detached.sandbox,
        task_id: detached.taskId,
      }, { timeoutMs: 60_000 })
      if (typeof body.running !== 'boolean') {
        throw rayrunFailure(ERROR_CODES.internal, 'The detached status response has no running state.')
      }
      return {
        running: body.running,
        files: Array.isArray(body.files) ? body.files : [],
        activity: body.activity ?? null,
      }
    },
    async collect({ detached } = {}) {
      const body = await rpc.call('dsh.result', {
        sandbox: detached.sandbox,
        task_id: detached.taskId,
        local_dir: detached.localDir,
      }, { timeoutMs: 120_000 })
      if (typeof body.running !== 'boolean') {
        throw rayrunFailure(ERROR_CODES.internal, 'The detached result response has no running state.')
      }
      if (body.running) return { running: true, files: Array.isArray(body.files) ? body.files : [] }

      const root = path.resolve(detached.localDir)
      const resultsDir = path.resolve(body.results_dir ?? path.join(root, '.dsh', 'results', detached.taskId))
      if (resultsDir !== root && !resultsDir.startsWith(`${root}${path.sep}`)) {
        throw rayrunFailure(ERROR_CODES.internal, 'The detached result directory is outside its workspace.')
      }
      const replyPath = path.join(resultsDir, 'reply.md')
      let info
      try {
        info = statSync(replyPath)
      } catch {
        throw rayrunFailure(
          ERROR_CODES.workerNoReply,
          `The cloud worker ended without writing reply.md (files: ${resultNames(body)}). If this computer image runs a shell oneshot (for example dsh-bot@1), it does not start a DSH worker; use an image such as ${DETACHED_IMAGE}.`,
        )
      }
      if (!info.isFile() || info.size > REPLY_MAX_BYTES) {
        throw rayrunFailure(ERROR_CODES.internal, 'The cloud worker reply.md is not a usable file.')
      }
      const text = readFileSync(replyPath, 'utf8').trim()
      if (text === '') {
        throw rayrunFailure(ERROR_CODES.internal, 'The cloud worker reply.md is empty.')
      }
      return {
        text,
        files: Array.isArray(body.files) ? body.files : [],
        released: body.released === true,
        questions: typeof body.questions === 'string' ? body.questions : '',
      }
    },
  }
}
