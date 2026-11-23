/**
 * Convert one structured approval block in the bot's final reply into a
 * proposal file. The block is a request, not an authorization; the local DSH
 * host validates it again and only a local human decision can execute it.
 *
 *   ```rayrun-approval
 *   {"kind":"rayrun.machine.stop","machine":"my-computer"}
 *   ```
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync, fsyncSync, linkSync, mkdirSync, openSync, unlinkSync, writeSync,
} from 'node:fs'
import path from 'node:path'

const BOT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MACHINE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const KINDS = new Set(['rayrun.machine.start', 'rayrun.machine.stop', 'rayrun.machine.pause', 'rayrun.machine.resume'])
const ORIGINS = new Set(['chat', 'background'])
const MARKER = /```rayrun-approval\s*\r?\n([\s\S]*?)\r?\n```/

function invalid(message) {
  return { text: message, proposal: null, error: message }
}

/**
 * Extract the first valid approval block. Invalid blocks are left in the reply
 * and reported as an error so the host can log them; no proposal is written.
 * @param {string} text
 * @param {{ botId: string, defaultMachine?: string, origin?: 'chat' | 'background' }} options
 */
export function extractProposal(text, { botId, defaultMachine = '', origin = 'chat' } = {}) {
  const reply = String(text ?? '')
  if (!BOT_ID.test(String(botId ?? ''))) return invalid('proposal bot id is invalid.')
  if (!ORIGINS.has(origin)) return invalid('proposal origin is invalid.')
  const match = MARKER.exec(reply)
  if (!match) return { text: reply, proposal: null, error: null }
  let value
  try {
    value = JSON.parse(match[1].trim())
  } catch {
    return { text: reply, proposal: null, error: 'approval block is not valid JSON.' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { text: reply, proposal: null, error: 'approval block must be an object.' }
  }
  for (const key of Object.keys(value)) {
    if (key !== 'kind' && key !== 'machine') return { text: reply, proposal: null, error: `unsupported approval field: ${key}.` }
  }
  if (!KINDS.has(value.kind)) return { text: reply, proposal: null, error: 'unsupported approval kind.' }
  const machine = typeof value.machine === 'string' && value.machine.trim() !== ''
    ? value.machine.trim()
    : String(defaultMachine ?? '').trim()
  if (!MACHINE.test(machine)) return { text: reply, proposal: null, error: 'approval machine is invalid.' }
  const id = `prop-${randomUUID()}`
  const cleaned = `${reply.slice(0, match.index)}${reply.slice(match.index + match[0].length)}`.trim()
  return {
    text: cleaned || 'Waiting for approval.',
    proposal: {
      schema: 1,
      id,
      botId,
      actionId: id,
      action: { kind: value.kind, machine },
      origin,
      createdAt: new Date().toISOString(),
    },
    error: null,
  }
}

/** Write a proposal under `<root>/bots/<botId>/proposals/` without overwriting. */
export function writeProposal(root, botId, proposal) {
  if (!BOT_ID.test(String(botId ?? ''))) throw new Error('proposal bot id is invalid.')
  if (!proposal || proposal.botId !== botId || typeof proposal.id !== 'string') {
    throw new Error('proposal does not match the bot.')
  }
  const directory = path.join(String(root), 'bots', botId, 'proposals')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const target = path.join(directory, `${proposal.id}.json`)
  const temp = path.join(directory, `.${proposal.id}.tmp-${randomUUID()}`)
  const data = Buffer.from(`${JSON.stringify(proposal, null, 2)}\n`, 'utf8')
  const fd = openSync(temp, 'wx', 0o600)
  try {
    let offset = 0
    while (offset < data.length) offset += writeSync(fd, data, offset, data.length - offset)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    linkSync(temp, target)
  } finally {
    try { unlinkSync(temp) } catch { /* the hard link is what matters */ }
  }
  return target
}
