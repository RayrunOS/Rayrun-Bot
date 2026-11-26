/**
 * Host half of the Rayrun Bot bundle.
 *
 * One same-origin RPC route: health, the persisted bot roster, durable
 * session/transcript, the approval protocol, and the runtime bridge to
 * `dsh-rayrun-computer`. Dependency 1.1+ uses detached
 * `dsh.start/status/result`; 1.0.x falls back to the single-turn
 * `rayrun_agent` tool. The client half renders the v0.1 shell, reads the
 * roster, and uses the host session for real bots.
 *
 * The health action reports the installed dependency version (ok / missing /
 * incompatible / unknown) and the selected runtime. POST is same-origin gated:
 * a browser `Origin` that does not match the `Host` the request reached is
 * refused. GET is read-only. The route never touches credentials: the Rayrun
 * token stays in the Harness vault on this side and never reaches the page.
 */
import { readFileSync } from 'node:fs'
import { createApprovalActionExecutor, normalizeApprovalAction } from './lib/approval-actions.js'
import { createCloudApprovalBridge } from './lib/cloud-approval-bridge.js'
import { createCloudRoutineBridge } from './lib/cloud-routine-bridge.js'
import { openApprovalExecutor } from './lib/approval-executor.js'
import { openApprovalStore } from './lib/approvals.js'
import { openBotStore } from './lib/bots.js'
import { createCloudHostRuntime } from './lib/cloud-host-runtime.js'
import { checkDependency, supportsDetached, supportsRuntimeRpc } from './lib/dependency.js'
import { ERROR_CODES } from './lib/errors.js'
import { resolveStateRoot } from './lib/local-store.js'
import { createRayrunDetachedRuntime } from './lib/rayrun-detached-runtime.js'
import { createRayrunAgentRuntime } from './lib/rayrun-runtime.js'
import { createRayrunRpc } from './lib/rayrun-rpc.js'
import { readJsonBody, sendError, sendJson } from './lib/rpc.js'
import { createRoutineScheduler } from './lib/routine-scheduler.js'
import { openRoutineStore } from './lib/routines.js'
import { validateRuntime } from './lib/runtime.js'
import { openSessionRunner } from './lib/sessions.js'
import { checkForUpdate, updateCommand } from './lib/update-check.js'

export const name = 'rayrun-bots'

const ROUTE = '/plugins/rayrun-bots'
const MAX_BODY = 64 * 1024

/** This build's version, read once from the package manifest. */
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()

function health(dependency, runtime) {
  return {
    ok: true,
    plugin: name,
    version: VERSION,
    ready: false,
    dependency,
    runtime: { name: runtime.name, available: runtime.available },
  }
}

/** The active profile directory, when the host runs inside a DSH profile. */
function profileDirectory(ctx) {
  try {
    const profile = ctx.get?.('profileContext')
    return typeof profile?.dir === 'string' ? profile.dir : undefined
  } catch {
    return undefined
  }
}

/** Run one roster action and return the success body. */
function botAction(action, payload, ctx, computerFor = () => null) {
  const stateRoot = resolveStateRoot({ profileDir: profileDirectory(ctx) })
  const store = openBotStore(stateRoot)
  const routines = openRoutineStore(stateRoot)
  switch (action) {
    case 'bots.list': {
      const bots = store.list()
      return {
        ok: true,
        bots,
        routines: Object.fromEntries(bots.map((bot) => [bot.id, routines.list(bot.id)])),
        computers: Object.fromEntries(bots.map((bot) => [bot.id, computerFor(bot.id)])),
      }
    }
    case 'bots.get': {
      const bot = store.get(payload.id)
      return { ok: true, bot, routines: routines.list(bot.id), computer: computerFor(bot.id) }
    }
    case 'bots.create': {
      const input = { ...payload }
      delete input.action
      const bot = store.create(input)
      return { ok: true, bot, routines: [] }
    }
    case 'bots.update': {
      const bot = store.update(payload.id, payload.patch)
      return { ok: true, bot, routines: routines.list(bot.id) }
    }
    case 'bots.delete':
      return { ok: true, deleted: store.remove(payload.id) }
    default: {
      const error = new Error(`Unknown action: ${action}`)
      error.status = 404
      throw error
    }
  }
}

/** Mirror a routine mutation to the cloud host without delaying the local write. */
function syncRoutineDefinitions(service, botId) {
  if (!service.bridge) return
  void service.bridge.sync(botId).catch((error) => {
    try {
      service.logger?.warn?.(`dsh-rayrun-bots: routine sync failed: ${String(error?.message ?? error).slice(0, 200)}`)
    } catch {
      // Logging must not change the local mutation.
    }
  })
}

/** Run one routine action for a real bot. All times and IDs are host-owned. */
async function routineAction(action, payload, service) {
  const bot = service.bots.get(payload.botId)
  switch (action) {
    case 'routines.list':
      return { ok: true, routines: service.routines.list(bot.id) }
    case 'routines.sync': {
      if (!service.bridge) {
        return { ok: true, uploaded: false, imported: 0, skipped: 'cloud_host_disabled' }
      }
      return { ok: true, ...(await service.bridge.sync(bot.id)) }
    }
    case 'routines.create': {
      const routine = service.routines.create(bot.id, {
        title: payload.title,
        prompt: payload.prompt,
        everyMinutes: payload.everyMinutes,
        ...(payload.enabled === undefined ? {} : { enabled: payload.enabled }),
      })
      syncRoutineDefinitions(service, bot.id)
      return { ok: true, routine, routines: service.routines.list(bot.id) }
    }
    case 'routines.update': {
      const routine = service.routines.update(bot.id, payload.id, payload.patch)
      syncRoutineDefinitions(service, bot.id)
      return { ok: true, routine, routines: service.routines.list(bot.id) }
    }
    case 'routines.remove': {
      const removed = service.routines.remove(bot.id, payload.id)
      syncRoutineDefinitions(service, bot.id)
      return { ok: true, removed, routines: service.routines.list(bot.id) }
    }
    default: {
      const error = new Error(`Unknown action: ${action}`)
      error.status = 404
      throw error
    }
  }
}

/** Map an action error to its stable code and HTTP status. */
const STATUS_BY_CODE = new Map([
  [ERROR_CODES.botUnknown, 404],
  [ERROR_CODES.botInvalid, 400],
  [ERROR_CODES.botExists, 409],
  [ERROR_CODES.routineUnknown, 404],
  [ERROR_CODES.routineInvalid, 400],
  [ERROR_CODES.sessionInvalid, 400],
  [ERROR_CODES.runtimeUnavailable, 503],
  [ERROR_CODES.queueFull, 429],
  [ERROR_CODES.hostDown, 503],
  [ERROR_CODES.approvalInvalid, 400],
  [ERROR_CODES.approvalUnsupported, 400],
  [ERROR_CODES.approvalExpired, 410],
  [ERROR_CODES.approvalReplay, 409],
  [ERROR_CODES.approvalUnknown, 404],
  [ERROR_CODES.approvalExecution, 502],
])

function sendActionError(res, error) {
  const code = typeof error?.code === 'string' && error.code.startsWith('E_')
    ? error.code
    : ERROR_CODES.internal
  const status = STATUS_BY_CODE.get(code) ?? (Number(error?.status) || 500)
  sendError(res, status, code, String(error?.message ?? error))
}

/** Run one session action against the bot's durable local session. */
function sessionAction(action, payload, getService) {
  if (action !== 'session.send' && action !== 'session.history' && action !== 'session.status') {
    const error = new Error(`Unknown action: ${action}`)
    error.status = 404
    throw error
  }
  const service = getService()
  const bot = service.bots.get(payload.botId)
  switch (action) {
    case 'session.send':
      return { ok: true, ...service.runner.send(bot.id, payload.text) }
    case 'session.history':
      return {
        ok: true,
        ...service.runner.history(bot.id, { after: payload.after, limit: payload.limit, tail: payload.tail }),
      }
    default:
      return { ok: true, session: service.runner.status(bot.id) }
  }
}

/** Run one approval action: record the decision, then execute locally if approved. */
async function approvalAction(action, payload, service) {
  const { bots, approvals, executor } = service
  const bot = bots.get(payload.botId)
  switch (action) {
    case 'approvals.list':
      return {
        ok: true,
        approvals: approvals.list(bot.id).map((approval) => {
          const execution = executor.status(bot.id, approval.id)
          return execution === null ? approval : { ...approval, execution }
        }),
      }
    case 'approvals.get': {
      const approval = approvals.get(bot.id, payload.id)
      const execution = executor.status(bot.id, payload.id)
      return { ok: true, approval: execution === null ? approval : { ...approval, execution } }
    }
    case 'approvals.sync': {
      if (!service.bridge) {
        const error = new Error('The cloudHost runtime is not enabled; no proposals were fetched.')
        error.code = ERROR_CODES.runtimeUnavailable
        throw error
      }
      return { ok: true, ...(await service.bridge.sync(bot.id)) }
    }
    case 'approvals.propose': {
      const normalized = normalizeApprovalAction(payload.requestedAction)
      return {
        ok: true,
        approval: approvals.createRequest({
          botId: bot.id,
          actionId: payload.actionId,
          action: normalized.action,
          risk: normalized.risk,
          origin: payload.origin,
          ...(payload.expiresAt === undefined ? {} : { expiresAt: payload.expiresAt }),
        }),
      }
    }
    case 'approvals.decide': {
      const result = approvals.decide(bot.id, payload.id, payload.decision)
      const execution = result.approval.state === 'approved'
        ? await executor.run(bot.id, payload.id)
        : { available: true, mode: 'local', state: 'not_executed', reason: result.approval.state }
      if (service.bridge) {
        void service.bridge.writeResult(bot.id, payload.id, {
          state: result.approval.state,
          execution,
        }).catch((error) => {
          try {
            service.logger?.warn?.(`dsh-rayrun-bots: approval result write failed: ${String(error?.message ?? error).slice(0, 200)}`)
          } catch {
            // Logging must not change the local decision.
          }
        })
      }
      return { ok: true, ...result, execution }
    }
    default: {
      const error = new Error(`Unknown action: ${action}`)
      error.status = 404
      throw error
    }
  }
}

/**
 * A browser POST must come from the page DSH itself served. Requests without an
 * `Origin` header are host-side calls (tools, tests), not a cross-origin
 * browser vector. Mirrors the origin gate in `dsh-rayrun-computer`.
 */
function sameOrigin(req, webServer) {
  const origin = req.headers?.origin
  if (!origin) return true

  let originHost = ''
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }

  let expectedHost = String(req.headers?.host ?? '')
  if (!expectedHost) {
    try {
      expectedHost = new URL(webServer.getOrigin()).host
    } catch {
      expectedHost = ''
    }
  }

  return originHost !== '' && expectedHost !== '' && originHost === expectedHost
}

/**
 * Mount the host half.
 *
 * `options.runtime` is the test/bridge seam for a runtime adapter. Production
 * uses the `rayrun_agent` adapter when the dependency's tool is registered;
 * otherwise that adapter reports `available: false` and every send fails closed.
 */
export function apply(ctx, options = {}) {
  ctx.logger?.info?.(`dsh-rayrun-bots: host half loaded (${VERSION})`)
  let webServer
  const injectedRuntime = options.runtime === undefined ? undefined : validateRuntime(options.runtime)
  const installed = checkDependency(profileDirectory(ctx))
  let cloudHostRuntime
  if (options.cloudHost !== undefined && options.cloudHost !== null && options.cloudHost !== false) {
    const config = options.cloudHost === true ? {} : options.cloudHost
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new TypeError('cloudHost config must be an object.')
    }
    if (config.enabled !== false) {
      const hostOptions = { ...config }
      delete hostOptions.enabled
      cloudHostRuntime = createCloudHostRuntime({
        getOrigin: () => webServer?.getOrigin?.(),
        getTools: () => ctx.get?.('tools'),
        ...hostOptions,
        supported: supportsRuntimeRpc(installed.version),
      })
    }
  }
  const runtime = injectedRuntime ?? validateRuntime(
    cloudHostRuntime ?? (supportsDetached(installed.version)
      ? createRayrunDetachedRuntime({ getOrigin: () => webServer?.getOrigin?.() })
      : createRayrunAgentRuntime({
        getTools: () => ctx.get?.('tools'),
        getOrigin: () => webServer?.getOrigin?.(),
      })),
  )
  const hostHealth = () => health(checkDependency(profileDirectory(ctx)), runtime)

  let sessionService
  function sessions() {
    if (sessionService === undefined) {
      const stateRoot = resolveStateRoot({ profileDir: profileDirectory(ctx) })
      const bots = openBotStore(stateRoot)
      sessionService = {
        bots,
        runner: openSessionRunner({ stateRoot, runtime, getBot: bots.get, logger: ctx.logger }),
      }
    }
    return sessionService
  }

  function computerFor(botId) {
    const pinned = cloudHostRuntime?.machineName
    if (typeof pinned === 'string' && pinned !== '') return pinned
    return sessions().runner.computer(botId) ?? null
  }

  let approvalService
  function approvals() {
    if (approvalService === undefined) {
      const stateRoot = resolveStateRoot({ profileDir: profileDirectory(ctx) })
      const rpc = createRayrunRpc({ getOrigin: () => webServer?.getOrigin?.() })
      approvalService = {
        bots: openBotStore(stateRoot),
        approvals: openApprovalStore(stateRoot),
        executor: openApprovalExecutor({
          stateRoot,
          execute: createApprovalActionExecutor({ rpc }),
        }),
        bridge: cloudHostRuntime === undefined ? null : createCloudApprovalBridge({
          stateRoot,
          getTools: () => ctx.get?.('tools'),
          getMachine: () => cloudHostRuntime.ensureMachine({ start: false }),
        }),
        logger: ctx.logger,
      }
    }
    return approvalService
  }

  let routineSchedulerService
  function routineScheduler() {
    if (routineSchedulerService === undefined) {
      const stateRoot = resolveStateRoot({ profileDir: profileDirectory(ctx) })
      routineSchedulerService = createRoutineScheduler({
        stateRoot,
        // The cloud host owns scheduling when it is enabled; the local
        // scheduler is the non-cloudHost fallback.
        canRun: () => runtime.available === true && cloudHostRuntime === undefined,
        isBusy: (botId) => {
          const state = sessions().runner.status(botId)
          return state?.state === 'running' || state?.state === 'queued'
        },
        send: (botId, text, options) => sessions().runner.send(botId, text, options),
        logger: ctx.logger,
      })
    }
    return routineSchedulerService
  }

  let routineService
  function routines() {
    if (routineService === undefined) {
      const stateRoot = resolveStateRoot({ profileDir: profileDirectory(ctx) })
      routineService = {
        bots: openBotStore(stateRoot),
        routines: openRoutineStore(stateRoot),
        bridge: cloudHostRuntime === undefined ? null : createCloudRoutineBridge({
          stateRoot,
          getTools: () => ctx.get?.('tools'),
          getMachine: () => cloudHostRuntime.ensureMachine({ start: false }),
        }),
        logger: ctx.logger,
      }
    }
    return routineService
  }

  const hasStateRoot = profileDirectory(ctx) !== undefined
    || (typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME.trim() !== '')

  ctx.inject(['webServer'], (child) => {
    webServer = child.webServer
    child.effect(() =>
      child.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        async handler(req, res) {
          const url = new URL(req.url ?? '/', 'http://rayrun-bots.local')
          if (url.pathname !== ROUTE && !url.pathname.startsWith(`${ROUTE}/`)) {
            sendError(res, 404, ERROR_CODES.internal, 'Unknown Rayrun Bot route.')
            return
          }

          const method = String(req.method ?? 'GET').toUpperCase()
          try {
            if (method === 'POST' && !sameOrigin(req, child.webServer)) {
              sendError(res, 403, ERROR_CODES.internal, 'Cross-origin request refused.')
              return
            }

            if (method === 'GET') {
              const action = url.searchParams.get('action') ?? 'health'
              if (action === 'health') {
                sendJson(res, 200, hostHealth())
                return
              }
              sendError(res, 404, ERROR_CODES.internal, `Unknown action: ${action}`)
              return
            }

            if (method === 'POST') {
              const payload = await readJsonBody(req, MAX_BODY)
              if (payload?.action === 'health') {
                sendJson(res, 200, hostHealth())
                return
              }
              if (payload?.action === 'update.check') {
                try {
                  const result = await checkForUpdate({ current: VERSION })
                  const command = result.updateAvailable
                    ? updateCommand({ latest: result.latest })
                    : null
                  sendJson(res, 200, { ok: true, ...result, command })
                } catch (error) {
                  sendError(res, 502, ERROR_CODES.internal, `Could not check npm: ${String(error?.message ?? error).slice(0, 200)}`)
                }
                return
              }
              if (typeof payload?.action === 'string' && payload.action.startsWith('bots.')) {
                try {
                  sendJson(res, 200, botAction(payload.action, payload, ctx, computerFor))
                } catch (error) {
                  sendActionError(res, error)
                }
                return
              }
              if (typeof payload?.action === 'string' && payload.action.startsWith('session.')) {
                try {
                  sendJson(res, 200, sessionAction(payload.action, payload, sessions))
                } catch (error) {
                  sendActionError(res, error)
                }
                return
              }
              if (typeof payload?.action === 'string' && payload.action.startsWith('routines.')) {
                try {
                  sendJson(res, 200, await routineAction(payload.action, payload, routines()))
                } catch (error) {
                  sendActionError(res, error)
                }
                return
              }
              if (typeof payload?.action === 'string' && payload.action.startsWith('approvals.')) {
                try {
                  if (payload.action === 'approvals.propose' && req.headers?.origin) {
                    sendError(res, 403, ERROR_CODES.approvalInvalid, 'Proposals are accepted only from the local host.')
                    return
                  }
                  sendJson(res, 200, await approvalAction(payload.action, payload, approvals()))
                } catch (error) {
                  sendActionError(res, error)
                }
                return
              }
              sendError(res, 404, ERROR_CODES.internal, 'Unknown action.')
              return
            }

            sendError(res, 405, ERROR_CODES.internal, 'Only GET and POST are allowed.')
          } catch (error) {
            const status = Number(error?.status) || 500
            sendError(res, status, ERROR_CODES.internal, String(error?.message ?? error))
          }
        },
      }),
    )
    if (hasStateRoot) {
      child.effect(() => {
        const scheduler = routineScheduler()
        scheduler.start()
        return () => scheduler.stop()
      })
    }
  })

  // Resume persisted detached tasks without waiting for the page to issue the
  // first session RPC. Wait for the tool registry too: the cloud adapter needs
  // `rayrun_files` before it can report itself available.
  if (hasStateRoot) {
    ctx.inject(['webServer', 'tools'], (child) => {
      child.effect(() => {
        let capable = false
        try {
          capable = runtime.detached === true && runtime.available === true
        } catch {
          capable = false
        }
        if (!capable) return () => {}
        try {
          sessions()
        } catch (error) {
          try {
            ctx.logger?.warn?.(`dsh-rayrun-bots: session recovery failed: ${String(error?.message ?? error).slice(0, 200)}`)
          } catch {
            // Logging must not break plugin startup.
          }
        }
        return () => {
          if (sessionService !== undefined) sessionService.runner.close()
        }
      })
    })
  }
}
