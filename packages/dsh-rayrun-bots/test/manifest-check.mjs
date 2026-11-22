import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const errors = []

function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8')
}

const pkg = JSON.parse(read('package.json'))
if (pkg.name !== 'dsh-rayrun-bots') errors.push(`package name is ${pkg.name}`)
if (pkg.type !== 'module') errors.push('package must be ESM (type: module)')
if (pkg.exports?.['.'] !== './index.js') errors.push('exports["."] must point at index.js')
if (pkg.exports?.['./client'] !== './client.js') errors.push('exports["./client"] must point at client.js')
if (pkg.exports?.['./icon'] !== './icon.svg') errors.push('exports["./icon"] must point at icon.svg')
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') errors.push('dsh.bundle.patch must be ./cordis.patch.yml')
if (!Array.isArray(pkg.dsh?.client?.inject) || pkg.dsh.client.inject.length === 0) {
  errors.push('dsh.client.inject must list at least one client UI module')
}
if (pkg.license !== 'MIT') errors.push('license must be MIT')
if (pkg.engines?.node !== '>=24') errors.push('engines.node must be >=24')
// DSH 0.2.2-rc.5's compatibility preflight reads engines.dsh and denies the row
// when the running runtime does not satisfy the range.
if (pkg.engines?.dsh !== '>=0.2.0-rc.2 <0.3.0') {
  errors.push(`engines.dsh must be >=0.2.0-rc.2 <0.3.0 (got ${JSON.stringify(pkg.engines?.dsh)})`)
}

const requiredFiles = ['index.js', 'client.js', 'cordis.patch.yml', 'README.md', 'LICENSE', 'lib/approvals.js', 'lib/bot-schema.js', 'lib/bots.js', 'lib/bot-workspace.js', 'lib/cloud-host-runtime.js', 'lib/host-projection.js', 'cloud-host/host.mjs', 'cloud-host/lib/host.mjs', 'cloud-host/lib/dsh-agent.mjs', 'lib/dependency.js', 'lib/errors.js', 'lib/local-store.js', 'lib/rpc.js', 'lib/runtime.js', 'lib/rayrun-detached-runtime.js', 'lib/rayrun-rpc.js', 'lib/rayrun-runtime.js', 'lib/runtime-rpc.js', 'lib/sessions.js', 'locale/en.json', 'locale/zh.json', 'icon.svg']

function covered(entry, file) {
  if (entry === file) return true
  if (!entry.includes('*')) return false
  const pattern = `^${entry.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`
  return new RegExp(pattern).test(file)
}

for (const file of requiredFiles) {
  if (!pkg.files?.some((entry) => covered(entry, file))) errors.push(`files[] does not cover ${file}`)
}

const patch = read('cordis.patch.yml')
if (!/id:\s*rayrun-bots/.test(patch)) errors.push('cordis.patch.yml row id must be rayrun-bots')
if (!/name:\s*'dsh-rayrun-bots'/.test(patch)) errors.push("cordis.patch.yml row name must be 'dsh-rayrun-bots'")

const host = read('index.js')
if (!host.includes("export const name = 'rayrun-bots'")) errors.push('host half must export name = rayrun-bots')

const client = read('client.js')
if (!client.includes("id: 'dsh-rayrun-bots'")) errors.push('client half must register id dsh-rayrun-bots')
if (!client.includes("name: 'sidebar.panellist'")) errors.push('client half must register a sidebar panel')

const icon = read('icon.svg')
if (!icon.trimStart().startsWith('<svg')) errors.push('icon.svg must be an SVG document')
if (Buffer.byteLength(icon) > 256 * 1024) errors.push('icon.svg exceeds the 256 KiB plugin icon limit')

if (errors.length) {
  console.error('manifest check failed:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(`manifest ok: ${pkg.name}@${pkg.version}`)
