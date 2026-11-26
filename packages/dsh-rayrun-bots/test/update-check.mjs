/**
 * Read-only npm update check.
 *
 *   node test/update-check.mjs
 */
import assert from 'node:assert/strict'
import { checkForUpdate, compareVersions, parseVersion, updateCommand, UPDATE_REGISTRY } from '../lib/update-check.js'

const checks = []
const check = (name, fn) => checks.push({ name, fn })

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body) },
  }
}

function fakeFetch({ status = 200, body = {}, seen = [] } = {}) {
  return async (url, options) => {
    seen.push({ url, options })
    return response(status, body)
  }
}

check('finds a newer alpha build and keeps the alpha channel', async () => {
  const seen = []
  const result = await checkForUpdate({
    current: '0.1.1-alpha.1',
    fetchImpl: fakeFetch({ body: { alpha: '0.1.1-alpha.2', latest: '0.1.0-alpha.0' }, seen }),
  })
  assert.deepEqual(result, {
    current: '0.1.1-alpha.1',
    channel: 'alpha',
    latest: '0.1.1-alpha.2',
    updateAvailable: true,
  })
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, `${UPDATE_REGISTRY}/-/package/dsh-rayrun-bots/dist-tags`)
  assert.equal(seen[0].options.headers.authorization, undefined)
  assert.equal(seen[0].options.redirect, 'error')
})

check('uses the latest tag for a stable build and reports an equal version as current', async () => {
  const newer = await checkForUpdate({
    current: '0.1.1',
    fetchImpl: fakeFetch({ body: { latest: '0.1.2', alpha: '0.1.3-alpha.0' } }),
  })
  assert.equal(newer.channel, 'latest')
  assert.equal(newer.latest, '0.1.2')
  assert.equal(newer.updateAvailable, true)

  const same = await checkForUpdate({
    current: '0.1.1',
    fetchImpl: fakeFetch({ body: { latest: '0.1.1' } }),
  })
  assert.equal(same.updateAvailable, false)
})

check('compares semver prereleases numerically and ranks a release above its prereleases', () => {
  assert.equal(compareVersions('0.1.1-alpha.2', '0.1.1-alpha.1'), 1)
  assert.equal(compareVersions('0.1.1-alpha.10', '0.1.1-alpha.2'), 1)
  assert.equal(compareVersions('0.1.1', '0.1.1-alpha.10'), 1)
  assert.equal(compareVersions('0.1.1-alpha.1', '0.1.1-alpha.1'), 0)
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1)
  assert.equal(parseVersion('0.1.1+build.2').pre.length, 0)
  assert.equal(parseVersion('not-a-version'), null)
})

check('returns no update when the channel tag is missing or malformed', async () => {
  const missing = await checkForUpdate({
    current: '0.1.1-alpha.1',
    fetchImpl: fakeFetch({ body: { latest: '0.1.0-alpha.0' } }),
  })
  assert.deepEqual(missing, { current: '0.1.1-alpha.1', channel: 'alpha', latest: null, updateAvailable: false })

  const malformed = await checkForUpdate({
    current: '0.1.1-alpha.1',
    fetchImpl: fakeFetch({ body: { alpha: 'tomorrow' } }),
  })
  assert.equal(malformed.latest, null)
  assert.equal(malformed.updateAvailable, false)
})

check('fails closed on HTTP errors, invalid JSON and oversized responses', async () => {
  await assert.rejects(
    checkForUpdate({ current: '0.1.1-alpha.1', fetchImpl: fakeFetch({ status: 503, body: {} }) }),
    /HTTP 503/,
  )
  await assert.rejects(
    checkForUpdate({ current: '0.1.1-alpha.1', fetchImpl: fakeFetch({ body: '{not json' }) }),
    /invalid JSON/,
  )
  await assert.rejects(
    checkForUpdate({
      current: '0.1.1-alpha.1',
      fetchImpl: fakeFetch({ body: JSON.stringify({ alpha: 'x'.repeat(70 * 1024) }) }),
    }),
    /oversized/,
  )
  await assert.rejects(
    checkForUpdate({ current: 'not-semver', fetchImpl: fakeFetch({ body: { alpha: '0.1.1-alpha.2' } }) }),
    /current version/,
  )
  await assert.rejects(
    checkForUpdate({ current: '0.1.1-alpha.1', fetchImpl: async () => { throw new Error('network down') } }),
    /network down/,
  )
})

check('builds a copyable command and refuses to execute or use an invalid version', () => {
  assert.equal(
    updateCommand({ latest: '0.1.1-alpha.2' }),
    'npm_config_registry=https://registry.npmjs.org dsh plugin --profile web add dsh-rayrun-bots@0.1.1-alpha.2',
  )
  assert.throws(() => updateCommand({ latest: 'latest' }), /valid update version/)
})

let passed = 0
let failed = 0
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
console.log(`${passed}/${checks.length} update check checks passed`)
if (failed > 0) process.exit(1)
