/**
 * Host half of the Rayrun Bot bundle.
 *
 * One same-origin RPC route: a health action and the persisted bot roster
 * (`bots.list/get/create/update/delete`). Sessions, approvals, the cloud
 * runtime and the adapter to dsh-rayrun-computer are not built yet. The client
 * half renders the v0.1 shell from in-memory preview data, reads the roster
 * when it has bots, and calls the GET health action for its host status.
 *
 * The health action also reports the installed `dsh-rayrun-computer` version
 * (ok / missing / incompatible / unknown) by reading the profile's package
 * metadata. POST is same-origin gated: a browser `Origin` that does not match
 * the `Host` the request reached is refused. GET is read-only. The route never
 * touches credentials: the Rayrun token stays in the Harness vault on this
 * side and never reaches the page.
 */
import { readFileSync } from 'node:fs'
import { openBotStore } from './lib/bots.js'
import { checkDependency } from './lib/dependency.js'
import { ERROR_CODES } from './lib/errors.js'
import { resolveStateRoot } from './lib/local-store.js'
import { readJsonBody, sendError, sendJson } from './lib/rpc.js'
import { createUnavailableRuntime, validateRuntime } from './lib/runtime.js'
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

function health(dependency) {
  return { ok: true, plugin: name, version: VERSION, ready: false, dependency }
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
        ...service.runner.history(bot.id, { after: payload.after, limit: payload.limit }),
      }
    default:
      return { ok: true, session: service.runner.status(bot.id) }
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
 * `options.runtime` is the test/bridge seam for a runtime adapter. The bundle
 * config is JSON and cannot supply `run`, so production uses the unavailable
 * default until the cloud bridge is wired.
 */
export function apply(ctx, options = {}) {
  ctx.logger?.info?.(`dsh-rayrun-bots: host half loaded (${VERSION})`)
  const runtime = validateRuntime(options.runtime ?? createUnavailableRuntime())
  const hostHealth = () => health(checkDependency(profileDirectory(ctx)))

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
