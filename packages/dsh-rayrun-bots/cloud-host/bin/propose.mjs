#!/usr/bin/env node
/**
 * Write one typed approval proposal inside the bot's cloud workspace.
 *
 * This is a proposal writer, not an approval authority: the local DSH host
 * re-validates the action, creates the local request and executes only after a
 * local human decision. The file is intentionally small and has no token.
 *
 *   DSH_BOT_ROOT=/workspace/.rayrun DSH_BOT_ID=my-bot \
 *     node propose.mjs --kind rayrun.machine.stop --machine my-computer
 */
import { randomUUID } from 'node:crypto'
import {
  closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, unlinkSync, writeSync,
} from 'node:fs'
import path from 'node:path'

const BOT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ID = /^[A-Za-z0-9._-]{1,80}$/
const MACHINE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const KINDS = new Set(['rayrun.machine.start', 'rayrun.machine.stop'])
const ORIGINS = new Set(['chat', 'background'])
const FIELDS = new Set(['kind', 'machine', 'id', 'origin'])

function fail(message) {
  process.stderr.write(`propose: ${message}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) fail(`unexpected argument: ${arg}`)
    const key = arg.slice(2)
    if (!FIELDS.has(key)) fail(`unsupported option: ${arg}`)
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) fail(`missing value for ${arg}`)
    options[key] = value
    index += 1
  }
  return options
}

function writeJsonOnce(filename, value) {
  const directory = path.dirname(filename)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
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
    linkSync(temp, filename)
  } catch (error) {
    if (error?.code === 'EEXIST') fail(`proposal already exists: ${path.basename(filename)}`)
    throw error
  } finally {
    try { unlinkSync(temp) } catch { /* the hard link is what matters */ }
  }
}

const options = parseArgs(process.argv.slice(2))
const root = String(process.env.DSH_BOT_ROOT || '/workspace/.rayrun')
const botId = String(process.env.DSH_BOT_ID || '')
const defaultMachine = String(process.env.DSH_BOT_MACHINE || '')
if (!BOT_ID.test(botId)) fail('DSH_BOT_ID must be a kebab-case bot id')
const kind = String(options.kind || '')
if (!KINDS.has(kind)) fail(`unsupported kind: ${kind || '(missing)'}`)
const machine = String(options.machine || defaultMachine)
if (!MACHINE.test(machine)) fail('machine must be a cloud-computer name or id')
const origin = String(options.origin || 'chat')
if (!ORIGINS.has(origin)) fail('origin must be chat or background')
const id = String(options.id || `prop-${randomUUID()}`)
if (!ID.test(id)) fail('id must be a safe file name')

const proposal = {
  schema: 1,
  id,
  botId,
  actionId: id,
  action: { kind, machine },
  origin,
  createdAt: new Date().toISOString(),
}
const target = path.join(root, 'bots', botId, 'proposals', `${id}.json`)
if (existsSync(target)) fail(`proposal already exists: ${id}`)
writeJsonOnce(target, proposal)
process.stdout.write(`proposal ${id}\n`)
