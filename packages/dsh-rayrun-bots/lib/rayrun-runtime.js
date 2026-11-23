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
import { createRayrunRpc, dependencyFailure, rayrunFailure } from './rayrun-rpc.js'
import { RUNTIME_CONTRACT_VERSION } from './runtime.js'

const AGENT_TIMEOUT_SECONDS = 900
const HISTORY_MAX_BYTES = 24 * 1024

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
export function buildPrompt({ bot, text, history = [], messageSeq, proposalHint = false } = {}) {
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
    ...(proposalHint ? [
      '',
      'Approval requests: for a controlled action, run `node "$DSH_BOT_PROPOSE" --kind rayrun.machine.stop --machine "$DSH_BOT_MACHINE"` (allowed kinds: rayrun.machine.start, rayrun.machine.stop), then stop and tell the user it is waiting. Never perform the action yourself. Approval results appear under "$DSH_BOT_ROOT/bots/$DSH_BOT_ID/approval-results/"; read them, and never assume approval.',
    ] : []),
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

  const rpc = createRayrunRpc({ getOrigin, fetchImpl })

  return {
    contract: RUNTIME_CONTRACT_VERSION,
    name: 'rayrun-agent',
    get available() {
      return typeof agentTool()?.execute === 'function'
    },
    async run({ bot, text, history = [], messageSeq } = {}) {
      const tool = agentTool()
      if (typeof tool?.execute !== 'function') {
        throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'dsh-rayrun-computer is missing the rayrun_agent tool; no turn was sent.')
      }
      const machine = await rpc.resolveMachine()
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
        throw rayrunFailure(ERROR_CODES.internal, `The cloud agent did not finish; nothing was stored. Try again.${resultDetail(result)}`)
      }
      const reply = typeof result.text === 'string' ? result.text.trim() : ''
      if (reply === '') {
        throw rayrunFailure(ERROR_CODES.internal, `The cloud agent returned no text; nothing was stored.${resultDetail(result)}`)
      }
      return { text: reply }
    },
  }
}
