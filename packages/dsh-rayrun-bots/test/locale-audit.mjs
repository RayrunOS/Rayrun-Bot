import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

function flatten(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, next, out)
    else out.set(next, child)
  }
  return out
}

const en = flatten(JSON.parse(readFileSync(path.join(root, 'locale/en.json'), 'utf8')))
const zh = flatten(JSON.parse(readFileSync(path.join(root, 'locale/zh.json'), 'utf8')))
const errors = []

for (const key of en.keys()) if (!zh.has(key)) errors.push(`zh.json is missing ${key}`)
for (const key of zh.keys()) if (!en.has(key)) errors.push(`en.json is missing ${key}`)
for (const [file, table] of [['en', en], ['zh', zh]]) {
  for (const [key, value] of table) {
    if (typeof value !== 'string' || value.trim() === '') errors.push(`${file}.${key} must be a non-empty string`)
  }
}

if (errors.length) {
  console.error('locale audit failed:')
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(`locale ok: ${en.size} keys, en/zh in sync`)
