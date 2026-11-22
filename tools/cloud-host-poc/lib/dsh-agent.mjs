/**
 * Headless DSH agent for the cloud bot host POC.
 *
 * The POC host runs one DSH process per task with `--json`. The first task
 * creates a session and returns its id; later tasks pass `--session-id`, so the
 * DSH session store under $DSH_HOME carries the conversation. The profile is
 * created from the shipped `headless` template if it is absent; it never
 * rewrites an existing profile patch.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PROFILE_PATCH = `# Written by the cloud bot host POC. Approval is never interactive here.
- id: sandbox-policy
  name: '@deepseek-ai/dsh-sandbox-policy'
  config:
    mode: danger-full-access
    workspaceRoot: !!js process.cwd()
- id: approval
  name: '@deepseek-ai/dsh-user-approval'
  config:
    policy: never
`
const SECRET = /(Bearer\s+)\S+|(sk-)[A-Za-z0-9_-]{8,}|((?:RAYRUN_TOKEN|DEEPSEEK_API_KEY|DEEPSEEK_KEY)\s*[=:]\s*)\S+/gi

function redact(value) {
  return String(value ?? '').replace(SECRET, (_match, bearer, openai, assignment) => {
    if (bearer) return `${bearer}[redacted]`
    if (openai) return '[redacted]'
    return `${assignment}[redacted]`
  }).slice(0, 400)
}

/**
 * @param {{
 *   dshHome: string,
 *   home: string,
 *   profile?: string,
 *   cwd?: string,
 *   command?: string,
 *   timeoutMs?: number,
 *   env?: Record<string, string>,
 * }} options
 */
export function createDshAgent({
  dshHome,
  home,
  profile = 'bot',
  cwd = '/workspace',
  command = 'dsh',
  timeoutMs = 300_000,
  env = {},
} = {}) {
  if (typeof dshHome !== 'string' || dshHome.trim() === '') throw new Error('dshHome is required')
  if (typeof home !== 'string' || home.trim() === '') throw new Error('home is required')
  const profileDir = path.join(dshHome, 'profiles', profile)
  const baseEnv = { ...process.env, DSH_HOME: dshHome, HOME: home, ...env }
  let profileReady = null

  function execDsh(args, timeout = timeoutMs) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env: baseEnv, stdio: ['ignore', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        finish(reject, new Error(`dsh timed out after ${timeout}ms`))
      }, timeout)
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.on('error', (error) => finish(reject, new Error(`dsh could not start: ${redact(error.message)}`)))
      child.on('close', (code) => {
        if (code === 0) finish(resolve, { stdout, stderr })
        else finish(reject, new Error(`dsh exited ${code}: ${redact(stderr || stdout)}`))
      })
    })
  }

  function ensureProfile() {
    if (profileReady !== null) return profileReady
    profileReady = (async () => {
      const manifest = path.join(profileDir, 'package.json')
      if (!existsSync(manifest)) {
        await execDsh(['--profile', profile, '--from-default-profile', 'headless', '--dump-config'], 60_000)
      }
      const patch = path.join(profileDir, 'cordis.patch.yml')
      const current = existsSync(patch) ? readFileSync(patch, 'utf8').trim() : ''
      if (current === '' || current === '[]') writeFileSync(patch, PROFILE_PATCH, { mode: 0o600 })
      return profileDir
    })()
    return profileReady
  }

  async function run({ text, sessionId } = {}) {
    if (typeof text !== 'string' || text.trim() === '') throw new Error('text is required')
    await ensureProfile()
    const args = ['--profile', profile, '--json']
    if (typeof sessionId === 'string' && sessionId !== '') args.push('--session-id', sessionId)
    args.push(text)
    const { stdout, stderr } = await execDsh(args)
    const events = []
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event && typeof event === 'object') events.push(event)
      } catch {
        // DSH may write a non-JSON diagnostic to stdout; keep parsing.
      }
    }
    const session = events.find((event) => event.type === 'session' && typeof event.sessionId === 'string')
    let final = null
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].type === 'final' && typeof events[index].text === 'string') {
        final = events[index]
        break
      }
    }
    if (final === null) {
      throw new Error(`dsh produced no final message: ${redact(stderr || stdout)}`)
    }
    const usage = [...events].reverse().find((event) => event.usage)?.usage ?? null
    return {
      text: final.text,
      sessionId: session?.sessionId ?? sessionId ?? null,
      usage,
    }
  }

  return { ensureProfile, run, profileDir }
}
