/**
 * Host half of the Rayrun Bot bundle.
 *
 * A1 skeleton: one same-origin RPC route with a health action. Bots, sessions,
 * approvals and the adapter to dsh-rayrun-computer are not built yet; the client
 * half shows a placeholder page until they are.
 *
 * POST is same-origin gated: a browser `Origin` that does not match the `Host`
 * the request reached is refused. GET is read-only. The route never touches
 * credentials: today it only reports that the bundle is loaded. When the bot
 * layer lands, the Rayrun token stays in the Harness vault on this side and
 * never reaches the page.
 */
import { readFileSync } from 'node:fs'
import { ERROR_CODES } from './lib/errors.js'
import { readJsonBody, sendError, sendJson } from './lib/rpc.js'

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

function health() {
  return { ok: true, plugin: name, version: VERSION, ready: false }
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

export function apply(ctx) {
  ctx.logger?.info?.(`dsh-rayrun-bots: host half loaded (${VERSION})`)

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
                sendJson(res, 200, health())
                return
              }
              sendError(res, 404, ERROR_CODES.internal, `Unknown action: ${action}`)
              return
            }

            if (method === 'POST') {
              const payload = await readJsonBody(req, MAX_BODY)
              if (payload?.action === 'health') {
                sendJson(res, 200, health())
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
