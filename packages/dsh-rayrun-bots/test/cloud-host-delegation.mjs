/**
 * Cloud host primary -> worker delegation checks (plain Node, no framework).
 *
 *   node test/cloud-host-delegation.mjs
 */
import assert from 'node:assert/strict'
import {
  appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createCloudHost } from '../cloud-host/lib/host.mjs'

const checks = []
const roots = []
const check = (name, fn) => checks.push({ name, fn })

const PRIMARY = 'superagent'
const WORKER = 'weekly-watch'
const ROSTER = [{
  id: WORKER,
  name: 'Weekly Watch',
  label: 'Watches the weekly numbers',
  instructions: 'Check only the numbers.',
}]
const DELEGATION = { primary: true, roster: ROSTER }

function makeHost({ agent, delegationDeadlineMs } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-cloud-host-delegation-'))
  roots.push(root)
  const host = createCloudHost({
    root,
    logPath: path.join(root, 'host.log'),
    credentialPresent: true,
    machine: 'box',
    agent,
    ...(delegationDeadlineMs === undefined ? {} : { delegationDeadlineMs }),
  })
  host.recover()
  return { root, host }
}

function inbox(host, botId, name, task) {
  const paths = host.pathsFor(botId)
  mkdirSync(paths.inbox, { recursive: true })
  writeFileSync(path.join(paths.inbox, name), JSON.stringify(task))
}

function seedProcessing(host, botId, name, task, text) {
  const paths = host.pathsFor(botId)
  appendFileSync(paths.transcript, `${JSON.stringify({
    seq: 1, at: new Date().toISOString(), role: 'user', text, taskId: task.id,
  })}\n`)
  writeFileSync(path.join(paths.processing, name), JSON.stringify(task))
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function messages(host, botId) {
  const file = host.pathsFor(botId).transcript
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

function delegationRecords(host, botId) {
  const dir = host.pathsFor(botId).delegations
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJson(path.join(dir, name)))
}

const TASK = { id: 'task-primary-1', text: 'user request', delegation: DELEGATION }

check('a primary delegation runs the worker and writes only the final summary', async () => {
  const calls = []
  const { host } = makeHost({
    agent: async (input) => {
      calls.push(input)
      if (input.text.includes('You asked teammate')) return 'Final: the numbers are fine.'
      if (input.botId === WORKER) return 'Worker: all numbers match.'
      return 'I asked Weekly Watch.\n\n```rayrun-delegate\n{"bot":"weekly-watch","task":"check the numbers"}\n```'
    },
  })
  inbox(host, PRIMARY, '0001.json', TASK)
  const result = await host.processNext()
  assert.deepEqual(result, { botId: PRIMARY, taskId: TASK.id, reply: 'Final: the numbers are fine.' })

  const primaryMessages = messages(host, PRIMARY)
  assert.deepEqual(primaryMessages.map((message) => [message.role, message.text]), [
    ['user', 'user request'],
    ['bot', 'Final: the numbers are fine.'],
  ])

  const workerMessages = messages(host, WORKER)
  assert.deepEqual(workerMessages.map((message) => [message.role, message.text]), [
    ['user', 'check the numbers'],
    ['bot', 'Worker: all numbers match.'],
  ])
  assert.equal(workerMessages[0].taskId.startsWith('delegation-'), true)

  const outbox = readJson(path.join(host.pathsFor(PRIMARY).outbox, `${TASK.id}.json`))
  assert.equal(outbox.reply, 'Final: the numbers are fine.')
  const workerOutbox = readJson(path.join(host.pathsFor(WORKER).outbox, `${workerMessages[0].taskId}.json`))
  assert.equal(workerOutbox.reply, 'Worker: all numbers match.')

  const records = delegationRecords(host, PRIMARY)
  assert.equal(records.length, 1)
  assert.equal(records[0].state, 'done')
  assert.equal(records[0].phase, 'summary')
  assert.equal(records[0].targetBotId, WORKER)
  assert.equal(records[0].finalReply, 'Final: the numbers are fine.')
  assert.equal(records[0].reply, 'Worker: all numbers match.')

  // The first primary reply is an intermediate model turn, not user-visible.
  assert.equal(calls.filter((call) => call.botId === PRIMARY).length, 2)
  assert.equal(calls.filter((call) => call.botId === WORKER).length, 1)
  assert.equal(calls[1].approvalBotId, PRIMARY)
})

check('a primary reply without a delegate block is written directly', async () => {
  const calls = []
  const { host } = makeHost({ agent: async (input) => { calls.push(input); return 'Direct answer.' } })
  inbox(host, PRIMARY, '0001.json', TASK)
  const result = await host.processNext()
  assert.equal(result.reply, 'Direct answer.')
  assert.deepEqual(messages(host, PRIMARY).map((message) => message.role), ['user', 'bot'])
  assert.equal(delegationRecords(host, PRIMARY).length, 0)
  assert.equal(calls.length, 1)
})

check('a delegate block in the summary turn is stripped and ignored', async () => {
  const { host } = makeHost({
    agent: async (input) => {
      if (input.text.includes('You asked teammate')) {
        return 'Final answer.\n\n```rayrun-delegate\n{"bot":"weekly-watch","task":"again"}\n```'
      }
      if (input.botId === WORKER) return 'Worker result.'
      return 'Delegating.\n\n```rayrun-delegate\n{"bot":"weekly-watch","task":"check"}\n```'
    },
  })
  inbox(host, PRIMARY, '0001.json', TASK)
  const result = await host.processNext()
  assert.equal(result.reply, 'Final answer.')
  const records = delegationRecords(host, PRIMARY)
  assert.equal(records.length, 1)
  assert.equal(records[0].finalReply, 'Final answer.')
  const log = readFileSync(host.paths.log, 'utf8')
  assert.match(log, /delegation-ignored/)
})

check('a failed summary falls back to the worker result', async () => {
  const { host } = makeHost({
    agent: async (input) => {
      if (input.text.includes('You asked teammate')) throw new Error('summary provider failed')
      if (input.botId === WORKER) return 'Worker result.'
      return 'Delegating.\n\n```rayrun-delegate\n{"bot":"weekly-watch","task":"check"}\n```'
    },
  })
  inbox(host, PRIMARY, '0001.json', TASK)
  const result = await host.processNext()
  assert.match(result.reply, /Weekly Watch finished the delegated task\./)
  assert.match(result.reply, /Worker result\./)
  assert.match(result.reply, /The final summary could not be produced\./)
  const outbox = readJson(path.join(host.pathsFor(PRIMARY).outbox, `${TASK.id}.json`))
  assert.equal(outbox.reply, result.reply)
  assert.equal(delegationRecords(host, PRIMARY)[0].state, 'done')
})

check('a failed worker is reported and never claims success', async () => {
  const prompts = []
  const { host } = makeHost({
    agent: async (input) => {
      prompts.push(input.text)
      if (input.text.includes('You asked teammate')) {
        assert.match(input.text, /The teammate failed before completing the task: worker exploded/)
        return 'The teammate could not finish.'
      }
      if (input.botId === WORKER) throw new Error('worker exploded')
      return 'Delegating.\n\n```rayrun-delegate\n{"bot":"weekly-watch","task":"check"}\n```'
    },
  })
  inbox(host, PRIMARY, '0001.json', TASK)
  const result = await host.processNext()
  assert.equal(result.reply, 'The teammate could not finish.')
  const records = delegationRecords(host, PRIMARY)
  assert.equal(records[0].state, 'failed')
  assert.match(records[0].error, /worker exploded/)
  assert.equal(records[0].errorCode, 'E_DELEGATION_WORKER')
  assert.equal(existsSync(path.join(host.pathsFor(WORKER).outbox, `${records[0].id}.json`)), false)
  assert.deepEqual(messages(host, WORKER).map((message) => message.role), ['user'])
})

check('worker approvals wait on the primary and append a deterministic hint', async () => {
  const prompts = []
  const { host } = makeHost({
    agent: async (input) => {
      prompts.push(input.text)
      if (input.text.includes('You asked teammate')) {
        assert.match(input.text, /waiting for the user's approval for rayrun\.machine\.stop on box/)
        assert.match(input.text, /do not include a rayrun-approval block/)
        assert.equal(input.approvalDisabled, true)
        return 'Weekly Watch needs your approval.'
      }
      if (input.botId === WORKER) {
        return { text: 'I can stop the computer.', approval: { kind: 'rayrun.machine.stop', machine: 'box' } }
      }
      return 'Delegating.\n\n```rayrun-delegate\n{"bot":"weekly-watch","task":"stop the box"}\n```'
    },
  })
  inbox(host, PRIMARY, '0001.json', TASK)
  const result = await host.processNext()
  assert.equal(result.reply, 'Weekly Watch needs your approval.\n\nApproval needed: rayrun.machine.stop on box. Waiting for your decision.')
  const record = delegationRecords(host, PRIMARY)[0]
  assert.equal(record.state, 'waiting-approval')
  assert.deepEqual(record.approval, { kind: 'rayrun.machine.stop', machine: 'box' })
})

check('invalid delegation blocks are not executed and stay visible', async () => {
  const cases = [
    '```rayrun-delegate\n{not json}\n```',
    '```rayrun-delegate\n{"bot":"weekly-watch"}\n```',
    '```rayrun-delegate\n{"bot":"superagent","task":"self"}\n```',
    '```rayrun-delegate\n{"bot":"missing","task":"work"}\n```',
    '```rayrun-delegate\n{"bot":"weekly-watch","task":"a","extra":1}\n```',
    `\`\`\`rayrun-delegate\n{"bot":"weekly-watch","task":"${'x'.repeat(9 * 1024)}"}\n\`\`\``,
    '```rayrun-delegate\n{"bot":"weekly-watch","task":"one"}\n```\n\n```rayrun-delegate\n{"bot":"weekly-watch","task":"two"}\n```',
  ]
  for (const [index, block] of cases.entries()) {
    const calls = []
    const { host } = makeHost({ agent: async (input) => { calls.push(input); return `Reply.\n\n${block}` } })
    inbox(host, PRIMARY, `${index}.json`, { ...TASK, id: `task-invalid-${index}` })
    const result = await host.processNext()
    assert.match(result.reply, /^Reply\./, `case ${index}`)
    assert.match(result.reply, /The delegation request was not executed:/, `case ${index}`)
    assert.equal(calls.filter((call) => call.botId === WORKER).length, 0, `case ${index}`)
    assert.equal(delegationRecords(host, PRIMARY).length, 0, `case ${index}`)
  }
})

check('the delegation deadline writes a fallback instead of hanging', async () => {
  const { host } = makeHost({
    delegationDeadlineMs: 30,
    agent: async (input) => {
      if (input.botId === WORKER) return new Promise(() => {})
      return 'Delegating.\n\n```rayrun-delegate\n{"bot":"weekly-watch","task":"slow"}\n```'
    },
  })
  inbox(host, PRIMARY, '0001.json', { ...TASK, id: 'task-deadline' })
  const result = await host.processNext()
  assert.match(result.reply, /The delegated task to Weekly Watch failed: the delegation chain exceeded its deadline\./)
  const record = delegationRecords(host, PRIMARY)[0]
  assert.equal(record.state, 'failed')
  assert.equal(record.errorCode, 'E_DELEGATION_DEADLINE')
  assert.equal(existsSync(path.join(host.pathsFor(PRIMARY).outbox, 'task-deadline.json')), true)
})

check('recovery after a completed worker only reruns the summary', async () => {
  const calls = []
  const { host } = makeHost({
    agent: async (input) => {
      calls.push(input)
      if (input.text.includes('You asked teammate')) return 'Recovered summary.'
      throw new Error('worker must not run again')
    },
  })
  const record = {
    schema: 1,
    id: 'delegation-recover-done',
    primaryTaskId: 'task-recover-done',
    primaryBotId: PRIMARY,
    targetBotId: WORKER,
    state: 'done',
    phase: 'worker',
    task: 'check',
    reply: 'Worker result.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  mkdirSync(host.pathsFor(PRIMARY).delegations, { recursive: true })
  writeFileSync(path.join(host.pathsFor(PRIMARY).delegations, `${record.id}.json`), JSON.stringify(record))
  const task = { ...TASK, id: 'task-recover-done' }
  seedProcessing(host, PRIMARY, '0001.json', task, 'user request')
  assert.equal(host.recover(), 1)
  const result = await host.processNext()
  assert.equal(result.reply, 'Recovered summary.')
  assert.deepEqual(calls.map((call) => call.botId), [PRIMARY])
  const stored = delegationRecords(host, PRIMARY)[0]
  assert.equal(stored.state, 'done')
  assert.equal(stored.phase, 'summary')
})

check('recovery with an interrupted worker does not rerun it', async () => {
  const calls = []
  const { host } = makeHost({ agent: async (input) => { calls.push(input); return 'should not run' } })
  const record = {
    schema: 1,
    id: 'delegation-recover-running',
    primaryTaskId: 'task-recover-running',
    primaryBotId: PRIMARY,
    targetBotId: WORKER,
    state: 'running',
    phase: 'worker',
    task: 'check',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  mkdirSync(host.pathsFor(PRIMARY).delegations, { recursive: true })
  writeFileSync(path.join(host.pathsFor(PRIMARY).delegations, `${record.id}.json`), JSON.stringify(record))
  seedProcessing(host, PRIMARY, '0001.json', { ...TASK, id: 'task-recover-running' }, 'user request')
  host.recover()
  const result = await host.processNext()
  assert.equal(calls.length, 0)
  assert.match(result.reply, /The delegated task to Weekly Watch failed: the cloud host restarted while the teammate was working\./)
  const stored = delegationRecords(host, PRIMARY)[0]
  assert.equal(stored.state, 'failed')
  assert.equal(stored.errorCode, 'E_DELEGATION_INTERRUPTED')
})

check('recovery of an interrupted summary keeps the worker failure outcome', async () => {
  const calls = []
  const { host } = makeHost({
    agent: async (input) => {
      calls.push(input)
      assert.match(input.text, /The teammate failed before completing the task: worker exploded\./)
      return 'Failure summary.'
    },
  })
  const record = {
    schema: 1,
    id: 'delegation-recover-failed-summary',
    primaryTaskId: 'task-recover-failed-summary',
    primaryBotId: PRIMARY,
    targetBotId: WORKER,
    state: 'running',
    phase: 'summary',
    workerState: 'failed',
    task: 'check',
    error: 'worker exploded',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  mkdirSync(host.pathsFor(PRIMARY).delegations, { recursive: true })
  writeFileSync(path.join(host.pathsFor(PRIMARY).delegations, `${record.id}.json`), JSON.stringify(record))
  seedProcessing(host, PRIMARY, '0001.json', { ...TASK, id: 'task-recover-failed-summary' }, 'user request')
  host.recover()
  const result = await host.processNext()
  assert.equal(result.reply, 'Failure summary.')
  assert.deepEqual(calls.map((call) => call.botId), [PRIMARY])
  assert.equal(delegationRecords(host, PRIMARY)[0].state, 'failed')
  assert.equal(delegationRecords(host, PRIMARY)[0].phase, 'summary')
})

check('recovery while waiting for approval does not rerun the worker', async () => {
  const calls = []
  const { host } = makeHost({ agent: async (input) => { calls.push(input); return 'should not run' } })
  const record = {
    schema: 1,
    id: 'delegation-recover-approval',
    primaryTaskId: 'task-recover-approval',
    primaryBotId: PRIMARY,
    targetBotId: WORKER,
    state: 'waiting-approval',
    phase: 'worker',
    task: 'stop',
    reply: 'I can stop the computer.',
    approval: { kind: 'rayrun.machine.stop', machine: 'box' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  mkdirSync(host.pathsFor(PRIMARY).delegations, { recursive: true })
  writeFileSync(path.join(host.pathsFor(PRIMARY).delegations, `${record.id}.json`), JSON.stringify(record))
  seedProcessing(host, PRIMARY, '0001.json', { ...TASK, id: 'task-recover-approval' }, 'user request')
  host.recover()
  const result = await host.processNext()
  assert.equal(calls.length, 0)
  assert.match(result.reply, /Weekly Watch is waiting for your approval for rayrun\.machine\.stop on box\./)
  assert.equal(delegationRecords(host, PRIMARY)[0].state, 'waiting-approval')
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

for (const root of roots) rmSync(root, { recursive: true, force: true })

console.log(`${checks.length - failed}/${checks.length} cloud host delegation checks passed`)
if (failed > 0) process.exit(1)
