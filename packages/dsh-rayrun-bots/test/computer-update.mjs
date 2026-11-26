/**
 * Shared computer replacement checks (fake Rayrun RPC and tools).
 *
 *   node test/computer-update.mjs
 */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { BOT_IMAGE, openComputerUpdater } from '../lib/computer-update.js'
import { ERROR_CODES } from '../lib/errors.js'

const checks = []
const check = (name, fn) => checks.push({ name, fn })

function setup({ failCreate = false, failExtract = false, noCredential = false, noImage = false, boundCredential = 'dsh-model-test' } = {}) {
  const machines = [{
    id: 'old-id',
    name: 'bot-box',
    status: 'Running',
    agent: BOT_IMAGE,
    cpu_cores: 2,
    memory_mb: 2048,
    workspace_mb: 32768,
    remote_desktop: true,
    max_lifetime_seconds: 7200,
    credentials: boundCredential ? [boundCredential] : [],
  }]
  const actions = []
  const execs = []
  const files = []
  const rpc = {
    async call(action, payload = {}) {
      if (action === 'overview') {
        return {
          ok: true,
          connection: { configured: true },
          machines: machines.filter((machine) => machine.status !== 'Terminated'),
          agents: noImage ? [{ ref: 'other-image@1' }] : [{ ref: BOT_IMAGE }, { ref: 'deepseek-harness@2' }],
          defaults: { agent: 'deepseek-harness@2' },
        }
      }
      if (action === 'credentials.list') {
        return { ok: true, credentials: noCredential ? [] : [{ name: 'unrelated-token' }, { name: 'dsh-model-test' }] }
      }
      if (action === 'machine.action') {
        actions.push({ action, payload })
        const machine = machines.find((item) => item.id === payload.id)
        if (!machine) throw new Error('machine not found')
        if (payload.verb === 'rename') machine.name = payload.name
        if (payload.verb === 'stop') machine.status = 'Stopped'
        return { ok: true, machine }
      }
      if (action === 'machine.create') {
        if (failCreate) throw new Error('create failed')
        const created = {
          id: 'new-id',
          name: payload.name,
          status: 'Running',
          agent: payload.agent,
          cpu_cores: payload.cpu_cores,
          memory_mb: payload.memory_mb,
          workspace_mb: payload.workspace_mb,
          remote_desktop: payload.remote_desktop,
          credentials: payload.credentials,
          egress_allow: payload.egress_allow,
        }
        machines.push(created)
        return { ok: true, machine: created }
      }
      if (action === 'machine.get') {
        const machine = machines.find((item) => item.id === payload.id)
        return { ok: true, machine }
      }
      throw new Error(`unexpected rpc action ${action}`)
    },
  }
  const tools = {
    get(name) {
      if (name === 'rayrun_exec') {
        return {
          async execute(args) {
            execs.push(args)
            if (failExtract && args.command.includes('tar -xzf')) {
              return { exit_code: 1, stdout: '', stderr: 'extract failed', timed_out: false }
            }
            return { exit_code: 0, stdout: '', stderr: '', timed_out: false }
          },
        }
      }
      if (name === 'rayrun_files') {
        return {
          async execute(args) {
            files.push(args)
            if (args.action === 'download') writeFileSync(args.local_path, 'fake-tar')
            return 'ok'
          },
        }
      }
      return undefined
    },
  }
  return { rpc, tools, machines, actions, execs, files }
}

check('replaces the computer, copies preserved paths and stops the old one', async () => {
  const { rpc, tools, machines, actions, execs, files } = setup()
  const updater = openComputerUpdater({ rpc, getTools: () => tools })
  const result = await updater.update({
    machine: 'bot-box',
    confirmed: true,
  })
  assert.equal(result.updated, true)
  assert.equal(result.machine.name, 'bot-box')
  assert.equal(result.machine.image, BOT_IMAGE)
  assert.equal(result.credential, 'dsh-model-test')
  assert.match(result.previous.name, /^bot-box-pre-update-/)
  assert.equal(machines.find((machine) => machine.id === 'old-id').status, 'Stopped')
  assert.equal(machines.find((machine) => machine.id === 'old-id').name, result.previous.name)
  assert.equal(machines.find((machine) => machine.id === 'new-id').name, 'bot-box')
  assert.equal(machines.find((machine) => machine.id === 'new-id').agent, BOT_IMAGE)
  assert.deepEqual(machines.find((machine) => machine.id === 'new-id').credentials, ['dsh-model-test'])
  assert.deepEqual(machines.find((machine) => machine.id === 'new-id').egress_allow, ['api.deepseek.com'])
  assert.equal(actions.filter((entry) => entry.payload.verb === 'rename').length, 1)
  assert.equal(actions.filter((entry) => entry.payload.verb === 'stop').length, 1)
  assert.equal(execs.some((entry) => entry.command.includes('tar -czf')), true)
  assert.equal(execs.some((entry) => entry.command.includes('mkdir -p /workspace/.dsh')), true)
  assert.equal(execs.some((entry) => entry.command.includes('test -s /workspace/.dsh/rayrun-update-')), true)
  assert.equal(execs.some((entry) => entry.command.includes('tar -xzf')), true)
  assert.equal(files.filter((entry) => entry.action === 'download').length, 1)
  assert.equal(files.filter((entry) => entry.action === 'upload').length, 1)
  assert.match(execs.find((entry) => entry.command.includes('tar -czf')).command, /root\/\.config/)
  assert.equal(JSON.stringify(result).includes('fake-tar'), false)
})

check('requires explicit confirmation before any RPC or tool call', async () => {
  const { rpc, tools, actions } = setup()
  const updater = openComputerUpdater({ rpc, getTools: () => tools })
  await assert.rejects(updater.update({
    machine: 'bot-box',
    confirmed: false,
  }), (error) => error.code === ERROR_CODES.computerUpdate)
  assert.deepEqual(actions, [])
})

check('uses the account model credential when the current computer has none', async () => {
  const { rpc, tools, machines, actions } = setup({ boundCredential: '' })
  const updater = openComputerUpdater({ rpc, getTools: () => tools })
  const result = await updater.update({ machine: 'bot-box', confirmed: true })
  assert.equal(result.credential, 'dsh-model-test')
  assert.deepEqual(machines.find((machine) => machine.id === 'new-id').credentials, ['dsh-model-test'])
  assert.equal(actions.filter((entry) => entry.payload.verb === 'rename').length, 1)
})

check('rejects the required image when the account does not offer it before touching the computer', async () => {
  const { rpc, tools, actions } = setup({ noImage: true })
  const updater = openComputerUpdater({ rpc, getTools: () => tools })
  await assert.rejects(updater.update({
    machine: 'bot-box',
    confirmed: true,
  }), (error) => error.code === ERROR_CODES.computerUpdate && error.message.includes(BOT_IMAGE))
  assert.deepEqual(actions, [])
})

check('rejects a missing credential before touching the computer', async () => {
  const { rpc, tools, actions } = setup({ noCredential: true })
  const updater = openComputerUpdater({ rpc, getTools: () => tools })
  await assert.rejects(updater.update({
    machine: 'bot-box',
    confirmed: true,
  }), (error) => error.code === ERROR_CODES.computerUpdate)
  assert.deepEqual(actions, [])
})

check('restores the old name and stops the replacement when extraction fails', async () => {
  const { rpc, tools, machines, actions } = setup({ failExtract: true })
  const updater = openComputerUpdater({ rpc, getTools: () => tools })
  await assert.rejects(updater.update({
    machine: 'bot-box',
    confirmed: true,
  }), (error) => error.code === ERROR_CODES.computerUpdate)
  assert.equal(machines.find((machine) => machine.id === 'old-id').name, 'bot-box')
  assert.equal(machines.find((machine) => machine.id === 'new-id').name.startsWith('bot-box-failed-update-'), true)
  assert.equal(machines.find((machine) => machine.id === 'new-id').status, 'Stopped')
  assert.equal(actions.some((entry) => entry.payload.id === 'old-id' && entry.payload.verb === 'stop'), false)
})

check('restores the old name when creating the replacement fails', async () => {
  const { rpc, tools, machines } = setup({ failCreate: true })
  const updater = openComputerUpdater({ rpc, getTools: () => tools })
  await assert.rejects(updater.update({
    machine: 'bot-box',
    confirmed: true,
  }), (error) => error.code === ERROR_CODES.computerUpdate)
  assert.equal(machines.find((machine) => machine.id === 'old-id').name, 'bot-box')
  assert.equal(machines.some((machine) => machine.id === 'new-id'), false)
})

let failed = 0
for (const { name, fn } of checks) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${name}`)
    console.log(`     ${error?.stack ?? error}`)
  }
}
console.log(`${checks.length - failed}/${checks.length} computer update checks passed`)
if (failed > 0) process.exitCode = 1
