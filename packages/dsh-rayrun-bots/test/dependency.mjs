/**
 * Dependency detection checks for the cloud-computer plugin.
 *
 *   node test/dependency.mjs
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DEPENDENCY_NAME, DEPENDENCY_RANGE, checkDependency, supportsDetached, supportsRuntimeRpc,
} from '../lib/dependency.js'

const root = mkdtempSync(path.join(tmpdir(), 'rayrun-bots-dependency-'))
const errors = []

function profile(name, manifest) {
  const dir = path.join(root, name)
  mkdirSync(dir, { recursive: true })
  if (manifest !== undefined) {
    const packageDir = path.join(dir, 'node_modules', DEPENDENCY_NAME)
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(path.join(packageDir, 'package.json'), manifest)
  }
  return dir
}

function expected(overrides) {
  return { name: DEPENDENCY_NAME, required: DEPENDENCY_RANGE, version: null, status: 'unknown', code: null, ...overrides }
}

const checks = []
const check = (name, fn) => checks.push({ name, fn })

check('no profile context is unknown, not a failure', () => {
  assert.deepEqual(checkDependency(undefined), expected({}))
})

check('an absent package is missing with E_DEP_MISSING', () => {
  assert.deepEqual(checkDependency(profile('empty')), expected({ status: 'missing', code: 'E_DEP_MISSING' }))
})

for (const version of ['1.0.0', '1.4.2', '1.9.0-rc.1']) {
  check(`1.x version ${version} is supported`, () => {
    const dir = profile(`ok-${version}`, JSON.stringify({ name: DEPENDENCY_NAME, version }))
    assert.deepEqual(checkDependency(dir), expected({ version, status: 'ok' }))
  })
}

for (const version of ['0.9.0', '2.0.0', '2.0.0-rc.1', 'not-a-version']) {
  check(`version ${version} is incompatible with E_DEP_VERSION`, () => {
    const dir = profile(`bad-${version}`, JSON.stringify({ name: DEPENDENCY_NAME, version }))
    assert.deepEqual(checkDependency(dir), expected({ version, status: 'incompatible', code: 'E_DEP_VERSION' }))
  })
}

check('supportsDetached requires the 1.1 line, not 1.0 or 2.x', () => {
  for (const [version, expectedValue] of [
    ['1.0.0', false],
    ['1.0.9', false],
    ['1.1.0', true],
    ['1.4.2', true],
    ['1.1.0-rc.1', true],
    ['2.0.0', false],
    [null, false],
    ['not-a-version', false],
  ]) {
    assert.equal(supportsDetached(version), expectedValue, `supportsDetached(${version})`)
  }
})

check('supportsRuntimeRpc requires the 1.2 line, not 1.1 or 2.x', () => {
  for (const [version, expectedValue] of [
    ['1.0.0', false],
    ['1.1.0', false],
    ['1.1.9', false],
    ['1.2.0', true],
    ['1.2.0-rc.1', true],
    ['1.4.2', true],
    ['2.0.0', false],
    [null, false],
    ['not-a-version', false],
  ]) {
    assert.equal(supportsRuntimeRpc(version), expectedValue, `supportsRuntimeRpc(${version})`)
  }
})

check('malformed installed metadata is incompatible, not missing', () => {
  const dir = profile('malformed', '{not json')
  assert.deepEqual(checkDependency(dir), expected({ status: 'incompatible', code: 'E_DEP_VERSION' }))
})

check('a manifest without a version is incompatible', () => {
  const dir = profile('no-version', JSON.stringify({ name: DEPENDENCY_NAME }))
  assert.deepEqual(checkDependency(dir), expected({ status: 'incompatible', code: 'E_DEP_VERSION' }))
})

rmSync(root, { recursive: true, force: true })

for (const { name, fn } of checks) {
  try {
    fn()
    console.log(`ok   ${name}`)
  } catch (error) {
    errors.push({ name, error })
    console.error(`FAIL ${name}: ${error?.message ?? error}`)
  }
}

if (errors.length) {
  console.error(`${errors.length}/${checks.length} dependency checks failed`)
  process.exit(1)
}
console.log(`${checks.length}/${checks.length} dependency checks passed`)
