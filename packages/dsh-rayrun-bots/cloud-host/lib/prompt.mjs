/**
 * Build the full prompt for a cloud-scheduled routine turn.
 *
 * A routine task carries only the routine text. The cloud host adds the
 * mirrored bot definition and the approval hint; the persistent DSH session
 * already carries the conversation, so this prompt does not replay transcript
 * history. `bot.json` is an untrusted workspace file and is validated here.
 */
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const INSTRUCTIONS_MAX_BYTES = 8 * 1024
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function textOf(value, field, { max, oneLine = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const result = value.trim()
  if (result === '') throw new Error(`${field} is required`)
  if (oneLine && /[\u0000-\u001f\u007f]/.test(result)) throw new Error(`${field} must stay on one line`)
  if (!oneLine && CONTROL.test(result)) throw new Error(`${field} contains control characters`)
  if (max !== undefined && [...result].length > max) throw new Error(`${field} is too long`)
  return result
}

/** Read and validate the locally mirrored `bot.json`. */
export function readBotFile(botRoot) {
  let value
  try {
    value = JSON.parse(readFileSync(path.join(botRoot, 'bot.json'), 'utf8'))
  } catch {
    throw new Error('bot.json is missing or invalid')
  }
  if (!isObject(value)) throw new Error('bot.json must be an object')
  const instructions = typeof value.instructions === 'string' ? value.instructions : ''
  if (Buffer.byteLength(instructions, 'utf8') > INSTRUCTIONS_MAX_BYTES) {
    throw new Error('bot instructions are too large')
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(instructions)) {
    throw new Error('bot instructions contain control characters')
  }
  return {
    name: textOf(value.name, 'bot name', { max: 80, oneLine: true }),
    label: textOf(value.label, 'bot label', { max: 120, oneLine: true }),
    instructions: instructions.trim(),
  }
}

/** Compose one routine prompt with bot context and the structured approval hint. */
export function buildRoutinePrompt({ bot, text, machine = '' }) {
  const name = typeof bot?.name === 'string' && bot.name.trim() ? bot.name.trim() : 'the bot'
  const label = typeof bot?.label === 'string' ? bot.label.trim() : ''
  const instructions = typeof bot?.instructions === 'string' ? bot.instructions.trim() : ''
  const lines = [
    `You are ${name}${label ? `, ${label}` : ''}.`,
    '',
    'Instructions:',
    instructions || '(No extra instructions.)',
    '',
    `User: ${String(text ?? '').trim()}`,
    '',
    `Reply as ${name} to the user's latest message. Work inside the cloud computer. Do not send, publish, spend, create or destroy computers, or touch another machine without an explicit user decision; if the decision is missing, ask and stop. Never claim work you have not verified.`,
    '',
    'Approval requests: to request one controlled action, end your reply with exactly this fenced block (the host submits it; never perform the action yourself):',
    '```rayrun-approval',
    JSON.stringify({ kind: 'rayrun.machine.stop', machine: machine || '<machine>' }),
    '```',
    'Allowed kinds: rayrun.machine.start, rayrun.machine.stop, rayrun.machine.pause, rayrun.machine.resume. Tell the user it is waiting for approval. Never assume approval.',
  ]
  return lines.join('\n')
}
