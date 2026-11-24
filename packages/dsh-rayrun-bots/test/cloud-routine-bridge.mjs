/**
 * Cloud routine bridge checks (fake file tool and machine).
 *
 *   node test/cloud-routine-bridge.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCloudRoutineBridge } from '../lib/cloud-routine-bridge.js'
import { openBotStore } from '../lib/bots.js'
import { ERROR_CODES } from '../lib/errors.js'
import { openRoutineStore } from '../lib/routines.js'
import { readRoutineResults } from '../lib/routine-results.js'

const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []
const T0 = Date.parse('2026-11-23T10:00:00.000Z')
const TASK = 'task-11111111-1111-1111-1111-111111111111'
const ROUTINE = 'routine-11111111-1111-1111-1111-111111111111'

function setup({ status = 'Running', withTool = true, uploadDelay = () => 0 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-cloud-routines-'))
  roots.push(root)
  const bots = openBotStore(root)
  const bot = bots.create({ id: 'cloud-bot', name: 'Cloud Bot', label: 'Runs routines.' })
  const routines = openRoutineStore(root)
  routines.create(bot.id, {
    title: 'Inbox', prompt: 'Check the inbox.', everyMinutes: 15,
  }, { now: T0 })
  const files = new Map()
  const uploads = []
  const listingSizes = new Map()
  const tool = {
    async execute(args) {
      if (args.action === 'list') {
        const prefix = `${args.path}/`
        const entries = [...files.keys()].filter((key) => key.startsWith(prefix))
        if (entries.length === 0) return `${args.path}: empty`
        return entries.map((key) => {
          const name = key.slice(prefix.length)
          const size = listingSizes.get(key)
          return `- ${name}${size === undefined ? '' : `  ${size} B`}`
        }).join('\n')
      }
      if (args.action === 'download') {
        if (!files.has(args.path)) {
          const error = new Error('file not found')
          error.status = 404
          throw error
        }
        return files.get(args.path)
      }
      if (args.action === 'upload') {
        uploads.push(args)
        const delay = uploadDelay(uploads.length, args)
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
        files.set(args.path, args.text)
        return 'Uploaded'
      }
      throw new Error(`unexpected file action: ${args.action}`)
    },
  }
  let machineStatus = status
  const bridge = createCloudRoutineBridge({
    stateRoot: root,
    getTools: () => (withTool ? { get: (name) => (name === 'rayrun_files' ? tool : undefined) } : { get: () => undefined }),
    getMachine: async () => ({ id: 'box-id', name: 'box', status: machineStatus }),
  })
  function result(overrides = {}) {
    return {
      schema: 1,
      botId: bot.id,
      taskId: TASK,
      text: 'Scheduled routine: Inbox\n\nCheck the inbox.',
      reply: 'All clear.',
      at: '2026-11-23T10:15:00.000Z',
      routineId: ROUTINE,
      ...overrides,
    }
  }
  function cloudResult(value = result(), name = `${value.taskId}.json`) {
    files.set(`.rayrun/bots/${bot.id}/routine-results/${name}`, JSON.stringify(value))
  }
  return {
    root, bot, routines, bridge, files, uploads, listingSizes, result, cloudResult,
    setStatus: (value) => { machineStatus = value },
  }
}

check('uploads definitions, imports one result and deduplicates the next sync', async () => {
  const { root, bot, bridge, uploads, cloudResult, result } = setup()
  cloudResult()
  const first = await bridge.sync(bot.id)
  assert.equal(first.uploaded, true)
  assert.equal(first.imported, 1)
  assert.equal(first.duplicates, 0)
  assert.equal(first.rejected, 0)
  assert.equal(uploads.length, 2)
  assert.equal(uploads[0].path, `.rayrun/bots/${bot.id}/bot.json`)
  assert.equal(uploads[1].path, `.rayrun/bots/${bot.id}/routines.json`)
  const mirroredBot = JSON.parse(uploads[0].text)
  assert.equal(mirroredBot.id, bot.id)
  assert.equal(mirroredBot.label, 'Runs routines.')
  const definitions = JSON.parse(uploads[1].text)
  assert.equal(definitions.schema, 1)
  assert.equal(definitions.botId, bot.id)
  assert.equal(definitions.routines.length, 1)
  assert.doesNotMatch(uploads.map((item) => item.text).join('\n'), /Bearer\s|RAYRUN_TOKEN|sk-[A-Za-z0-9]{16,}/)

  const local = readRoutineResults(root, bot.id)
  assert.equal(local.length, 1)
  assert.equal(local[0].taskId, result().taskId)
  assert.equal(local[0].reply, 'All clear.')

  const second = await bridge.sync(bot.id)
  assert.equal(second.uploaded, false)
  assert.equal(second.imported, 0)
  assert.equal(second.duplicates, 1)
})

check('re-uploads after a local definition change', async () => {
  const { bot, routines, bridge, uploads } = setup()
  await bridge.sync(bot.id)
  assert.equal(uploads.length, 2)
  const current = routines.list(bot.id)[0]
  routines.update(bot.id, current.id, { everyMinutes: 30 }, { now: T0 + 60_000 })
  const again = await bridge.sync(bot.id)
  assert.equal(again.uploaded, true)
  assert.equal(uploads.length, 4)
})

check('serializes concurrent definition syncs so the latest upload wins', async () => {
  const delays = [80, 0, 0, 0, 0, 0]
  const { bot, routines, bridge, files, uploads } = setup({
    uploadDelay: (index) => delays[index - 1] ?? 0,
  })
  const first = bridge.sync(bot.id)
  while (uploads.length < 1) await new Promise((resolve) => setTimeout(resolve, 1))
  const current = routines.list(bot.id)[0]
  routines.update(bot.id, current.id, { everyMinutes: 30 }, { now: T0 + 60_000 })
  const second = bridge.sync(bot.id)
  await Promise.all([first, second])

  const mirrored = JSON.parse(files.get(`.rayrun/bots/${bot.id}/routines.json`))
  assert.equal(mirrored.routines[0].everyMinutes, 30)
  const routineUploads = uploads.filter((item) => item.path.endsWith('/routines.json'))
  assert.equal(JSON.parse(routineUploads.at(-1).text).routines[0].everyMinutes, 30)
})

check('imports more than one batch without getting stuck on duplicates', async () => {
  const { root, bot, bridge, cloudResult, result } = setup()
  for (let index = 0; index < 21; index += 1) {
    cloudResult(result({ taskId: `task-${String(index).padStart(3, '0')}` }))
  }
  const first = await bridge.sync(bot.id)
  assert.equal(first.imported, 20)
  assert.equal(first.truncated, true)
  const second = await bridge.sync(bot.id)
  assert.equal(second.imported, 1)
  assert.equal(second.duplicates, 20)
  assert.equal(second.truncated, false)
  assert.equal(readRoutineResults(root, bot.id).length, 21)
})

check('does not start a stopped machine or read cloud files', async () => {
  const { bot, bridge, uploads, cloudResult } = setup({ status: 'Stopped' })
  cloudResult()
  const result = await bridge.sync(bot.id)
  assert.equal(result.skipped, 'machine_not_running')
  assert.equal(result.uploaded, false)
  assert.equal(result.imported, 0)
  assert.equal(uploads.length, 0)
})

check('rejects malformed, wrong-bot and oversized results without writing them', async () => {
  const { root, bot, bridge, files, listingSizes, result } = setup()
  files.set(`.rayrun/bots/${bot.id}/routine-results/task-good.json`, JSON.stringify(result({ taskId: 'task-good' })))
  files.set(`.rayrun/bots/${bot.id}/routine-results/task-wrong.json`, JSON.stringify(result({ taskId: 'task-wrong', botId: 'other' })))
  files.set(`.rayrun/bots/${bot.id}/routine-results/task-extra.json`, JSON.stringify(result({ taskId: 'task-extra', extra: true })))
  files.set(`.rayrun/bots/${bot.id}/routine-results/task-large.json`, '{}')
  listingSizes.set(`.rayrun/bots/${bot.id}/routine-results/task-large.json`, 200_000)
  files.set(`.rayrun/bots/${bot.id}/routine-results/task-missing.json`, JSON.stringify(result({ taskId: 'task-other' })))
  const synced = await bridge.sync(bot.id)
  assert.equal(synced.imported, 1)
  assert.equal(synced.rejected, 4)
  assert.deepEqual(readRoutineResults(root, bot.id).map((item) => item.taskId), ['task-good'])
})

check('fails closed when the file tool is missing', async () => {
  const { bot, bridge } = setup({ withTool: false })
  await assert.rejects(
    bridge.sync(bot.id),
    (error) => error.code === ERROR_CODES.runtimeUnavailable,
  )
})

for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}: ${error?.message ?? error}`)
    process.exitCode = 1
  }
}

for (const root of roots) rmSync(root, { recursive: true, force: true })
if (!process.exitCode) console.log(`${checks.length}/${checks.length} cloud routine bridge checks passed`)
