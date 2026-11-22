/**
 * Client-shell contract.
 *
 * The page is one file, so the locale catalogs are embedded next to
 * locale/en.json and locale/zh.json. This check keeps those copies identical,
 * requires the v0.1 copy deck, and refuses a client that still shows the A1
 * placeholder or reaches off the machine. The only requests are the same-origin
 * host health check, the host roster/session RPC, and the cloud-computer
 * plugin's same-origin RPC.
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
  'chat.sendFailed',
  'chat.runtimeUnavailable',
  'chat.historyFailed',
  'chat.turnTimeout',
  'chat.turnInterrupted',
  'empty.threadReal',
  'draft.send',
  'draft.discard',
  'details.recent',
  'details.recentEmpty',
  'details.recentEmptyHint',
  'details.upcoming',
  'details.computer',
  'details.usage',
  'routine.emptyHint',
  'routine.paused',
  'library.emptyHint',
  'computer.live',
  'computer.reconnecting',
  'computer.sleeping',
  'computer.unreachable',
  'computer.takeOver',
  'computer.open',
  'computer.noMachine',
  'computer.noMachineShort',
  'computer.stop',
  'computer.stopConfirm',
  'computer.stopConfirmAction',
  'computer.cancel',
  'computer.stopping',
  'computer.stopped',
  'computer.stopTimeout',
  'computer.stopFailed',
  'computer.connectFirst',
  'computer.popupBlocked',
  'computer.starting',
  'computer.startTimeout',
  'computer.noDesktop',
  'computer.openFailed',
  'computer.opened',
  'computer.passwordTitle',
  'computer.passwordBody',
  'computer.passwordEmpty',
  'computer.copy',
  'computer.copied',
  'computer.copyFailed',
  'computer.close',
  'usage.liveLine',
  'preview.badge',
  'setup.computerTitle',
  'setup.computerExisting',
  'setup.computerNeedsRayrun',
  'setup.computerLoadFailed',
  'setup.computerCreate',
  'setup.computerCreated',
  'setup.computerCreateFailed',
  'setup.computerCost',
  'notice.recovering',
  'notice.sleeping',
  'cost.low',
  'cost.lowShort',
  'settings.setup',
  'settings.usageHint',
  'settings.usageLine',
  'settings.usageConnect',
  'settings.usageFailed',
  'settings.host',
  'settings.hostHint',
  'settings.hostChecking',
  'settings.hostLoaded',
  'settings.hostReady',
  'settings.retry',
  'error.hostDown',
  'error.botCreate',
  'persona.template',
]
for (const key of required) assert.equal(keys.has(key), true, `missing copy-deck key ${key}`)

assert.equal(zh.approval.allowOnce, '仅批准这一次')
assert.equal(zh.approval.deny, '拒绝')
assert.equal(zh.approval.warning, '这会把数据发到你的电脑之外，且无法撤销。')
assert.equal(zh.sample.nora.user, '总结上周的 PR，并起草每周摘要。发布前等我确认。')
assert.equal(zh.notice.reconnecting, '电脑正在重连… 5 秒后重试')
assert.equal(zh.setup.useToken, '使用 API Token')
assert.equal(zh.setup.steps.key, '云电脑')
assert.equal(zh.setup.connectedShort, '已连接')
assert.equal(zh.newBot.title, '新建 Bot')
assert.equal(zh.settings.title, '设置')
assert.equal(en.newBot.defaultJob, zh.newBot.defaultJob)

// Chinese is the primary UI language: it is the fallback for an unknown locale,
// while an explicit DSH or in-product choice still wins.
const resolveSource = client.match(/function resolveLang\(dshId, override\) \{[\s\S]*?\n    \}/)
assert.ok(resolveSource, 'missing resolveLang')
const resolveLang = new Function(`${resolveSource[0]}\nreturn resolveLang`)()
assert.equal(resolveLang('', ''), 'zh', 'unknown locale falls back to Chinese')
assert.equal(resolveLang('zh-CN', ''), 'zh')
assert.equal(resolveLang('en-US', ''), 'en')
assert.equal(resolveLang('en-US', 'zh'), 'zh', 'the in-product choice wins over DSH')
assert.equal(resolveLang('zh-CN', 'en'), 'en')
assert.match(client, /inject: \['slots', 'locale'\]/, 'the client waits for the DSH locale service')
assert.match(client, /getLocale\?\.\(\)\?\.active/, 'reads the active locale from the DSH snapshot')
assert.equal(client.includes('getLocale?.()?.id'), false, 'DSH locale snapshots have no id field')
assert.match(client, /locale\.setLocale\(partial\.lang\)/, 'language choice is written back to DSH')
const zhOption = client.indexOf("h('option', { value: 'zh' }")
const enOption = client.indexOf("h('option', { value: 'en' }")
assert.ok(zhOption !== -1 && enOption !== -1 && zhOption < enOption, 'Chinese option comes first')

assert.equal(client.includes('The bot layer is under construction'), false)
assert.equal(client.includes('A1 skeleton'), false)
assert.match(client, /M2\.97 12\.92A2 2 0 0 0 2 14\.63/)
assert.match(client, /stroke: '#003d9b'/)
assert.equal((client.match(/fetch\(/g) || []).length, 2)
assert.match(client, /fetch\('\/plugins\/rayrun-bots\?action=health'/)
assert.match(client, /fetch\(path, \{[\s\S]*?method: 'POST'/)
assert.match(client, /pluginRpc\('\/plugins\/rayrun\/rpc'/)
assert.match(client, /pluginRpc\('\/plugins\/rayrun-bots'/)
assert.match(client, /hostRpc\('bots\.list'\)/)
assert.match(client, /hostRpc\('bots\.create'/)
assert.match(client, /bots\.create returned no bot/)
assert.match(client, /hostRpc\('session\.history'/)
assert.match(client, /tail: true/)
assert.match(client, /hostRpc\('session\.send'/)
assert.match(client, /sessionErrorText/)
assert.match(client, /sessionWorking\(/)
assert.match(client, /applySession/)
assert.match(client, /appendSessionError/)
assert.match(client, /SESSION_POLL_MS/)
assert.match(client, /SESSION_POLL_LIMIT_MS/)
assert.match(client, /kind === 'error'/)
assert.match(client, /empty\.threadReal/)
assert.match(client, /source: 'real'/)
assert.match(client, /machine\.password/)
assert.match(client, /overview\.connection\?\.configured !== true/)
assert.match(client, /machine\.desktopRepair/)
assert.match(client, /verb: 'stop'/)
assert.equal(client.includes("'destroy'"), false)
assert.match(client, /machine\.create/)
assert.match(client, /machines\.find\(\(item\) => item\.name === name\)/)
assert.match(client, /const pickMachine =/)
assert.match(client, /item\.remote_desktop && item\.desktop_url/)
assert.match(client, /machineStatus\(machine\.status\)/)
assert.match(client, /realOverview/)
assert.match(client, /realMachine/)
assert.match(client, /modelKey/)
assert.match(client, /disabled: machineBusy \|\| !computerName\.trim\(\)/)
assert.equal(client.includes('setup.keySave'), false)
assert.equal(client.includes('setup.keyIgnored'), false)
assert.equal(client.includes('settings.connected'), false)
assert.match(client, /desktop_url/)
assert.match(client, /window\.open\(/)
assert.match(client, /mode: 'same-origin'/)
assert.match(client, /credentials: 'same-origin'/)
assert.match(client, /cache: 'no-store'/)
assert.match(client, /signal: controller\.signal/)
assert.match(client, /AbortController/)
assert.match(client, /body\.plugin !== 'rayrun-bots'/)
assert.match(client, /if \(!response\.ok\) throw/)
assert.match(client, /const body = await response\.json\(\)/)
assert.match(client, /version: String\(body\.version \?\? ''\), ready: body\.ready === true/)
assert.doesNotMatch(client, /Authorization|Bearer\s/)
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
assert.match(client, /!computer \|\| computer === 'live'\) return null/)
assert.match(client, /PREVIEW\.get\('computer'\)\s*: null/)
assert.match(client, /rb-danger/)
assert.match(client, /function ChatList\(\{ t, state, rows, selected, searchRef, low,/)
assert.match(client, /low \? 'rb-textbtn rb-textbtn-low' : 'rb-textbtn'/)
assert.match(client, /low \? h\('span', \{ className: 'rb-dot rb-needs'/)
assert.match(client, /cost\.lowShort/)
assert.match(client, /const threadRef = useRef\(null\)/)
assert.match(client, /className: 'rb-thread', ref: threadRef/)
assert.match(client, /thread\.scrollTop = thread\.scrollHeight/)
assert.match(client, /\[bot\.id, bot\.messages\.length, bot\.session\?\.lastSeq\]/)
assert.match(client, /autoFocus: true/)
assert.match(client, /focusComposer: false/)
assert.match(client, /focusComposer: true/)
assert.match(client, /const composerRef = useRef\(null\)/)
assert.match(client, /composerRef\.current\?\.focus\(\)/)
assert.match(client, /function Conversation\(\{ t, state, bot, composerRef,/)
assert.match(client, /ref: composerRef/)
assert.match(client, /function SettingsScreen\(\{ t, lang, state, host, onRetryHost, onTab, onChange, onClose, onSetup \}\)/)
assert.match(client, /position: fixed; inset: var\(--dsh-frame-chrome-top, 0px\) 0 0 0; z-index: 10;/)
assert.equal(client.includes('backToDsh'), false)
assert.match(client, /child\.layout\.selectPanel\(PANEL_ID\)/)
assert.match(client, /document\.title = 'Rayrun Bot'/)
assert.match(client, /className: 'rb-preview-pill'/)
assert.equal(client.includes('rb-btn rb-ghost rb-back'), true)
assert.equal(client.includes("'aria-label': t('setup.back')"), true)
assert.match(client, /function HostStatus/)
assert.equal(client.includes("'data-host': 'checking'"), true)
assert.equal(client.includes("'data-host': 'loaded'"), true)
assert.equal(client.includes("'data-host': 'down'"), true)
assert.match(client, /settings\.hostLoaded/)
assert.match(client, /settings\.retry/)
assert.match(client, /function tickApprovals/)
assert.match(client, /setInterval\(\(\) => setState\(tickApprovals\), 60 \* 1000\)/)
assert.match(client, /state: 'expired', expiresMin: 0/)
assert.match(client, /bot\.attention === 'needs' && !stillPending/)
assert.match(client, /snippetKey: botExpired && !stillPending \? 'approval\.expired'/)
assert.match(client, /time: botExpired && !stillPending \? clock\(\) : bot\.time/)
assert.match(client, /Number\.isFinite\(approval\.expiresMin\)/)
assert.match(client, /const routinesPaused = bot\.routines\.length > 0 && bot\.routines\.every\(\(routine\) => !routine\.on\)/)
assert.equal(client.includes("'data-paused': 'true'"), true)
assert.match(client, /t\('routine\.paused'\)/)
assert.match(client, /rb-paused/)

console.log('client contract ok')
