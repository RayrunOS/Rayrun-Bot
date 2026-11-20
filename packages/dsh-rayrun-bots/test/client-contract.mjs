/**
 * Client-shell contract.
 *
 * The page is one file, so the locale catalogs are embedded next to
 * locale/en.json and locale/zh.json. This check keeps those copies identical,
 * requires the v0.1 copy deck, and refuses a client that still shows the A1
 * placeholder or reaches off the machine.
 *
 *   node test/client-contract.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const client = readFileSync(path.join(root, 'client.js'), 'utf8')
const en = JSON.parse(readFileSync(path.join(root, 'locale/en.json'), 'utf8'))
const zh = JSON.parse(readFileSync(path.join(root, 'locale/zh.json'), 'utf8'))

function extractCatalog(source, name) {
  const token = `const ${name} = `
  const start = source.indexOf(token)
  assert.notEqual(start, -1, `missing ${name} catalog`)
  let i = start + token.length
  while (source[i] === ' ' || source[i] === '\n') i += 1
  assert.equal(source[i], '{', `${name} catalog must be an object literal`)
  let depth = 0
  let inString = false
  let escaped = false
  for (let j = i; j < source.length; j += 1) {
    const ch = source[j]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return JSON.parse(source.slice(i, j + 1))
    }
  }
  throw new Error(`unterminated ${name} catalog`)
}

const embeddedEn = extractCatalog(client, 'EN')
const embeddedZh = extractCatalog(client, 'ZH')
assert.deepEqual(embeddedEn, en, 'client EN catalog drifted from locale/en.json')
assert.deepEqual(embeddedZh, zh, 'client ZH catalog drifted from locale/zh.json')

function flatten(value, prefix = '', out = []) {
  for (const [key, child] of Object.entries(value)) {
    const next = prefix ? `${prefix}.${key}` : key
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, next, out)
    else out.push(next)
  }
  return out
}

const keys = new Set(flatten(en))
const required = [
  'list.search',
  'list.newBot',
  'attention.needs',
  'attention.unread',
  'attention.working',
  'approval.title',
  'approval.allowOnce',
  'approval.deny',
  'approval.waits',
  'approval.expires',
  'approval.expired',
  'approval.irreversible',
  'approval.outside',
  'approval.originChat',
  'approval.originBackground',
  'approval.riskOutside',
  'approval.riskIrreversible',
  'chat.working',
  'chat.simulatedReply',
  'chat.simulatedSnippet',
  'chat.simulatedApprovalTitle',
  'chat.simulatedApprovalMeta',
  'chat.simulatedTarget',
  'draft.send',
  'draft.discard',
  'details.recent',
  'details.recentEmpty',
  'details.recentEmptyHint',
  'details.upcoming',
  'details.computer',
  'details.usage',
  'routine.emptyHint',
  'library.emptyHint',
  'computer.live',
  'computer.reconnecting',
  'computer.sleeping',
  'computer.unreachable',
  'computer.takeOver',
  'notice.recovering',
  'notice.sleeping',
  'cost.low',
  'cost.lowShort',
  'error.hostDown',
  'persona.template',
]
for (const key of required) assert.equal(keys.has(key), true, `missing copy-deck key ${key}`)

assert.equal(zh.approval.allowOnce, '仅批准这一次')
assert.equal(zh.approval.deny, '拒绝')
assert.equal(zh.approval.warning, '这会把数据发到你的电脑之外，且无法撤销。')
assert.equal(zh.sample.nora.user, '总结上周的 PR，并起草每周摘要。发布前等我确认。')
assert.equal(zh.notice.reconnecting, '电脑正在重连… 5 秒后重试')
assert.equal(zh.setup.signIn, '用 Rayrun 登录')
assert.equal(zh.newBot.title, '新建 Bot')
assert.equal(zh.settings.title, '设置')
assert.equal(en.newBot.defaultJob, zh.newBot.defaultJob)

assert.equal(client.includes('The bot layer is under construction'), false)
assert.equal(client.includes('A1 skeleton'), false)
assert.match(client, /M2\.97 12\.92A2 2 0 0 0 2 14\.63/)
assert.match(client, /stroke: '#003d9b'/)
assert.equal(client.includes('fetch('), false)
assert.equal(client.includes('localStorage'), false)
assert.equal(client.includes('sessionStorage'), false)
assert.equal(/console\.(log|debug|info|warn|error)\(/.test(client), false)
for (const screen of ['chat', 'newbot', 'setup', 'settings']) {
  assert.match(client, new RegExp(`data-screen': '${screen}'`))
}
assert.match(client, /data-screen': 'chat'[\s\S]*library/)
assert.match(client, /'data-state': approval\.state/)
assert.match(client, /approval\.state === 'expired'/)
assert.match(client, /t\('approval\.expired'\)/)
assert.match(client, /t\('approval\.expires', \{ n: approval\.expiresMin \}\)/)
assert.match(client, /rb-card-expired/)
assert.match(client, /FIRST_RUN_PREVIEW/)
assert.match(client, /state\.bots\.length === 0/)
assert.match(client, /rb-firstrun/)
assert.match(client, /rb-thread-welcome/)
assert.match(client, /kind === 'working'/)
assert.match(client, /rb-working-row/)
assert.match(client, /chat\.simulatedApprovalTitle/)
assert.match(client, /setTimeout\(/)
assert.match(client, /disabled: !!bot\.working/)
assert.match(client, /rb-card-fields/)
assert.match(client, /rb-chip/)
assert.match(client, /approval\.originChat/)
assert.match(client, /approval\.riskOutside/)
assert.match(client, /targetKey/)
assert.match(client, /risk: \['outside', 'irreversible'\]/)
assert.match(client, /function EmptyBlock/)
assert.match(client, /'data-empty': name/)
assert.match(client, /h\(EmptyBlock, \{ name: 'recent'/)
assert.match(client, /h\(EmptyBlock, \{ name: 'routines'/)
assert.match(client, /h\(EmptyBlock, \{ name: 'library'/)
assert.match(client, /details\.recentEmptyHint/)
assert.match(client, /routine\.emptyHint/)
assert.match(client, /library\.emptyHint/)
assert.match(client, /rb-count/)
assert.match(client, /count\(bot\.receipts\.length\)/)
assert.match(client, /count\(bot\.routines\.length\)/)
assert.match(client, /count\(items\.length\)/)
assert.match(client, /LOW_BALANCE_PREVIEW/)
assert.match(client, /COMPUTER_PREVIEW/)
assert.match(client, /computer: COMPUTER_PREVIEW/)
assert.match(client, /'data-state': status/)
assert.equal(client.includes('rb-st rb-st-${status}'), true)
assert.equal(client.includes("'data-low': low ? 'true' : 'false'"), true)
assert.equal(client.includes('rb-usage-low'), true)
assert.match(client, /function Notice/)
assert.match(client, /notice\.sleeping/)
assert.match(client, /computer === 'live'\) return null/)
assert.match(client, /rb-danger/)
assert.match(client, /function ChatList\(\{ t, state, rows, selected, searchRef, low,/)
assert.match(client, /low \? 'rb-textbtn rb-textbtn-low' : 'rb-textbtn'/)
assert.match(client, /low \? h\('span', \{ className: 'rb-dot rb-needs'/)
assert.match(client, /cost\.lowShort/)
assert.match(client, /const threadRef = useRef\(null\)/)
assert.match(client, /className: 'rb-thread', ref: threadRef/)
assert.match(client, /thread\.scrollTop = thread\.scrollHeight/)
assert.match(client, /\[bot\.id, bot\.messages\.length\]/)
assert.match(client, /autoFocus: true/)
assert.match(client, /focusComposer: false/)
assert.match(client, /focusComposer: true/)
assert.match(client, /const composerRef = useRef\(null\)/)
assert.match(client, /composerRef\.current\?\.focus\(\)/)
assert.match(client, /function Conversation\(\{ t, state, bot, composerRef,/)
assert.match(client, /ref: composerRef/)
assert.match(client, /function SettingsScreen\(\{ t, state, onTab, onChange, onClose, onSetup \}\)/)
assert.equal(client.includes('rb-btn rb-ghost rb-back'), true)
assert.equal(client.includes("'aria-label': t('setup.back')"), true)

console.log('client contract ok')
