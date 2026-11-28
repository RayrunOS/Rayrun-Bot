/**
 * Cloud-host projection checks.
 *
 *   node test/host-projection.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { HOST_ASSET_VERSION, hostAssetFiles, hostAssetManifest, projectHost } from '../lib/host-projection.js'
import { ERROR_CODES } from '../lib/errors.js'

const PACKAGE_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

const checks = []
const check = (name, fn) => checks.push({ name, fn })

function memory() {
  const files = new Map()
  const writes = []
  return {
    files,
    writes,
    read: async (path) => (files.has(path) ? files.get(path) : null),
    write: async (path, text) => {
      writes.push(path)
      files.set(path, text)
    },
  }
}

check('the package ships the host files and a deterministic manifest', () => {
  const files = hostAssetFiles()
  assert.deepEqual(files.map((file) => file.path), [
    'host.mjs', 'lib/host.mjs', 'lib/dsh-agent.mjs', 'lib/proposal.mjs',
    'lib/routines.mjs', 'lib/prompt.mjs', 'bin/propose.mjs',
  ])
  for (const file of files) {
    assert.match(file.sha256, /^[a-f0-9]{64}$/)
    assert.ok(file.bytes > 0)
  }
  const manifest = hostAssetManifest('1.2.3')
  assert.equal(manifest.schema, 1)
  assert.equal(manifest.version, '1.2.3')
  assert.deepEqual(manifest.files.map((file) => file.path), files.map((file) => file.path))
  assert.equal(HOST_ASSET_VERSION, PACKAGE_VERSION)
})

check('projects the files once and then serves them from the verified cache', async () => {
  const remote = memory()
  const first = await projectHost({ ...remote, version: '1.2.3' })
  assert.equal(first.version, '1.2.3')
  assert.equal(first.root, '.rayrun/host/1.2.3')
  assert.equal(first.script, '/workspace/.rayrun/host/1.2.3/host.mjs')
  assert.equal(first.cached, false)
  assert.deepEqual(remote.writes, [
    '.rayrun/host/1.2.3/host.mjs',
    '.rayrun/host/1.2.3/lib/host.mjs',
    '.rayrun/host/1.2.3/lib/dsh-agent.mjs',
    '.rayrun/host/1.2.3/lib/proposal.mjs',
    '.rayrun/host/1.2.3/lib/routines.mjs',
    '.rayrun/host/1.2.3/lib/prompt.mjs',
    '.rayrun/host/1.2.3/bin/propose.mjs',
    '.rayrun/host/1.2.3/manifest.json',
  ])

  remote.writes.length = 0
  const second = await projectHost({ ...remote, version: '1.2.3' })
  assert.equal(second.cached, true)
  assert.deepEqual(remote.writes, [])
})

check('re-uploads a tampered file or manifest', async () => {
  const remote = memory()
  await projectHost({ ...remote, version: '1.2.3' })
  remote.files.set('.rayrun/host/1.2.3/lib/host.mjs', 'tampered')
  remote.writes.length = 0
  const repaired = await projectHost({ ...remote, version: '1.2.3' })
  assert.equal(repaired.cached, false)
  assert.ok(remote.writes.includes('.rayrun/host/1.2.3/lib/host.mjs'))

  remote.files.set('.rayrun/host/1.2.3/manifest.json', '{broken')
  remote.writes.length = 0
  const again = await projectHost({ ...remote, version: '1.2.3' })
  assert.equal(again.cached, false)
  assert.ok(remote.writes.includes('.rayrun/host/1.2.3/manifest.json'))
})

check('a failed upload fails closed with a stable runtime code', async () => {
  const remote = memory()
  remote.write = async (path) => {
    if (path.endsWith('manifest.json')) {
      const error = new Error('upload refused')
      error.code = 'permission_denied'
      throw error
    }
    remote.files.set(path, 'partial')
  }
  await assert.rejects(
    projectHost({ ...remote, version: '1.2.3' }),
    (error) => error.code === ERROR_CODES.runtimeUnavailable,
  )
})

check('an unsafe version is refused before any read or write', async () => {
  let touched = false
  await assert.rejects(
    projectHost({
      read: async () => { touched = true; return null },
      write: async () => { touched = true },
      version: '../escape',
    }),
    (error) => error.code === ERROR_CODES.runtimeUnavailable,
  )
  assert.equal(touched, false)
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
console.log(`${passed}/${checks.length} host projection checks passed`)
if (failed > 0) process.exit(1)
