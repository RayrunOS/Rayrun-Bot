/**
 * Runtime adapter backed by `dsh-rayrun-computer`'s `rayrun_agent` tool.
 *
 * The adapter is host-side only. It resolves an existing cloud computer through
 * the dependency's same-origin `overview` RPC (never creating one), composes a
 * bounded prompt from the bot definition and transcript, then calls the
 * dependency's published `rayrun_agent` tool. The Rayrun token stays inside the
 * dependency; this module never reads it and never puts one in a prompt.
 *
 * The tool runs the machine agent with the profile the dependency already uses.
 * Approval enforcement is still not implemented (ADR-001), so the prompt's
 * "ask before external actions" line is guidance, not a security boundary.
 */
import { Buffer } from 'node:buffer'
import { ERROR_CODES } from './errors.js'
import { RUNTIME_CONTRACT_VERSION } from './runtime.js'

/** Mirrors the Bots client's preferred machine name. */
const DEFAULT_COMPUTER = 'rayrun-bot'
const AGENT_TIMEOUT_SECONDS = 900
const OVERVIEW_TIMEOUT_MS = 30_000
const HISTORY_MAX_BYTES = 24 * 1024

const DEPENDENCY_CODES = new Map([
  ['token_required', ERROR_CODES.tokenRequired],
  ['unauthorized', ERROR_CODES.tokenRequired],
  ['invalid_token', ERROR_CODES.tokenRequired],
  ['key_required', ERROR_CODES.keyRequired],
  ['model_credential_required', ERROR_CODES.keyRequired],
  ['sandbox_busy', ERROR_CODES.machineBusy],
  ['sandbox_missing', ERROR_CODES.machineStopped],
  ['sandbox_not_running', ERROR_CODES.machineStopped],
  ['balance_low', ERROR_CODES.balanceLow],
  ['insufficient_balance', ERROR_CODES.balanceLow],
])

function failure(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/** Map a dependency error to a stable host code without copying its payload. */
function dependencyFailure(error) {
  const raw = typeof error?.code === 'string' ? error.code : ''
  let code = raw.startsWith('E_') ? raw : DEPENDENCY_CODES.get(raw)
  if (!code && error?.status === 401) code = ERROR_CODES.tokenRequired
  if (!code && error?.status === 402) code = ERROR_CODES.balanceLow
  if (!code && error?.status === 404) code = ERROR_CODES.depMissing
  if (!code && error?.status === 409) code = ERROR_CODES.machineBusy
  const mapped = failure(code ?? ERROR_CODES.internal, String(error?.message ?? error ?? 'The cloud turn failed.'))
  return mapped
}

function rpcFailure(body, status) {
  const detail = body?.error
  if (typeof detail === 'string') {
    const error = new Error(detail)
    error.status = status
    return error
  }
  const error = new Error(detail?.message ?? `Cloud-computer RPC failed (${status}).`)
  error.code = detail?.code ?? `http_${status}`
  error.status = status
  return error
}

function formatMessage(message) {
  if (message.role === 'user') return `User: ${message.text}`
  if (message.role === 'bot') return `Bot: ${message.text}`
  return `System (${message.code ?? 'error'}): ${message.text}`
}

/** A short, non-secret hint from the dependency's event digest. */
function resultDetail(result) {
  const events = typeof result?.events === 'string' ? result.events.trim() : ''
  return events ? ` (${events.slice(0, 500)})` : ''
}

/**
 * Compose one prompt. History stops before the turn being answered so a later
 * queued message cannot leak into this prompt; the turn text is authoritative.
 */
export function buildPrompt({ bot, text, history = [], messageSeq } = {}) {
  const name = typeof bot?.name === 'string' && bot.name.trim() ? bot.name.trim() : 'the bot'
  const label = typeof bot?.label === 'string' ? bot.label.trim() : ''
  const instructions = typeof bot?.instructions === 'string' ? bot.instructions.trim() : ''
  const prior = Array.isArray(history)
    ? history.filter((message) => Number.isInteger(message?.seq)
      && (!Number.isInteger(messageSeq) || message.seq < messageSeq))
    : []

  const lines = []
  let bytes = 0
  let truncated = false
  for (let index = prior.length - 1; index >= 0; index -= 1) {
    const line = formatMessage(prior[index])
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (bytes + size > HISTORY_MAX_BYTES) {
      truncated = true
      break
    }
    lines.unshift(line)
    bytes += size
  }

  const transcript = lines.length === 0
    ? 'No earlier messages.'
    : `${truncated ? '[earlier messages omitted]\n' : ''}${lines.join('\n')}`

  return [
    `You are ${name}${label ? `, ${label}` : ''}.`,
    '',
    'Instructions:',
    instructions || '(No extra instructions.)',
    '',
    'Conversation so far:',
    transcript,
    '',
    `User: ${String(text ?? '').trim()}`,
    '',
    `Reply as ${name} to the user's latest message. Work inside the cloud computer. Do not send, publish, spend, create or destroy computers, or touch another machine without an explicit user decision; if the decision is missing, ask and stop. Never claim work you have not verified.`,
  ].join('\n')
}

/**
 * Create the runtime adapter. `getTools` and `getOrigin` are lazy so plugin load
 * order does not freeze the adapter into "unavailable".
 * @param {{ getTools?: () => object, getOrigin?: () => string | undefined, fetchImpl?: Function }} options
 */
export function createRayrunAgentRuntime({ getTools, getOrigin, fetchImpl = globalThis.fetch } = {}) {
  function agentTool() {
    try {
      return getTools?.()?.get?.('rayrun_agent')
    } catch {
      return undefined
    }
  }

  async function resolveMachine() {
    const origin = getOrigin?.()
    if (!origin) {
      throw failure(ERROR_CODES.runtimeUnavailable, 'The DSH web server is not available; no turn was sent.')
    }
    if (typeof fetchImpl !== 'function') {
      throw failure(ERROR_CODES.runtimeUnavailable, 'This runtime has no fetch implementation; no turn was sent.')
    }

    let response
    try {
      response = await fetchImpl(new URL('/plugins/rayrun/rpc', origin), {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'overview' }),
        signal: AbortSignal.timeout(OVERVIEW_TIMEOUT_MS),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw failure(ERROR_CODES.internal, 'Reading the cloud computer list timed out; no turn was sent.')
      }
      throw failure(ERROR_CODES.depMissing, 'The cloud-computer plugin is not reachable; no turn was sent.')
    }

    let body = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (!response.ok || body?.ok !== true) throw dependencyFailure(rpcFailure(body, response.status))
    if (body.connection?.configured !== true) {
      throw failure(ERROR_CODES.tokenRequired, 'Connect Rayrun in Bots setup before sending a message.')
    }

    const machines = Array.isArray(body.machines)
      ? body.machines.filter((machine) => machine?.status !== 'Terminated')
      : []
    const machine = machines.find((item) => item.name === DEFAULT_COMPUTER)
      ?? machines.find((item) => item.remote_desktop && item.desktop_url)
      ?? machines[0]
    if (!machine) {
      throw failure(ERROR_CODES.machineStopped, 'No cloud computer yet; create one in Bots setup first.')
    }
    if (!machine.name && !machine.id) {
      throw failure(ERROR_CODES.machineStopped, 'The cloud computer has no name or id; no turn was sent.')
    }
    return machine
  }

  return {
    contract: RUNTIME_CONTRACT_VERSION,
    name: 'rayrun-agent',
    get available() {
      return typeof agentTool()?.execute === 'function'
    },
    async run({ bot, text, history = [], messageSeq } = {}) {
      const tool = agentTool()
      if (typeof tool?.execute !== 'function') {
        throw failure(ERROR_CODES.runtimeUnavailable, 'dsh-rayrun-computer is missing the rayrun_agent tool; no turn was sent.')
      }
      const machine = await resolveMachine()
      const prompt = buildPrompt({ bot, text, history, messageSeq })

      // Host-initiated call to the tool's published execute(). There is no agent
      // tool pipeline here; the host composes the only arguments and never
      // passes a user-controlled tool name.
      //
      // The dependency's resolveSandbox can auto-create when a named machine is
      // gone. We pass a machine observed by overview, so that only happens in a
      // narrow deletion race; this adapter never creates one intentionally.
      let result
      try {
        result = await tool.execute(
          { sandbox: machine.name || machine.id, prompt, timeout_seconds: AGENT_TIMEOUT_SECONDS },
          { signal: new AbortController().signal },
        )
      } catch (error) {
        throw dependencyFailure(error)
      }

      if (result?.finished !== true) {
        throw failure(ERROR_CODES.internal, `The cloud agent did not finish; nothing was stored. Try again.${resultDetail(result)}`)
      }
      const reply = typeof result.text === 'string' ? result.text.trim() : ''
      if (reply === '') {
        throw failure(ERROR_CODES.internal, `The cloud agent returned no text; nothing was stored.${resultDetail(result)}`)
      }
      return { text: reply }
    },
  }
}
