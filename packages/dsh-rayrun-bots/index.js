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
import { openApprovalStore } from './lib/approvals.js'
import { openBotStore } from './lib/bots.js'
import { createCloudHostRuntime } from './lib/cloud-host-runtime.js'
import { checkDependency, supportsDetached, supportsRuntimeRpc } from './lib/dependency.js'
import { ERROR_CODES } from './lib/errors.js'
import { resolveStateRoot } from './lib/local-store.js'
import { createRayrunDetachedRuntime } from './lib/rayrun-detached-runtime.js'
import { createRayrunAgentRuntime } from './lib/rayrun-runtime.js'
import { readJsonBody, sendError, sendJson } from './lib/rpc.js'
import { validateRuntime } from './lib/runtime.js'
import { openSessionRunner } from './lib/sessions.js'

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
function botAction(action, payload, ctx) {
  const store = openBotStore(resolveStateRoot({ profileDir: profileDirectory(ctx) }))
  switch (action) {
    case 'bots.list':
      return { ok: true, bots: store.list() }
    case 'bots.get':
      return { ok: true, bot: store.get(payload.id) }
    case 'bots.create': {
      const input = { ...payload }
      delete input.action
      return { ok: true, bot: store.create(input) }
    }
    case 'bots.update':
      return { ok: true, bot: store.update(payload.id, payload.patch) }
    case 'bots.delete':
      return { ok: true, deleted: store.remove(payload.id) }
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
  [ERROR_CODES.sessionInvalid, 400],
  [ERROR_CODES.runtimeUnavailable, 503],
  [ERROR_CODES.queueFull, 429],
  [ERROR_CODES.hostDown, 503],
  [ERROR_CODES.approvalInvalid, 400],
  [ERROR_CODES.approvalExpired, 410],
  [ERROR_CODES.approvalReplay, 409],
  [ERROR_CODES.approvalUnknown, 404],
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

/** Run one approval action. Decisions are recorded; execution stays closed. */
function approvalAction(action, payload, ctx) {
  const stateRoot = resolveStateRoot({ profileDir: profileDirectory(ctx) })
  const bots = openBotStore(stateRoot)
  const bot = bots.get(payload.botId)
  const approvals = openApprovalStore(stateRoot)
  switch (action) {
    case 'approvals.list':
      return { ok: true, approvals: approvals.list(bot.id) }
    case 'approvals.get':
      return { ok: true, approval: approvals.get(bot.id, payload.id) }
    case 'approvals.decide':
      return { ok: true, ...approvals.decide(bot.id, payload.id, payload.decision) }
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
              if (typeof payload?.action === 'string' && payload.action.startsWith('bots.')) {
                try {
                  sendJson(res, 200, botAction(payload.action, payload, ctx))
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
              if (typeof payload?.action === 'string' && payload.action.startsWith('approvals.')) {
                try {
                  sendJson(res, 200, approvalAction(payload.action, payload, ctx))
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
  })
}
