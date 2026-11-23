/**
 * Local routine scheduler.
 *
 * The local DSH host owns the schedule: it checks due routines and enqueues one
 * ordinary bot turn for a due routine. The cloud queue still executes turns
 * serially; this is not a second queue and it adds no approval bypass. Only one
 * routine turn is enqueued per bot per tick, and a busy bot is left alone for
 * the next tick.
 *
 * This scheduler runs only while the local DSH host is alive. If the host is
 * stopped, a due routine is not replayed; the next start runs one catch-up turn
 * and then resumes the normal interval. A cloud-host scheduler that survives a
 * closed laptop is deliberately not part of this MVP.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { openBotStore } from './bots.js'
import { buildRoutinePrompt, openRoutineStore } from './routines.js'

const DEFAULT_TICK_MS = 30_000
const MIN_TICK_MS = 1000

const describe = (error) => String(error?.message ?? error).slice(0, 200)

/**
 * @param {{
 *   stateRoot: string,
 *   botStore?: object,
 *   routineStore?: object,
 *   canRun?: () => boolean,
 *   isBusy?: (botId: string) => boolean,
 *   send: (botId: string, text: string, options: { origin: 'routine' }) => unknown,
 *   now?: () => number,
 *   everyMs?: number,
 *   logger?: { info?: Function, warn?: Function },
 * }} options
 */
export function createRoutineScheduler({
  stateRoot,
  botStore,
  routineStore,
  canRun = () => true,
  isBusy = () => false,
  send,
  now = Date.now,
  everyMs = DEFAULT_TICK_MS,
  logger,
} = {}) {
  if (typeof stateRoot !== 'string' || stateRoot.trim() === '') {
    throw new TypeError('routine scheduler needs a stateRoot.')
  }
  if (typeof send !== 'function') throw new TypeError('routine scheduler needs send.')
  if (!Number.isInteger(everyMs) || everyMs < MIN_TICK_MS) {
    throw new TypeError(`routine scheduler everyMs must be an integer of at least ${MIN_TICK_MS}.`)
  }
  let bots = botStore ?? null
  let routines = routineStore ?? null
  let botsDirectoryExists = botStore !== undefined || existsSync(path.join(stateRoot, 'bots'))
  const errors = new Map()
  let timer = null
  let ticking = false

  function noteError(botId, routineId, error) {
    const key = `${botId}/${routineId}`
    const code = typeof error?.code === 'string' ? error.code : 'E_INTERNAL'
    if (errors.get(key) === code) return
    errors.set(key, code)
    try {
      logger?.warn?.(`dsh-rayrun-bots: routine ${routineId} for ${botId} did not run (${code}: ${describe(error)})`)
    } catch {
      // Logging must not stop the scheduler.
    }
  }

  function clearError(botId, routineId) {
    errors.delete(`${botId}/${routineId}`)
  }

  /**
   * Run one pass. Tests drive this directly; the host calls it on a timer.
   * At most one due routine is attempted per bot per pass; remaining due
   * routines wait for a later pass after the bot is idle again.
   */
  async function tick() {
    if (ticking) return { fired: [], skipped: 'busy_tick' }
    ticking = true
    try {
      let available = false
      try {
        available = canRun() === true
      } catch {
        available = false
      }
      if (!available) return { fired: [], skipped: 'runtime_unavailable' }
      if (!botsDirectoryExists) {
        botsDirectoryExists = existsSync(path.join(stateRoot, 'bots'))
        if (!botsDirectoryExists) return { fired: [] }
      }
      if (bots === null) bots = openBotStore(stateRoot)
      if (routines === null) routines = openRoutineStore(stateRoot)

      const at = now()
      if (!Number.isFinite(at)) throw new Error('routine scheduler now() returned a non-numeric value.')
      const fired = []
      for (const bot of bots.list()) {
        let due
        try {
          due = routines.due(bot.id, at)
        } catch (error) {
          noteError(bot.id, 'store', error)
          continue
        }
        if (due.length === 0) continue
        let busy = false
        try {
          busy = isBusy(bot.id) === true
        } catch (error) {
          noteError(bot.id, 'status', error)
          continue
        }
        if (busy) continue
        const routine = due[0]
        // Claim the run before enqueueing. A crash after this point must not
        // turn into a duplicate turn on the next host start; a failed send
        // consumes the run and waits for the next interval.
        try {
          routines.markRun(bot.id, routine.id, { now: at })
        } catch (error) {
          noteError(bot.id, routine.id, error)
          continue
        }
        try {
          await send(bot.id, buildRoutinePrompt(routine), { origin: 'routine' })
          clearError(bot.id, routine.id)
          fired.push({ botId: bot.id, routineId: routine.id })
          try {
            logger?.info?.(`dsh-rayrun-bots: routine ${routine.id} fired for ${bot.id}`)
          } catch {
            // Logging must not stop the scheduler.
          }
        } catch (error) {
          noteError(bot.id, routine.id, error)
        }
      }
      return { fired }
    } finally {
      ticking = false
    }
  }

  function start() {
    if (timer !== null) return
    void tick().catch((error) => {
      try { logger?.warn?.(`dsh-rayrun-bots: routine pass failed: ${describe(error)}`) } catch { /* best effort */ }
    })
    timer = setInterval(() => {
      void tick().catch((error) => {
        try { logger?.warn?.(`dsh-rayrun-bots: routine pass failed: ${describe(error)}`) } catch { /* best effort */ }
      })
    }, everyMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function stop() {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  return {
    tick,
    start,
    stop,
    get running() { return timer !== null },
  }
}
