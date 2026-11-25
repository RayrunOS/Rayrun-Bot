#!/usr/bin/env node
/**
 * Deploy dsh-rayrun-bots to a Rayrun sandbox.
 *
 * The CI workflow calls this after the checks on a main-branch push. It uses
 * the Rayrun API to reuse or create a disposable sandbox, ensure it is running,
 * upload the packed plugin, install it into the sandbox's DSH web profile, and
 * restart `dsh web` on the public 6080 ingress. The tokenized DSH URL is
 * written to `/workspace/dsh-web-url.txt` (mode 600) and is never printed; the
 * Rayrun token stays in the environment and never reaches the sandbox.
 *
 * The sandbox is stopped after the check, never destroyed. A maintainer can
 * start it again or destroy it explicitly.
 *
 * Required environment:
 *   RAYRUN_TOKEN        Rayrun API token (GitHub Actions secret)
 *   PLUGIN_TARBALL      path to the npm-packed plugin
 * Optional:
 *   RAYRUN_API_URL      default https://api.rayrunos.com/v1
 *   RAYRUN_DEPLOY_SANDBOX_NAME  default dsh-ci-deploy
 *   RAYRUN_DEPLOY_AGENT         default deepseek-harness@1
 *   RAYRUN_DEPLOY_CPU_CORES     default 2
 *   RAYRUN_DEPLOY_MEMORY_MB     default 4096
 *   DEPLOY_LABEL        tarball suffix; the commit sha in CI
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const API_BASE = (process.env.RAYRUN_API_URL || 'https://api.rayrunos.com/v1').replace(/\/+$/, '')
const TOKEN = String(process.env.RAYRUN_TOKEN || '').trim()
const SANDBOX_NAME = String(process.env.RAYRUN_DEPLOY_SANDBOX_NAME || 'dsh-ci-deploy')
  .trim()
  .replace(/[^A-Za-z0-9._-]/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 40) || 'dsh-ci-deploy'
const SANDBOX_AGENT = String(process.env.RAYRUN_DEPLOY_AGENT || 'deepseek-harness@1').trim()
const CPU_CORES = Math.max(1, Number(process.env.RAYRUN_DEPLOY_CPU_CORES) || 2)
const MEMORY_MB = Math.max(2048, Number(process.env.RAYRUN_DEPLOY_MEMORY_MB) || 4096)
const TARBALL = String(process.env.PLUGIN_TARBALL || '').trim()
const LABEL = String(process.env.DEPLOY_LABEL || `local-${Date.now()}`)
  .toLowerCase()
  .replace(/[^a-z0-9._-]/g, '')
  .slice(0, 24) || 'local'
const TARBALL_NAME = `dsh-rayrun-bots-${LABEL}.tgz`
let SANDBOX_ID = ''

function fail(message) {
  console.error(`deploy failed: ${message}`)
  process.exit(1)
}

if (!TOKEN) fail('RAYRUN_TOKEN is required')
if (!/^[A-Za-z0-9._-]{1,40}$/.test(SANDBOX_NAME)) fail('RAYRUN_DEPLOY_SANDBOX_NAME is not a valid sandbox name')
if (!/^[A-Za-z0-9._@-]{1,64}$/.test(SANDBOX_AGENT)) fail('RAYRUN_DEPLOY_AGENT is not a valid image name')
if (!TARBALL) fail('PLUGIN_TARBALL is required')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function request(method, path, { json, body, contentType, timeoutMs = 120000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        ...(json ? { 'content-type': 'application/json' } : {}),
        ...(contentType ? { 'content-type': contentType } : {}),
      },
      body: json ? JSON.stringify(json) : body,
      signal: controller.signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`${method} ${path} returned ${response.status}: ${text.slice(0, 300)}`)
    }
    return { status: response.status, text }
  } finally {
    clearTimeout(timer)
  }
}

async function jsonRequest(method, path, options) {
  const result = await request(method, path, options)
  if (!result.text) return undefined
  return JSON.parse(result.text)
}

const getMachine = () => jsonRequest('GET', `/sandboxes/${SANDBOX_ID}`)

async function waitForState(want, seconds) {
  const deadline = Date.now() + seconds * 1000
  let last = ''
  while (Date.now() < deadline) {
    const machine = await getMachine()
    last = String(machine.status || '')
    if (last === want) return machine
    if (last === 'Failed' || last === 'Terminated') {
      throw new Error(`sandbox entered ${last}`)
    }
    await sleep(3000)
  }
  throw new Error(`sandbox did not reach ${want} within ${seconds}s (last: ${last})`)
}

async function listSandboxes() {
  const body = await jsonRequest('GET', '/sandboxes')
  const list = Array.isArray(body)
    ? body
    : Array.isArray(body?.sandboxes)
      ? body.sandboxes
      : Array.isArray(body?.machines)
        ? body.machines
        : Array.isArray(body?.items) ? body.items : null
  if (!list) throw new Error('GET /sandboxes did not return a sandbox list')
  return list
}

function machineFrom(body) {
  return body?.sandbox ?? body?.machine ?? body
}

async function createSandbox(name) {
  const body = await jsonRequest('POST', '/sandboxes', {
    json: {
      name,
      agent: SANDBOX_AGENT,
      cpu_cores: CPU_CORES,
      memory_mb: MEMORY_MB,
      remote_desktop: true,
      max_lifetime_seconds: 7200,
      egress: { allow: ['registry.npmjs.org'] },
    },
  })
  const created = machineFrom(body)
  if (!created?.id) throw new Error('POST /sandboxes returned no sandbox id')
  SANDBOX_ID = String(created.id)
  console.log(`created sandbox ${created.name || name} (${SANDBOX_ID})`)
}

async function ensureSandbox() {
  const sandboxes = await listSandboxes()
  const existing = sandboxes.find((item) => (
    (item?.name === SANDBOX_NAME || item?.name?.startsWith(`${SANDBOX_NAME}-`))
    && item.status !== 'Terminated'
  ))
  if (existing?.id) {
    SANDBOX_ID = String(existing.id)
    console.log(`reusing sandbox ${existing.name || SANDBOX_NAME} (${SANDBOX_ID}): ${existing.status}`)
  } else {
    try {
      await createSandbox(SANDBOX_NAME)
    } catch (error) {
      if (!/\b409\b|already|exists|duplicate/i.test(String(error?.message ?? error))) throw error
      await createSandbox(`${SANDBOX_NAME}-${LABEL.slice(0, 8)}`)
    }
  }
  return ensureRunning()
}

async function ensureRunning() {
  let machine = await getMachine()
  console.log(`sandbox ${machine.name || SANDBOX_ID}: ${machine.status}`)
  if (machine.status === 'Running') return machine
  if (machine.status === 'Stopped') {
    await request('POST', `/sandboxes/${SANDBOX_ID}/start`)
  } else if (machine.status === 'Paused') {
    await request('POST', `/sandboxes/${SANDBOX_ID}/resume`)
  } else if (machine.status === 'Stopping') {
    await waitForState('Stopped', 60)
    await request('POST', `/sandboxes/${SANDBOX_ID}/start`)
  } else if (machine.status !== 'Starting') {
    throw new Error(`sandbox is ${machine.status}; it cannot be started automatically`)
  }
  machine = await waitForState('Running', 180)
  console.log(`sandbox ${machine.name || SANDBOX_ID}: Running`)
  return machine
}

async function stopSandbox() {
  if (!SANDBOX_ID) return
  const machine = await getMachine()
  const status = String(machine.status || '')
  if (status === 'Stopping') {
    await waitForState('Stopped', 120)
    console.log(`sandbox ${machine.name || SANDBOX_ID}: Stopped (not destroyed)`)
    return
  }
  if (status === 'Running' || status === 'Paused' || status === 'Starting') {
    await request('POST', `/sandboxes/${SANDBOX_ID}/stop`)
    await waitForState('Stopped', 120)
    console.log(`sandbox ${machine.name || SANDBOX_ID}: Stopped (not destroyed)`)
    return
  }
  console.log(`sandbox ${machine.name || SANDBOX_ID}: ${status} (not destroyed)`)
}

async function publicIngress(machine) {
  let entry = (machine.ingress ?? []).find(
    (item) => Number(item?.port) === 6080 && typeof item?.url === 'string' && item.url,
  )
  if (!entry) {
    await request('PUT', `/sandboxes/${SANDBOX_ID}/ingress/6080`)
    machine = await getMachine()
    entry = (machine.ingress ?? []).find(
      (item) => Number(item?.port) === 6080 && typeof item?.url === 'string' && item.url,
    )
  }
  if (!entry) throw new Error('sandbox has no public 6080 ingress')
  return entry.url.replace(/\/+$/, '')
}

async function deploy() {
  let machine = await ensureSandbox()
  const ip = String(machine.ip || '')
  if (!ip) throw new Error('sandbox has no ip')
  const ingressUrl = await publicIngress(machine)
  const ingressHost = new URL(ingressUrl).host

  const bytes = readFileSync(TARBALL)
  await request('PUT', `/sandboxes/${SANDBOX_ID}/files/pkgs/${encodeURIComponent(TARBALL_NAME)}`, {
    body: bytes,
    contentType: 'application/octet-stream',
    timeoutMs: 300000,
  })
  console.log(`uploaded ${TARBALL_NAME} (${bytes.length} bytes)`)

  const installPath = `/workspace/pkgs/${TARBALL_NAME}`
  const script = [
    'set -eu',
    'umask 077',
    'mkdir -p "$HOME"',
    'export PATH="$HOME/.local/bin:$PATH"',
    'if ! command -v pnpm >/dev/null 2>&1; then',
    '  npm_config_registry=https://registry.npmjs.org npm install --global --prefix "$HOME/.local" pnpm@10',
    'fi',
    `dsh plugin --profile web add '${installPath}'`,
    'rayrun-desktop stop >/dev/null 2>&1 || true',
    '# Stop only the process listening on 6080; never match this script command line.',
    "old_pid=$(ss -ltnp 2>/dev/null | sed -n 's/.*:6080 .*pid=\\([0-9][0-9]*\\).*/\\1/p' | head -1)",
    'if [ -n "$old_pid" ]; then kill "$old_pid" 2>/dev/null || true; fi',
    "for pid in $(ps -eo pid,args | grep '[n]ode /usr/local/bin/dsh web' | awk '{print $1}'); do kill \"$pid\" 2>/dev/null || true; done",
    'for i in $(seq 1 10); do',
    "  if ! ss -ltn 2>/dev/null | grep -q ':6080 '; then break; fi",
    '  sleep 1',
    'done',
    'cd /workspace',
    `nohup dsh web --no-open --host '${ip}' --port 6080 --trusted-host '${ingressHost}' --public-url '${ingressUrl}' > /workspace/dsh-web.log 2>&1 &`,
    'echo $! > /workspace/dsh-web.pid',
    'for i in $(seq 1 30); do',
    "  if grep -q 'token=' /workspace/dsh-web.log 2>/dev/null; then break; fi",
    '  sleep 1',
    'done',
    "url=$(grep -oE 'https://[^[:space:]]+token=[^[:space:]]+' /workspace/dsh-web.log | tail -1)",
    'chmod 600 /workspace/dsh-web.log 2>/dev/null || true',
    'if [ -z "$url" ]; then echo "dsh web did not print a tokenized URL" >&2; exit 1; fi',
    "printf '%s\\n' \"$url\" > /workspace/dsh-web-url.txt",
    'chmod 600 /workspace/dsh-web-url.txt',
    "if command -v ss >/dev/null 2>&1; then ss -ltn 2>/dev/null | grep -q ':6080 ' || { echo 'port 6080 is not listening' >&2; exit 1; }; fi",
    'echo "dsh web restarted; URL stored at /workspace/dsh-web-url.txt"',
  ].join('\n')

  const result = await jsonRequest('POST', `/sandboxes/${SANDBOX_ID}/exec`, {
    json: { command: script, timeout_seconds: 300 },
    timeoutMs: 360000,
  })
  if (Number(result.exit_code) !== 0) {
    const detail = String(result.stderr || result.stdout || '').slice(0, 800)
    throw new Error(`sandbox deploy command failed (exit ${result.exit_code}): ${detail || 'no output'}`)
  }

  const urlFile = await request('GET', `/sandboxes/${SANDBOX_ID}/files/dsh-web-url.txt`, { timeoutMs: 60000 })
  const deployedUrl = urlFile.text.trim()
  if (!/^https:\/\/[^\s]+\?token=[^\s]+$/.test(deployedUrl)) {
    throw new Error('deployed URL file is missing or malformed')
  }
  try {
    const response = await fetch(deployedUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    })
    if (response.status !== 303) throw new Error('unexpected status')
  } catch {
    throw new Error('public ingress did not answer with the expected token redirect')
  }

  machine = await getMachine()
  console.log(`deploy ok: ${machine.name || SANDBOX_ID} (${machine.status})`)
  console.log(`installed ${basename(TARBALL)} as ${installPath}`)
  console.log(`public ingress: ${ingressUrl}`)
  console.log('the tokenized DSH URL is in /workspace/dsh-web-url.txt (mode 600)')
}

async function main() {
  let failure = null
  try {
    await deploy()
  } catch (error) {
    failure = error
  }
  if (SANDBOX_ID) {
    try {
      await stopSandbox()
    } catch (error) {
      if (failure) console.error(`sandbox stop failed: ${String(error?.message ?? error)}`)
      else failure = new Error(`sandbox stop failed: ${String(error?.message ?? error)}`)
    }
  }
  if (failure) throw failure
}

main().catch((error) => fail(error?.message ?? 'unknown error'))
