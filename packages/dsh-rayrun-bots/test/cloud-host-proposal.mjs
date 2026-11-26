/**
 * Structured cloud approval block checks.
 *
 *   node test/cloud-host-proposal.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { APPROVAL_PARSE_ERROR, extractProposal, writeProposal } from '../cloud-host/lib/proposal.mjs'

const checks = []
const check = (name, fn) => checks.push({ name, fn })
const roots = []

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-proposal-'))
  roots.push(root)
  return root
}

const BLOCK = (body) => `I am waiting for approval.\n\n\`\`\`rayrun-approval\n${body}\n\`\`\``

check('extracts a typed block, strips it from the reply and writes the proposal', () => {
  const root = setup()
  const parsed = extractProposal(BLOCK('{"kind":"rayrun.machine.stop","machine":"box"}'), {
    botId: 'cloud-bot',
    defaultMachine: 'box',
  })
  assert.equal(parsed.error, null)
  assert.equal(parsed.text, 'I am waiting for approval.')
  assert.equal(parsed.proposal.botId, 'cloud-bot')
  assert.match(parsed.proposal.id, /^prop-/)
  assert.deepEqual(parsed.proposal.action, { kind: 'rayrun.machine.stop', machine: 'box' })
  assert.equal(parsed.proposal.origin, 'chat')
  const target = writeProposal(root, 'cloud-bot', parsed.proposal)
  assert.equal(target, path.join(root, 'bots', 'cloud-bot', 'proposals', `${parsed.proposal.id}.json`))
  const stored = JSON.parse(readFileSync(target, 'utf8'))
  assert.deepEqual(stored, parsed.proposal)
})

check('marks a routine proposal as background', () => {
  const parsed = extractProposal(BLOCK('{"kind":"rayrun.machine.stop","machine":"box"}'), {
    botId: 'cloud-bot',
    origin: 'background',
  })
  assert.equal(parsed.error, null)
  assert.equal(parsed.proposal.origin, 'background')
  const invalid = extractProposal(BLOCK('{"kind":"rayrun.machine.stop","machine":"box"}'), {
    botId: 'cloud-bot',
    origin: 'shell',
  })
  assert.equal(invalid.proposal, null)
  assert.match(invalid.error, /origin/)
})

check('uses the default machine and returns a non-empty reply when only the block is present', () => {
  const parsed = extractProposal('```rayrun-approval\n{"kind":"rayrun.machine.start"}\n```', {
    botId: 'cloud-bot',
    defaultMachine: 'box-id',
  })
  assert.equal(parsed.error, null)
  assert.equal(parsed.proposal.action.machine, 'box-id')
  assert.equal(parsed.text, 'Waiting for approval.')
})

check('rejects invalid JSON, unknown kinds, extra fields and bad machines without writing', () => {
  for (const body of [
    '{not json}',
    '{"kind":"rayrun.machine.destroy","machine":"box"}',
    '{"kind":"rayrun.machine.stop","machine":"box","argv":["rm"]}',
    '{"kind":"rayrun.machine.stop","machine":"../box"}',
  ]) {
    const parsed = extractProposal(BLOCK(body), { botId: 'cloud-bot', defaultMachine: 'box' })
    assert.equal(parsed.proposal, null)
    assert.ok(parsed.error)
    assert.doesNotMatch(parsed.text, /```rayrun-approval/)
    assert.equal(parsed.text.includes(APPROVAL_PARSE_ERROR), true)
    assert.match(parsed.text, /No action was requested\./)
  }
})

check('keeps a natural-language reply and marks an invalid approval block', () => {
  const parsed = extractProposal(
    'I can stop the computer for you. Here is the request.\n\n```rayrun-approval\n{not json}\n```',
    { botId: 'cloud-bot', defaultMachine: 'box' },
  )
  assert.equal(parsed.proposal, null)
  assert.match(parsed.error, /not valid JSON/)
  assert.match(parsed.text, /^I can stop the computer for you\. Here is the request\.\n\n/)
  assert.equal(parsed.text.includes(APPROVAL_PARSE_ERROR), true)
})

check('leaves a reply without a block unchanged and does not overwrite a proposal id', () => {
  const plain = extractProposal('No approval needed.', { botId: 'cloud-bot' })
  assert.deepEqual(plain, { text: 'No approval needed.', proposal: null, error: null })

  const root = setup()
  const parsed = extractProposal(BLOCK('{"kind":"rayrun.machine.stop","machine":"box"}'), { botId: 'cloud-bot' })
  writeProposal(root, 'cloud-bot', parsed.proposal)
  assert.throws(() => writeProposal(root, 'cloud-bot', parsed.proposal), (error) => error.code === 'EEXIST')
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
console.log(`${passed}/${checks.length} cloud host proposal checks passed`)
if (failed > 0) process.exit(1)
