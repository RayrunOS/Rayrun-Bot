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
const IMAGE_MAX = 128
const DETACHED_IMAGE = 'deepseek-harness@1'
const SHELL_ONESHOT_IMAGES = new Set(['dsh-bot@1', 'dsh-bot-devcheck@1'])
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

/** The image name on a computer-plugin machine, or '' when it cannot be read. */
function imageOf(machine) {
  const image = typeof machine?.agent === 'string' ? machine.agent.trim() : ''
  if (!image || image.length > IMAGE_MAX || CONTROL.test(image)) return ''
  return image
}

function imageFailure(image, message, sandbox) {
  const error = rayrunFailure(ERROR_CODES.imageUnsupported, message)
  if (image) error.image = image
  if (sandbox) error.computer = sandbox
  return error
}

/**
 * Refuse a detached turn that cannot be shown to run a DSH worker.
 * An empty image is refused too: the previous precheck treated that as
 * "unknown" and still called `dsh.start`, which is how a shell-oneshot
 * machine created a task and then failed with no `reply.md`.
 */
function assertImageSupported(image, sandbox) {
  if (!image) {
    throw imageFailure(
      '',
      `The cloud computer image could not be read, so no detached task was started. A shell-oneshot image (for example dsh-bot@1) does not start a DSH worker; use an image such as ${DETACHED_IMAGE}.`,
      sandbox,
    )
  }
  if (!SHELL_ONESHOT_IMAGES.has(image)) return
  throw imageFailure(
    image,
    `The cloud computer image "${image}" runs a shell oneshot, not a DSH worker; detached turns cannot run. Recreate the computer with an image such as ${DETACHED_IMAGE}.`,
    sandbox,
  )
}

/**
 * Read the image from overview, then from `machine.get` when overview omits it.
 * A previously stored image for this same computer is the last resort, so a
 * later blank overview can still reject a known oneshot without creating a task.
 */
async function resolveImage(rpc, machine, remembered) {
  const sandbox = String(machine?.name || machine?.id || '')
  let image = imageOf(machine)
  if (image) {
    assertImageSupported(image, sandbox)
    return image
  }
  if (typeof machine?.id === 'string' && machine.id.trim() !== '') {
    try {
      const detail = await rpc.call('machine.get', { id: machine.id })
      image = imageOf(detail?.machine)
    } catch {
      // Overview already proved the computer plugin is reachable. A failed
      // detail read still means the image is unknown, so the turn stops below.
      image = ''
    }
    if (image) {
      assertImageSupported(image, sandbox)
      return image
    }
  }
  const rememberedImage = typeof remembered?.image === 'string' ? remembered.image : ''
  const rememberedComputer = typeof remembered?.computer === 'string' ? remembered.computer : ''
  if (rememberedImage && rememberedComputer && rememberedComputer === sandbox) {
    image = imageOf({ agent: rememberedImage })
  }
  assertImageSupported(image, sandbox)
  return image
}

function resultNames(body) {
  return Array.isArray(body?.files) && body.files.length ? body.files.join(', ') : 'none'
}

function redactProviderError(value) {
  return String(value ?? '')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+|(sk-)[A-Za-z0-9_-]{16,}/gi, (match, bearer, sk) => (
      bearer ? `${bearer}[redacted]` : `${sk}[redacted]`
    ))
    .slice(0, 500)
}

/**
 * Best-effort read of the worker's DSH session log after a missing reply.md.
 * The provider error is written by the worker session, not by this host; the
 * dependency's exec tool reads it on the machine. Any failure is silent: the
 * original worker-no-reply error remains actionable on its own.
 */
async function providerErrorHint(getTools, detached) {
  let tool
  try {
    tool = getTools?.()?.get?.('rayrun_exec')
  } catch {
    return ''
  }
  if (typeof tool?.execute !== 'function') return ''
  try {
    const result = await tool.execute({
      sandbox: detached.sandbox,
      command: "grep -R -h -E 'Authentication Fails|MISSING_CREDENTIAL|invalid.*api key|401' /workspace/.rayrun/dsh/sessions 2>/dev/null | tail -n 3",
      timeout_seconds: 30,
    })
    const text = [result?.stdout, result?.stderr].filter(Boolean).join('\n').trim()
    return text ? ` Provider error: ${redactProviderError(text)}` : ''
  } catch {
    return ''
  }
}

/**
 * Create the detached adapter. `getOrigin` is lazy because it is only available
 * after the DSH web server is injected. `getTools` is optional and used only to
 * read the worker's provider error after a missing reply.md.
 * @param {{ getOrigin?: () => string | undefined, getTools?: () => object, fetchImpl?: Function }} options
 */
export function createRayrunDetachedRuntime({ getOrigin, getTools, fetchImpl = globalThis.fetch } = {}) {
  const rpc = createRayrunRpc({ getOrigin, fetchImpl })

  return {
    contract: RUNTIME_CONTRACT_VERSION,
    name: 'rayrun-detached',
    detached: true,
    get available() {
      return Boolean(getOrigin?.())
    },
    async start({
      bot, text, history = [], messageSeq, botId, stateRoot,
      rememberedImage, rememberedComputer,
    } = {}) {
      const machine = await rpc.resolveMachine()
      const image = await resolveImage(rpc, machine, {
        image: rememberedImage,
        computer: rememberedComputer,
      })
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
        image,
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
        const known = imageOf({ agent: detached?.image })
        const named = known ? ` This computer image is "${known}".` : ''
        const provider = await providerErrorHint(getTools, detached)
        throw rayrunFailure(
          ERROR_CODES.workerNoReply,
          `The cloud worker ended without writing reply.md (files: ${resultNames(body)}).${named} Check the worker session under .rayrun/dsh/sessions/ for the provider error. A missing or invalid DeepSeek credential (MISSING_CREDENTIAL or provider Authentication Fails) prevents the worker from replying; add a valid model credential or recreate the computer with one.${provider}`,
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
