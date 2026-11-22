/**
 * Cloud host DSH agent checks (plain Node, fake dsh executable).
 *
 *   node tools/cloud-host-poc/test/dsh-agent.mjs
 */
import assert from 'node:assert/strict'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDshAgent } from '../lib/dsh-agent.mjs'

const roots = []
const checks = []
const check = (name, fn) => checks.push({ name, fn })

function setup({ fail = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-dsh-agent-'))
  roots.push(root)
  const log = path.join(root, 'invocations.jsonl')
  const fake = path.join(root, 'fake-dsh.mjs')
  writeFileSync(fake, `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const args = process.argv.slice(2)
const profileIndex = args.indexOf('--profile')
const profile = profileIndex >= 0 ? args[profileIndex + 1] : 'bot'
const home = process.env.DSH_HOME
appendFileSync(process.env.FAKE_DSH_LOG, JSON.stringify({ args, dshHome: home, home: process.env.HOME }) + '\\n')
if (args.includes('--dump-config')) {
  const dir = path.join(home, 'profiles', profile)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), '{"name":"fake-profile"}\\n')
  writeFileSync(path.join(dir, 'cordis.patch.yml'), '[]\\n')
  process.exit(0)
}
if (process.env.FAKE_DSH_FAIL === '1') {
  process.stderr.write('fake failure Bearer supersecret and sk-abcdefghijklmnop\\n')
  process.exit(1)
}
const text = args[args.length - 1]
const sessionId = args.includes('--session-id') ? args[args.indexOf('--session-id') + 1] : 'session-fake-1'
process.stdout.write(JSON.stringify({ type: 'session', sessionId }) + '\\n')
process.stdout.write(JSON.stringify({ type: 'text', text: 'FAKE:' + text }) + '\\n')
process.stdout.write(JSON.stringify({ type: 'status', phase: 'turn_end', usage: { totalTokens: 7 } }) + '\\n')
process.stdout.write(JSON.stringify({ type: 'final', text: 'FAKE:' + text }) + '\\n')
`, { mode: 0o755 })
  chmodSync(fake, 0o755)
  const agent = createDshAgent({
    command: fake,
    dshHome: path.join(root, 'dsh'),
    home: path.join(root, 'home'),
    profile: 'bot',
    cwd: root,
    env: { FAKE_DSH_LOG: log, ...(fail ? { FAKE_DSH_FAIL: '1' } : {}) },
  })
  return { root, log, agent }
}

function invocations(log) {
  return readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

check('creates the profile from the headless template and writes the policy patch', async () => {
  const { root, agent } = setup()
  await agent.ensureProfile()
  const profile = path.join(root, 'dsh', 'profiles', 'bot')
  assert.ok(existsSync(path.join(profile, 'package.json')))
  const patch = readFileSync(path.join(profile, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /policy: never/)
  assert.match(patch, /danger-full-access/)
})

check('runs the first task without a session id and returns the final message', async () => {
  const { root, log, agent } = setup()
  const result = await agent.run({ text: 'first task' })
  assert.deepEqual(result.text, 'FAKE:first task')
  assert.equal(result.sessionId, 'session-fake-1')
  const calls = invocations(log)
  const run = calls[calls.length - 1]
  assert.deepEqual(run.args.slice(-2), ['--json', 'first task'])
  assert.equal(run.args.includes('--session-id'), false)
  assert.equal(run.dshHome, path.join(root, 'dsh'))
})

check('passes the persisted session id on the next task', async () => {
  const { log, agent } = setup()
  await agent.run({ text: 'first task' })
  await agent.run({ text: 'second task', sessionId: 'session-fake-1' })
  const run = invocations(log).at(-1)
  assert.deepEqual(run.args.slice(-4), ['--json', '--session-id', 'session-fake-1', 'second task'])
  assert.equal(run.args.includes('--session-id'), true)
})

check('a failing dsh rejects with a redacted error', async () => {
  const { agent } = setup({ fail: true })
  await assert.rejects(agent.run({ text: 'fail' }), (error) => {
    assert.match(error.message, /\[redacted\]/)
    assert.doesNotMatch(error.message, /supersecret/)
    assert.doesNotMatch(error.message, /sk-abcdefghijklmnop/)
    return true
  })
})

let passed = 0
let failed = 0
try {
  for (const { name, fn } of checks) {
    try {
      await fn()
      passed += 1
      console.log(`ok   ${name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${name}\n     ${String(error?.stack ?? error).split('\n').slice(0, 5).join('\n     ')}`)
    }
  }
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
console.log(`${passed}/${checks.length} DSH agent checks passed`)
if (failed > 0) process.exit(1)
