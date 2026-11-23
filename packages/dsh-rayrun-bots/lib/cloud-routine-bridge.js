/**
 * Mirror local routines to the cloud host and import cloud routine results.
 *
 * Definitions are written by the local host and uploaded only while the
 * machine is Running. A stopped machine is left stopped; routines never wake a
 * stopped machine on a sync. Results are display history: they are validated,
 * stored as one immutable local file per task, and merged by `session.history`.
 *
 * The cloud workspace is writable by the agent, so both directions are
 * untrusted input. This bridge does not grant approvals or execute actions.
 */
import { assertBotId } from './bot-schema.js'
import { openBotStore } from './bots.js'
import { ERROR_CODES } from './errors.js'
import { missingFile, parseListing } from './cloud-approval-bridge.js'
import { openRoutineStore } from './routines.js'
import { routineResultExists, validateRoutineResult, writeRoutineResult } from './routine-results.js'
import { rayrunFailure } from './rayrun-rpc.js'

const MAX_RESULTS = 20
const MAX_RESULT_FILE_BYTES = 128 * 1024

/**
 * @param {{
 *   stateRoot: string,
 *   getTools?: () => object,
 *   getMachine?: () => Promise<{ id: string, name?: string, status?: string }>,
 * }} options
 */
export function createCloudRoutineBridge({ stateRoot, getTools, getMachine } = {}) {
  if (typeof stateRoot !== 'string' || stateRoot.trim() === '') {
    throw new TypeError('cloud routine bridge needs a stateRoot.')
  }
  if (typeof getMachine !== 'function') throw new TypeError('cloud routine bridge needs getMachine.')
  const root = stateRoot
  const bots = openBotStore(root)
  const store = openRoutineStore(root)
  const mirrored = new Map()

  function filesTool() {
    let tool
    try {
      tool = getTools?.()?.get?.('rayrun_files')
    } catch {
      tool = undefined
    }
    if (typeof tool?.execute !== 'function') {
      throw rayrunFailure(ERROR_CODES.runtimeUnavailable, 'dsh-rayrun-computer is missing the rayrun_files tool.')
    }
    return tool
  }

  async function runningMachine() {
    let machine
    try {
      machine = await getMachine()
    } catch (error) {
      if (error?.code === ERROR_CODES.machineStopped) return null
      throw error
    }
    if (!machine || machine.status !== 'Running') return null
    return machine
  }

  function definitions(botId) {
    let bot
    let routines
    try {
      bot = bots.get(botId)
      routines = store.list(botId)
    } catch (error) {
      if (error?.code === ERROR_CODES.botUnknown) return null
      throw error
    }
    return { bot, routines: { schema: 1, botId, routines } }
  }

  async function uploadDefinitions(botId, machine) {
    const value = definitions(botId)
    if (value === null) return false
    const botText = `${JSON.stringify(value.bot, null, 2)}\n`
    const routinesText = `${JSON.stringify(value.routines, null, 2)}\n`
    const signature = `${botText}\u0000${routinesText}`
    const cached = mirrored.get(botId)
    if (cached?.machineId === String(machine.id) && cached.signature === signature) return false
    const tool = filesTool()
    const sandbox = machine.name || machine.id
    // Upload the bot first: once the routine file is visible, a cloud scheduler
    // tick may enqueue immediately, and its prompt builder needs this mirror.
    await tool.execute({
      action: 'upload',
      sandbox,
      path: `.rayrun/bots/${botId}/bot.json`,
      text: botText,
    }, { signal: AbortSignal.timeout(60_000) })
    await tool.execute({
      action: 'upload',
      sandbox,
      path: `.rayrun/bots/${botId}/routines.json`,
      text: routinesText,
    }, { signal: AbortSignal.timeout(60_000) })
    mirrored.set(botId, { machineId: String(machine.id), signature })
    return true
  }

  async function importResults(botId, machine) {
    const tool = filesTool()
    const sandbox = machine.name || machine.id
    let output
    try {
      output = await tool.execute({
        action: 'list',
        sandbox,
        path: `.rayrun/bots/${botId}/routine-results`,
      }, { signal: AbortSignal.timeout(60_000) })
    } catch (error) {
      if (missingFile(error)) return { imported: 0, duplicates: 0, rejected: 0, truncated: false }
      throw error
    }
    const listed = parseListing(output)
    const fresh = []
    let imported = 0
    let duplicates = 0
    let rejected = 0
    for (const entry of listed) {
      const taskId = entry.name.slice(0, -'.json'.length)
      try {
        if (routineResultExists(root, botId, taskId)) duplicates += 1
        else fresh.push(entry)
      } catch {
        rejected += 1
      }
    }
    const selected = fresh.slice(0, MAX_RESULTS)
    for (const entry of selected) {
      if (entry.size !== null && entry.size > MAX_RESULT_FILE_BYTES) {
        rejected += 1
        continue
      }
      let text
      try {
        text = await tool.execute({
          action: 'download',
          sandbox,
          path: `.rayrun/bots/${botId}/routine-results/${entry.name}`,
        }, { signal: AbortSignal.timeout(60_000) })
      } catch (error) {
        if (missingFile(error)) {
          rejected += 1
          continue
        }
        throw error
      }
      if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_RESULT_FILE_BYTES) {
        rejected += 1
        continue
      }
      let value
      try {
        value = JSON.parse(text)
      } catch {
        rejected += 1
        continue
      }
      let result
      try {
        result = validateRoutineResult(value, { botId, filename: entry.name })
      } catch {
        rejected += 1
        continue
      }
      try {
        writeRoutineResult(root, result, { botId })
        imported += 1
      } catch (error) {
        if (error?.code === ERROR_CODES.routineInvalid || error?.code === ERROR_CODES.botUnknown) {
          rejected += 1
          continue
        }
        throw error
      }
    }
    return {
      imported,
      duplicates,
      rejected,
      truncated: fresh.length > selected.length,
    }
  }

  /** Upload definitions and import results for one bot; never starts a machine. */
  async function sync(botId) {
    const bot = assertBotId(botId)
    const machine = await runningMachine()
    if (machine === null) {
      return {
        uploaded: false, imported: 0, duplicates: 0, rejected: 0, truncated: false,
        skipped: 'machine_not_running',
      }
    }
    const uploaded = await uploadDefinitions(bot, machine)
    const results = await importResults(bot, machine)
    return { uploaded, ...results }
  }

  return { sync, uploadDefinitions }
}

export { MAX_RESULT_FILE_BYTES, MAX_RESULTS }
