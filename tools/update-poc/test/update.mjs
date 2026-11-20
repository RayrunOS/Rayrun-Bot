/**
 * Plain-Node checks for the update prototype. No framework, no network.
 *
 *   node tools/update-poc/test/update.mjs
 */
import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  UpdateError,
  canonicalize,
  compareVersions,
  signManifest,
  validateManifest,
} from '../manifest.mjs'
import { applyUpdate, currentVersion, readState, rollback, stageUpdate } from '../apply.mjs'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const otherKeys = generateKeyPairSync('ed25519')

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`ok   ${name}`)
    passed += 1
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    failed += 1
  }
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'rayrun-update-'))
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

function makeManifest(files, overrides = {}) {
  const entries = Object.entries(files).map(([path, content]) => ({
    path,
    sha256: sha256(content),
  }))
  return signManifest(
    {
      schema: 1,
      app: 'rayrun-bot',
      version: '1.1.0',
      minVersion: '1.0.0',
      dsh: '0.2.2-rc.1',
      plugins: { 'dsh-rayrun-bots': '0.1.0', 'dsh-rayrun-computer': '0.2.1' },
      files: entries,
      ...overrides,
    },
    privateKey,
  )
}

function makeFeed(root, files, overrides = {}) {
  const feedDir = join(root, 'feed')
  const artifactDir = join(feedDir, 'artifact')
  mkdirSync(feedDir, { recursive: true })
  writeFiles(artifactDir, files)
  const manifest = makeManifest(files, overrides)
  writeFileSync(join(feedDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  return { feedDir, artifactDir, manifest }
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof UpdateError && error.code === code)
}

function filesFor(version) {
  return {
    'app/main.js': `console.log(${JSON.stringify(version)})\n`,
    'runtime/version.txt': `${version}\n`,
  }
}

test('canonical JSON sorts keys and rejects non-JSON values', () => {
  assert.equal(canonicalize({ b: 2, a: [true, null, 'x'] }), '{"a":[true,null,"x"],"b":2}')
  assert.throws(() => canonicalize({ a: Number.NaN }), (error) => error.code === 'E_MANIFEST')
})

test('semver comparison handles prerelease ordering', () => {
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.1'), 1)
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1)
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0-rc.1'), 0)
})

test('applies a signed update and records the current version', () => {
  const root = tempDir()
  try {
    const files = filesFor('1.1.0')
    const { feedDir } = makeFeed(root, files, { version: '1.1.0' })
    const targetRoot = join(root, 'target')
    const state = applyUpdate({
      feedDir,
      targetRoot,
      publicKey,
      installedVersion: '1.0.0',
      app: 'rayrun-bot',
    })
    assert.equal(state.current.version, '1.1.0')
    assert.equal(state.previous, null)
    assert.equal(currentVersion(targetRoot), '1.1.0')
    assert.equal(readFileSync(join(targetRoot, 'versions/1.1.0/app/main.js'), 'utf8'), files['app/main.js'])
    assert.equal(readState(targetRoot).current.version, '1.1.0')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('applies a second update and rolls back to the previous version', () => {
  const root = tempDir()
  try {
    const targetRoot = join(root, 'target')
    const first = makeFeed(join(root, 'first'), filesFor('1.1.0'), { version: '1.1.0' })
    applyUpdate({
      feedDir: first.feedDir,
      targetRoot,
      publicKey,
      installedVersion: '1.0.0',
      app: 'rayrun-bot',
    })
    const second = makeFeed(join(root, 'second'), filesFor('1.2.0'), { version: '1.2.0' })
    const state = applyUpdate({
      feedDir: second.feedDir,
      targetRoot,
      publicKey,
      installedVersion: '1.1.0',
      app: 'rayrun-bot',
    })
    assert.equal(state.current.version, '1.2.0')
    assert.equal(state.previous.version, '1.1.0')
    assert.equal(readFileSync(join(targetRoot, 'versions/1.2.0/app/main.js'), 'utf8'), filesFor('1.2.0')['app/main.js'])

    const rolledBack = rollback({ targetRoot })
    assert.equal(rolledBack.current.version, '1.1.0')
    assert.equal(rolledBack.previous, null)
    assert.equal(currentVersion(targetRoot), '1.1.0')
    assert.equal(readFileSync(join(targetRoot, 'versions/1.1.0/app/main.js'), 'utf8'), filesFor('1.1.0')['app/main.js'])
    assert.equal(existsSync(join(targetRoot, 'versions/1.2.0')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a manifest changed after signing', () => {
  const root = tempDir()
  try {
    const files = filesFor('1.1.0')
    const { artifactDir, manifest } = makeFeed(root, files, { version: '1.1.0' })
    const tampered = { ...manifest, version: '1.2.0' }
    expectCode(
      () =>
        stageUpdate({
          artifactDir,
          manifest: tampered,
          targetRoot: join(root, 'target'),
          publicKey,
          installedVersion: '1.0.0',
          app: 'rayrun-bot',
        }),
      'E_SIGNATURE',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a manifest signed by a different key', () => {
  const root = tempDir()
  try {
    const files = filesFor('1.1.0')
    const { artifactDir, manifest } = makeFeed(root, files, { version: '1.1.0' })
    expectCode(
      () =>
        stageUpdate({
          artifactDir,
          manifest,
          targetRoot: join(root, 'target'),
          publicKey: otherKeys.publicKey,
          installedVersion: '1.0.0',
          app: 'rayrun-bot',
        }),
      'E_SIGNATURE',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects an artifact whose bytes changed after signing', () => {
  const root = tempDir()
  try {
    const files = filesFor('1.1.0')
    const { feedDir } = makeFeed(root, files, { version: '1.1.0' })
    writeFileSync(join(feedDir, 'artifact/app/main.js'), 'tampered\n')
    const targetRoot = join(root, 'target')
    expectCode(
      () =>
        applyUpdate({
          feedDir,
          targetRoot,
          publicKey,
          installedVersion: '1.0.0',
          app: 'rayrun-bot',
        }),
      'E_HASH',
    )
    assert.equal(existsSync(targetRoot), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects path traversal, duplicate paths and bad hashes in the manifest', () => {
  const files = { 'app/main.js': 'ok\n' }
  const good = makeManifest(files)
  const traversal = signManifest(
    { ...good, signature: undefined, files: [{ path: '../evil', sha256: sha256('x') }] },
    privateKey,
  )
  expectCode(() => validateManifest(traversal, { publicKey }), 'E_MANIFEST')

  const duplicate = signManifest(
    { ...good, signature: undefined, files: [good.files[0], good.files[0]] },
    privateKey,
  )
  expectCode(() => validateManifest(duplicate, { publicKey }), 'E_MANIFEST')

  const badHash = signManifest(
    { ...good, signature: undefined, files: [{ path: 'app/main.js', sha256: 'nope' }] },
    privateKey,
  )
  expectCode(() => validateManifest(badHash, { publicKey }), 'E_MANIFEST')
})

test('rejects extra files and symlinks in the artifact', () => {
  const root = tempDir()
  try {
    const files = filesFor('1.1.0')
    const extra = makeFeed(join(root, 'extra'), files, { version: '1.1.0' })
    writeFileSync(join(extra.artifactDir, 'unexpected.txt'), 'extra\n')
    expectCode(
      () =>
        stageUpdate({
          artifactDir: extra.artifactDir,
          manifest: extra.manifest,
          targetRoot: join(root, 'target-extra'),
          publicKey,
          installedVersion: '1.0.0',
          app: 'rayrun-bot',
        }),
      'E_ARTIFACT',
    )

    const linked = makeFeed(join(root, 'linked'), files, { version: '1.1.0' })
    try {
      symlinkSync(join(linked.artifactDir, 'app/main.js'), join(linked.artifactDir, 'app/link.js'))
    } catch (error) {
      if (error?.code === 'EPERM') return
      throw error
    }
    expectCode(
      () =>
        stageUpdate({
          artifactDir: linked.artifactDir,
          manifest: linked.manifest,
          targetRoot: join(root, 'target-link'),
          publicKey,
          installedVersion: '1.0.0',
          app: 'rayrun-bot',
        }),
      'E_ARTIFACT',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a target that is not newer and a version below minVersion', () => {
  const root = tempDir()
  try {
    const files = filesFor('1.1.0')
    const same = makeFeed(join(root, 'same'), files, { version: '1.0.0', minVersion: '0.9.0' })
    expectCode(
      () =>
        stageUpdate({
          artifactDir: same.artifactDir,
          manifest: same.manifest,
          targetRoot: join(root, 'target-same'),
          publicKey,
          installedVersion: '1.0.0',
          app: 'rayrun-bot',
        }),
      'E_VERSION',
    )

    const tooOld = makeFeed(join(root, 'old'), files, { version: '2.0.0', minVersion: '1.5.0' })
    expectCode(
      () =>
        stageUpdate({
          artifactDir: tooOld.artifactDir,
          manifest: tooOld.manifest,
          targetRoot: join(root, 'target-old'),
          publicKey,
          installedVersion: '1.0.0',
          app: 'rayrun-bot',
        }),
      'E_VERSION',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an interruption before the switch leaves the old state intact', () => {
  const root = tempDir()
  try {
    const files = filesFor('1.1.0')
    const { feedDir } = makeFeed(root, files, { version: '1.1.0' })
    const targetRoot = join(root, 'target')
    assert.throws(
      () =>
        applyUpdate({
          feedDir,
          targetRoot,
          publicKey,
          installedVersion: '1.0.0',
          app: 'rayrun-bot',
          hooks: {
            beforeSwitch() {
              throw new Error('simulated interruption')
            },
          },
        }),
      /simulated interruption/,
    )
    assert.equal(readState(targetRoot), null)
    assert.equal(existsSync(join(targetRoot, 'versions/1.1.0')), false)
    const versions = existsSync(join(targetRoot, 'versions')) ? readdirSync(join(targetRoot, 'versions')) : []
    assert.deepEqual(versions.filter((name) => name.startsWith('.staging-')), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects rollback without a previous version and a state mismatch', () => {
  const root = tempDir()
  try {
    const files = filesFor('1.1.0')
    const { feedDir } = makeFeed(root, files, { version: '1.1.0' })
    const targetRoot = join(root, 'target')
    applyUpdate({ feedDir, targetRoot, publicKey, installedVersion: '1.0.0', app: 'rayrun-bot' })
    expectCode(() => rollback({ targetRoot }), 'E_STATE')
    expectCode(
      () =>
        applyUpdate({
          feedDir,
          targetRoot,
          publicKey,
          installedVersion: '1.0.0',
          app: 'rayrun-bot',
        }),
      'E_STATE',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
