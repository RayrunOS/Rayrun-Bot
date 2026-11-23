/**
 * Fake end-to-end cloud routine path.
 *
 * Local routine -> bridge upload -> cloud host scheduler/queue -> result
 * download -> local routine history. No Rayrun token, machine, or network.
 *
 *   node test/cloud-routine-e2e.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCloudHost } from '../cloud-host/lib/host.mjs'
import { buildRoutinePrompt, readBotFile } from '../cloud-host/lib/prompt.mjs'
import { createCloudRoutineBridge } from '../lib/cloud-routine-bridge.js'
import { openBotStore } from '../lib/bots.js'
import { openRoutineStore } from '../lib/routines.js'
import { openSessionStore } from '../lib/sessions.js'

const T0 = Date.parse('2026-11-23T10:00:00.000Z')
const T1 = T0 + 5 * 60_000
const roots = []

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-cloud-routine-e2e-'))
  const cloudRoot = mkdtempSync(path.join(tmpdir(), 'rayrun-cloud-routine-e2e-cloud-'))
  roots.push(root, cloudRoot)
  const bots = openBotStore(root)
  const bot = bots.create({ id: 'cloud-bot', name: 'Cloud Bot', label: 'Runs routines.' })
  openRoutineStore(root).create(bot.id, {
    title: 'Inbox', prompt: 'Summarize the inbox.', everyMinutes: 5,
  }, { now: T0 })

  const cloudPath = (remote) => path.join(cloudRoot, remote.replace(/^\.rayrun\//, ''))
  const tool = {
    async execute(args) {
      if (args.action === 'upload') {
        const target = cloudPath(args.path)
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, args.text)
        return 'Uploaded'
      }
      if (args.action === 'download') {
        try {
          return readFileSync(cloudPath(args.path), 'utf8')
        } catch (error) {
          const missing = new Error('file not found')
          missing.status = 404
          throw missing
        }
      }
      if (args.action === 'list') {
        const directory = cloudPath(args.path)
        let names
        try {
          names = readdirSync(directory)
        } catch {
          return `${args.path}: empty`
        }
        if (names.length === 0) return `${args.path}: empty`
        return names.map((name) => `- ${name}`).join('\n')
      }
      throw new Error(`unexpected file action: ${args.action}`)
    },
  }
  const bridge = createCloudRoutineBridge({
    stateRoot: root,
    getTools: () => ({ get: (name) => (name === 'rayrun_files' ? tool : undefined) }),
    getMachine: async () => ({ id: 'box-id', name: 'box', status: 'Running' }),
  })
  let now = T0
  const host = createCloudHost({
    root: cloudRoot,
    logPath: path.join(cloudRoot, 'host.log'),
    now: () => new Date(now).toISOString(),
    agent: async ({ text }) => ({
      text: `context:${text.includes('Cloud Bot')}:${text.includes('Scheduled routine: Inbox')}`,
    }),
    promptFor: ({ botId, task }) => buildRoutinePrompt({
      bot: readBotFile(path.join(cloudRoot, 'bots', botId)),
      text: task.text,
      machine: 'box',
    }),
  })
  host.recover()
  return {
    root, cloudRoot, bot, bridge, host, tool,
    setNow(value) { now = value },
  }
}

const errors = []
try {
  const { root, bot, bridge, host, setNow } = setup()
  const uploaded = await bridge.sync(bot.id)
  assert.equal(uploaded.uploaded, true)
  assert.equal(uploaded.imported, 0)

  setNow(T1)
  const enqueued = host.enqueueDueRoutines()
  assert.equal(enqueued.length, 1)
  assert.equal(enqueued[0].botId, bot.id)
  const result = await host.processNext()
  assert.equal(result.botId, bot.id)
  assert.equal(result.reply, 'context:true:true')

  const imported = await bridge.sync(bot.id)
  assert.equal(imported.imported, 1)
  assert.equal(imported.duplicates, 0)
  const history = openSessionStore(root).history(bot.id, { tail: true })
  assert.deepEqual(history.messages.map((message) => [message.role, message.origin]), [
    ['user', 'routine'],
    ['bot', undefined],
  ])
  assert.match(history.messages[0].text, /Scheduled routine: Inbox/)
  assert.equal(history.messages[1].text, 'context:true:true')

  const again = await bridge.sync(bot.id)
  assert.equal(again.imported, 0)
  assert.equal(again.duplicates, 1)
  console.log('ok   local routine -> cloud scheduler/queue -> local history')
  console.log('1/1 cloud routine E2E checks passed')
} catch (error) {
  errors.push(error)
  console.error(`FAIL cloud routine E2E: ${error?.stack ?? error}`)
  process.exitCode = 1
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
if (errors.length > 0) process.exit(1)
