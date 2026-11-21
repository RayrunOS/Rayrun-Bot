#!/usr/bin/env node
/**
 * Print the tokenized DSH URL written by the Rayrun deploy job.
 *
 * This is a local helper, not part of the plugin runtime or CI. The URL
 * contains a DSH process token: treat it as a credential and do not share it.
 *
 * Usage:
 *   RAYRUN_TOKEN="$(cat <path-to-rayrun-token>)" \
 *   RAYRUN_SANDBOX_ID=<sandbox-id> \
 *   node tools/rayrun-deploy/fetch-url.mjs
 */
const API_BASE = (process.env.RAYRUN_API_URL || 'https://api.rayrunos.com/v1').replace(/\/+$/, '')
const TOKEN = String(process.env.RAYRUN_TOKEN || '').trim()
const SANDBOX_ID = String(process.env.RAYRUN_SANDBOX_ID || '').trim()

if (!TOKEN) {
  console.error('RAYRUN_TOKEN is required')
  process.exit(1)
}
if (!/^[0-9a-fA-F-]{8,64}$/.test(SANDBOX_ID)) {
  console.error('RAYRUN_SANDBOX_ID is required and must be a sandbox id')
  process.exit(1)
}

const response = await fetch(`${API_BASE}/sandboxes/${SANDBOX_ID}/files/dsh-web-url.txt`, {
  headers: { authorization: `Bearer ${TOKEN}` },
})
if (!response.ok) {
  console.error(`could not read /workspace/dsh-web-url.txt (HTTP ${response.status})`)
  process.exit(1)
}
const url = (await response.text()).trim()
if (!/^https:\/\/[^\s]+\?token=[^\s]+$/.test(url)) {
  console.error('the deployed URL file is empty or malformed')
  process.exit(1)
}
console.error('warning: this URL contains a DSH process token; do not share it')
console.log(url)
