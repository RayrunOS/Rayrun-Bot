/**
 * Published tarball contents.
 *
 * Runs `npm pack --dry-run --json` so the check uses npm's real inclusion
 * rules, then compares the file list with the package manifest. Every shipped
 * module must be present; tests, docs, tarballs and environment files must not.
 *
 *   node test/package-contents.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const output = execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
})
const [pack] = JSON.parse(output)
assert.ok(pack, 'npm pack returned no package')
assert.equal(pack.name, pkg.name)
assert.equal(pack.version, pkg.version)
assert.equal(pack.filename, `${pkg.name}-${pkg.version}.tgz`)

/** Walk the package without following symlinks or entering build state. */
function walk(directory, relative = '') {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const next = relative ? `${relative}/${entry.name}` : entry.name
    const full = path.join(directory, entry.name)
    const stat = statSync(full)
    if (stat.isDirectory()) files.push(...walk(full, next))
    else if (stat.isFile()) files.push(next)
  }
  return files
}

function covered(entry, file) {
  if (entry === file) return true
  if (!entry.includes('*')) return false
  const pattern = `^${entry.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`
  return new RegExp(pattern).test(file)
}

const always = new Set(['package.json', 'README.md', 'LICENSE'])
const expected = walk(root)
  .filter((file) => always.has(file) || pkg.files.some((entry) => covered(entry, file)))
  .sort()
const actual = pack.files.map((file) => file.path).sort()

assert.deepEqual(actual.filter((file) => !expected.includes(file)), [], 'tarball has unexpected files')
assert.deepEqual(expected.filter((file) => !actual.includes(file)), [], 'tarball is missing files')

for (const forbidden of [/^test\//, /^docs\//, /^tools\//, /^node_modules\//, /\.tgz$/, /(^|\/)\.env$/, /\.tmp-/]) {
  assert.equal(actual.some((file) => forbidden.test(file)), false, `tarball contains ${forbidden}`)
}

for (const required of [
  'index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'LICENSE', 'icon.svg',
  'locale/en.json', 'locale/zh.json',
  ...readdirSync(path.join(root, 'lib')).filter((file) => file.endsWith('.js')).map((file) => `lib/${file}`),
]) {
  assert.ok(actual.includes(required), `tarball is missing ${required}`)
}

console.log(`package contents ok: ${actual.length} files, ${pkg.name}@${pkg.version}`)
