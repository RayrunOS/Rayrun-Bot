/**
 * Runtime adapter for the persistent cloud bot host.
 *
 * The host process runs under the platform `runtimes` API and owns a per-bot
 * queue under `/workspace/.rayrun/bots/<botId>`. This adapter:
 *   1. ensures the sandbox is Running (never creates one);
 *   2. ensures the shared `bot-host` exists and rechecks it each turn;
 *   3. uploads one task JSON into the host inbox;
 *   4. polls the outbox for the reply.
 *
 * It uses the dependency's published `runtime.*` RPC and `rayrun_files` tool.
 * The Rayrun token stays inside the dependency. The file tool can auto-create
 * a missing sandbox when the dependency's `autoCreate` is enabled, so this
 * adapter resolves and verifies an existing machine first and refuses when
 * there is none; profiles for Bots should set `autoCreate: false`.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { openApprovalStore } from './approvals.js'
import { assertBotId } from './bot-schema.js'
import { ERROR_CODES } from './errors.js'
import { HOST_ASSET_VERSION, projectHost } from './host-projection.js'
import { buildPrompt } from './rayrun-runtime.js'
import { createRayrunRpc, dependencyFailure, rayrunFailure } from './rayrun-rpc.js'
import { createRuntimeRpc } from './runtime-rpc.js'
import { RUNTIME_CONTRACT_VERSION } from './runtime.js'

const TASK_TIMEOUT_SECONDS = 900
const HOST_READY_ATTEMPTS = 30
const HOST_PROFILE = 'bot'
const HOST_RUNTIME = 'bot-host'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One host process serves every bot on the machine. */
export function hostRuntimeName() {
  return HOST_RUNTIME
}

/** Recent local approval outcomes, without payloads, for the next bot turn. */
function approvalContextFor(stateRoot, botId) {
  if (typeof stateRoot !== 'string' || typeof botId !== 'string') return ''
  const root = path.resolve(stateRoot)
  let list
  try {
    list = openApprovalStore(root).list(botId)
  } catch {
    return ''
  }
  const lines = []
  for (const approval of list) {
    if (approval.state !== 'approved' && approval.state !== 'denied') continue
    const action = approval.action && typeof approval.action === 'object' ? approval.action : {}
    const kind = typeof action.kind === 'string' ? action.kind : 'action'
    const machine = typeof action.machine === 'string' ? action.machine : ''
    let execution = null
    try {
      execution = JSON.parse(readFileSync(
        path.join(root, 'bots', botId, 'approvals', `exec-${approval.id}.json`),
        'utf8',
      ))
    } catch {
      execution = null
    }
    const state = execution?.state ? `; execution ${execution.state}` : ''
    const status = typeof execution?.result?.status === 'string' ? ` (${execution.result.status})` : ''
    const code = typeof execution?.code === 'string' ? ` [${execution.code}]` : ''
    lines.push(`- ${kind}${machine ? ` on ${machine}` : ''}: ${approval.state}${state}${status}${code}`)
    if (lines.length >= 5) break
  }
  return lines.join('\n')
}

/** True when a file-read error means "not uploaded yet", not a broken machine. */
function missingFile(error) {
  return error?.status === 404
    || error?.code === 'not_found'
    || error?.code === 'file_not_found'
    || /not found|404/i.test(String(error?.message ?? error))
}

/** Map the dependency's auth errors, but leave file-level errors intact. */
function toolFailure(error) {
  const code = error?.code
  if (code === 'token_required' || code === 'unauthorized' || code === 'invalid_token' || error?.status === 401) {
    return dependencyFailure(error)
  }
  return error
}

/** Derive the bot id from the persisted localDir (`.../bots/<id>/workspace`). */
function botIdFromDetached(detached) {
  const parts = path.resolve(String(detached?.localDir ?? '')).split(path.sep)
  const index = parts.lastIndexOf('bots')
  if (index < 0 || index + 2 >= parts.length) {
    throw rayrunFailure(ERROR_CODES.internal, 'The detached cloud host record has no bot workspace.')
  }
  try {
    return assertBotId(parts[index + 1])
  } catch {
    throw rayrunFailure(ERROR_CODES.internal, 'The detached cloud host record has an invalid bot id.')
  }
}

/**
 * @param {{
 *   getOrigin?: () => string | undefined,
 *   getTools?: () => object,
 *   fetchImpl?: Function,
 *   supported?: boolean,
 *   hostScript?: string,
 *   profile?: string,
 *   credentials?: string[],
 *   machine?: string,
 * }} options
 */
export function createCloudHostRuntime({
  getOrigin,
  getTools,
  fetchImpl = globalThis.fetch,
  supported = true,
  hostScript = null,
  profile = HOST_PROFILE,
  credentials = [],
  machine: pinnedMachine,
} = {}) {
  const rpc = createRayrunRpc({ getOrigin, fetchImpl })
  const runtimeRpc = createRuntimeRpc({ getOrigin, fetchImpl })
  const hostScripts = new Map()
  const hostChecks = new Map()
  if (!Array.isArray(credentials) || credentials.some((name) => typeof name !== 'string' || name === '')) {
    throw new TypeError('cloud host credentials must be an array of binding names')
  }

  function filesTool() {
    try {
      const tool = getTools?.()?.get?.('rayrun_files')
      return typeof tool?.execute === 'function' ? tool : undefined
    } catch {
      return undefined
    }
  }

  function scriptFor(machine) {
    if (hostScript !== null) return Promise.resolve(hostScript)
    const sandbox = machine.name || machine.id
    let pending = hostScripts.get(sandbox)
    if (pending === undefined) {
      pending = projectHost({
        read: (relative) => readFile(sandbox, relative),
        write: (relative, value) => writeFile(sandbox, relative, value),
        version: HOST_ASSET_VERSION,
      }).then((projected) => projected.script).catch((error) => {
        hostScripts.delete(sandbox)
        throw error
      })
      hostScripts.set(sandbox, pending)
    }
    return pending
  }

  /**
   * Verify the machine, projected script and host on every turn. The host can be
   * deleted or restarted between turns, so a one-time setup cache would leave a
   * task in an inbox with no process to consume it.
   */
  async function prepareHost() {
    const machine = await ensureMachine()
    const script = await scriptFor(machine)
    const ref = machine.name || machine.id
    let pending = hostChecks.get(ref)
    if (pending === undefined) {
      pending = (async () => {
        const host = await ensureHost(machine, script)
        await waitHostReady(host.ref)
        return { machine, host }
      })().finally(() => {
        hostChecks.delete(ref)
      })
      hostChecks.set(ref, pending)
    }
    return pending
  }

  async function ensureMachine({ start = true } = {}) {
    const overview = await rpc.call('overview')
    if (overview.connection?.configured !== true) {
      throw rayrunFailure(ERROR_CODES.tokenRequired, 'Connect Rayrun in Bots setup before sending a message.')
    }
    const machines = Array.isArray(overview.machines)
      ? overview.machines.filter((item) => item?.status !== 'Terminated')
      : []
    const machine = pinnedMachine
      ? machines.find((item) => item.name === pinnedMachine || item.id === pinnedMachine)
      : (machines.find((item) => item.name === 'rayrun-bot')
        ?? machines.find((item) => item.remote_desktop && item.desktop_url)
        ?? machines[0])
    if (!machine) {
      throw rayrunFailure(ERROR_CODES.machineStopped, 'No cloud computer yet; create one in Bots setup first.')
    }
    if (machine.status === 'Running' || !start) return machine
    const verb = machine.status === 'Paused' ? 'resume' : 'start'
    await rpc.call('machine.action', { id: machine.id, verb }, { timeoutMs: 120_000 })
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const next = await rpc.call('overview')
      const found = (next.machines || []).find((item) => item.id === machine.id)
      if (found?.status === 'Running') return found
      await sleep(2000)
    }
    throw rayrunFailure(ERROR_CODES.machineStopped, 'The cloud computer did not start in time; no turn was sent.')
  }

  function machineRef(machine) {
    const name = String(machine.name ?? '')
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name) ? name : String(machine.id)
  }

  function spec(script, machine) {
    return {
      argv: ['node', script],
      workdir: '/workspace',
      env: {
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        DSH_HOME: '/workspace/.rayrun/dsh',
        HOME: '/workspace/.rayrun/home',
        DSH_BOT_ROOT: '/workspace/.rayrun',
        DSH_BOT_AGENT: 'dsh',
        DSH_BOT_PROFILE: profile,
        DSH_BOT_LOG: '/workspace/.rayrun/logs/bot-host.log',
        DSH_BOT_PROPOSE: `${path.posix.dirname(String(script))}/bin/propose.mjs`,
        DSH_BOT_MACHINE: machineRef(machine),
      },
      credentials: [...credentials],
      restart: 'always',
      autostart: true,
      keep_alive: true,
      stop_signal: 'SIGTERM',
      stop_timeout_seconds: 10,
    }
  }

  async function ensureHost(machine, script) {
    const ref = machine.name || machine.id
    const name = HOST_RUNTIME
    let current = (await runtimeRpc.get(ref, name)).runtime
    if (!current) {
      await runtimeRpc.put(ref, name, spec(script, machine))
      current = (await runtimeRpc.get(ref, name)).runtime
    }
    if (current?.state !== 'running') {
      await runtimeRpc.start(ref, name)
      for (let attempt = 0; attempt < 20; attempt += 1) {
        current = (await runtimeRpc.get(ref, name)).runtime
        if (current?.state === 'running') break
        await sleep(1000)
      }
    }
    if (current?.state !== 'running') {
      throw rayrunFailure(
        ERROR_CODES.runtimeUnavailable,
        `The cloud bot host did not start${current?.last_error ? `: ${String(current.last_error).slice(0, 200)}` : '.'}`,
      )
    }
    return { name, ref }
  }

  function filePaths(botId, taskId) {
    return {
      inbox: `.rayrun/bots/${botId}/inbox/${taskId}.json`,
      outbox: `.rayrun/bots/${botId}/outbox/${taskId}.json`,
    }
  }

  async function writeFile(sandbox, relative, text) {
    const tool = filesTool()
    if (tool === undefined) {
      throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'dsh-rayrun-computer is missing the rayrun_files tool; no turn was sent.')
    }
    try {
      await tool.execute({
        action: 'upload',
        sandbox,
        path: relative,
        text,
      }, { signal: AbortSignal.timeout(60_000) })
    } catch (error) {
      throw toolFailure(error)
    }
  }

  async function readFile(sandbox, relative) {
    const tool = filesTool()
    if (tool === undefined) {
      throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'dsh-rayrun-computer is missing the rayrun_files tool.')
    }
    try {
      const text = await tool.execute({
        action: 'download',
        sandbox,
        path: relative,
      }, { signal: AbortSignal.timeout(60_000) })
      return typeof text === 'string' ? text : null
    } catch (error) {
      if (missingFile(error)) return null
      throw toolFailure(error)
    }
  }

  async function waitHostReady(sandbox) {
    const statePath = '.rayrun/host/state.json'
    // A previous host leaves `stopped` behind. A newly started host may not
    // have overwritten it yet, so wait for a fresh `running`, not the first
    // value read. The bound covers a cold worker bootstrap.
    for (let attempt = 0; attempt < HOST_READY_ATTEMPTS; attempt += 1) {
      const text = await readFile(sandbox, statePath)
      if (text !== null) {
        let state
        try { state = JSON.parse(text) } catch { state = null }
        if (state?.state === 'running') return
      }
      await sleep(1000)
    }
    throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'The cloud bot host did not become ready.')
  }

  return {
    contract: RUNTIME_CONTRACT_VERSION,
    name: 'rayrun-cloud-host',
    detached: true,
    get available() {
      return supported && Boolean(getOrigin?.()) && filesTool() !== undefined
    },
    get machineName() {
      return pinnedMachine ?? null
    },
    async start({ bot, text, history = [], messageSeq, origin, botId, stateRoot } = {}) {
      if (typeof botId !== 'string' || botId === '') throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'botId is required.')
      const { machine, host } = await prepareHost()
      const taskId = `task-${randomUUID()}`
      const paths = filePaths(botId, taskId)
      const prompt = buildPrompt({
        bot,
        text,
        history,
        messageSeq,
        proposalHint: true,
        proposalMachine: machineRef(machine),
        approvalContext: approvalContextFor(stateRoot, botId),
      })
      const startedAt = new Date().toISOString()
      await writeFile(host.ref, paths.inbox, JSON.stringify({
        schema: 1,
        id: taskId,
        text: prompt,
        at: startedAt,
        ...(origin === 'routine' ? { origin: 'routine' } : {}),
      }))
      return {
        taskId,
        sandbox: machine.name || machine.id,
        localDir: path.join(path.resolve(stateRoot), 'bots', botId, 'workspace'),
        timeoutSeconds: TASK_TIMEOUT_SECONDS,
        startedAt,
      }
    },
    async status({ detached } = {}) {
      const botId = botIdFromDetached(detached)
      const paths = filePaths(botId, detached.taskId)
      const outbox = await readFile(detached.sandbox, paths.outbox)
      return { running: outbox === null }
    },
    async collect({ detached } = {}) {
      const botId = botIdFromDetached(detached)
      const paths = filePaths(botId, detached.taskId)
      const outbox = await readFile(detached.sandbox, paths.outbox)
      if (outbox === null) return { running: true }
      let value
      try {
        value = JSON.parse(outbox)
      } catch {
        throw rayrunFailure(ERROR_CODES.internal, 'The cloud bot host wrote an invalid outbox file.')
      }
      if (typeof value?.error === 'string' && value.error.trim() !== '') {
        throw rayrunFailure(ERROR_CODES.workerNoReply, `The cloud bot host failed the turn: ${value.error.slice(0, 500)}`)
      }
      if (typeof value?.reply !== 'string' || value.reply.trim() === '') {
        throw rayrunFailure(ERROR_CODES.internal, 'The cloud bot host returned no reply.')
      }
      return { text: value.reply }
    },
    ensureMachine,
    ensureHost,
  }
}
