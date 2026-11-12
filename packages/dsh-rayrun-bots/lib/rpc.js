/**
 * Same-origin RPC helpers for the host half.
 *
 * Every response is JSON, never cached, and carries no credentials. Routes
 * return `{ ok: true, ...data }` or `{ ok: false, error: { code, message } }`.
 */

/** Send a JSON response and close the request. */
export function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

/** Send the standard error envelope. */
export function sendError(res, status, code, message) {
  sendJson(res, status, { ok: false, error: { code, message, status } })
}

/** Read and parse a JSON request body, capped in size. */
export async function readJsonBody(req, limit) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > limit) {
      const error = new Error('Request body too large.')
      error.status = 413
      throw error
    }
  }
  if (!body) return {}
  try {
    return JSON.parse(body)
  } catch {
    const error = new Error('Request body is not valid JSON.')
    error.status = 400
    throw error
  }
}
