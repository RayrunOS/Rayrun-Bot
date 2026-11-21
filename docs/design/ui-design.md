# UI design — v0.1

*Status: 2026-11-21 (rev 6). The client copies the layout of Grok Bot's desktop
app as seen in the reference screenshot the user shared — one chat-list column, a
markdown conversation in the middle, a per-bot details panel on the right — in a
the visual language of rayrunos.com: white canvas, navy primary buttons, blue accents, hairline borders. Approvals are inline cards, not a separate
inbox. The clickable reference is [`docs/mockups/index.html`](../mockups/index.html);
append `#library`, `#newbot`, `#setup` or `#settings` to the URL for the other
screens. The mockups render the **zh-CN** locale; English copy in §5 is the source and ships alongside (`locale/en.json`, `locale/zh.json`); the default language follows DSH. Related: [client-plan.md](../plans/client-plan.md) (surfaces, RPC),
[mvp-plan.md](../plans/mvp-plan.md) (approval semantics), [bot-persona.md](bot-persona.md)
(names, voice), [local-file-design.md](../06-local-state.md) (state).*

Rendered previews: [conversation](../mockups/conversation.png) · [library](../mockups/library.png) · [new bot](../mockups/newbot.png) · [setup](../mockups/setup.png) · [settings](../mockups/cost-settings.png).

## 0. Principles

1. **Three columns, like the reference.** Chat list (left) · conversation
   (center) · per-bot details (right). Everything else is a form inside this
   shell; no separate dashboard.
2. **Chat list is the roster.** Search and `+` at the top, the current bot's
   avatar and name, then the other bots as rows with their latest snippet and
   time. Attention is a small dot, not a badge wall.
3. **Conversation is markdown.** Bot replies read like a colleague's written
   update — short paragraphs, lists, code spans — not a card dashboard. Timestamp
   separators appear when the day changes.
4. **The right panel belongs to the bot.** Activity (recent receipts), Upcoming
   (routines), Computer (state, preview, open/take over) and Usage. Tabs switch
   between Activity and Library.
5. **Approvals are inline cards.** An external action stops inside the
   conversation with its warning line and `Deny` / `Allow once`; the chat list
   shows a dot for the bot that needs attention. No dedicated inbox in v0.1.
6. **Warm, low-contrast light.** Off-white canvas, white cards, hairline
   borders, near-black text; color only for warnings, success and the status
   dots. Rayrun's mark is the only brand color.
7. **Honest states.** Reconnecting, couldn't reach, expired, missing dependency,
   low balance: one short line and one action. No fake success.
8. **English source, zh mirror; keyboard-first.** Strings in `locale/en.json` /
   `locale/zh.json`; Enter sends, Escape closes, focus always visible.

## 1. App shell

```
┌────────────────────┬───────────────────────────────────────┬──────────────────┐
│ ▣ Rayrun Bot  ⌕  + │                                       │      ◉ Nora      │
│                    │                                       │   weekly digest  │
│      ◉ Nora        │  … markdown conversation …            │  Activity Library│
│   weekly digest    │  Today 20:07                          │                  │
│   · working        │                                       │  RECENT          │
│                    │  Nora  weekly digest                  │  ┌────────────┐  │
│ ◉ Eli       09:13  │  The draft is ready. I kept it to…    │  │draft ready │  │
│   needs approval   │  · Scope…  · Draft…  · Next…          │  └────────────┘  │
│ ◉ June      08:40  │                                       │  UPCOMING        │
│   docs finished    │  ┌─────────────────────────────────┐  │  Weekly digest ⏻ │
│                    │  │ ⚠ Publish “Week 45 digest” …    │  │  COMPUTER        │
│                    │  │ This shares data outside…       │  │  dsh-workspace   │
│                    │  │          Deny   Allow once      │  │  [Open][Take over]│
│ HY Haoyi           │  └─────────────────────────────────┘  │  USAGE           │
│ Rayrun connected   │  ● Computer reconnecting… 5s          │  ¥41.20 · 38.4 h │
│                    │  ┌─────────────────────────────────┐  │                  │
│                    │  │ Message Nora…                 ↑ │  │                  │
└────────────────────┴───────────────────────────────────────┴──────────────────┘
```

Column widths: 296 px / flexible / 328 px. The details column collapses below
1120 px; the chat list collapses below 900 px.

### 1.1 Standalone Bots view

The client activates Bots on load (`ctx.layout.selectPanel('rayrun-bots')`), so
entry lands on the product surface; the page title becomes `Rayrun Bot`. While
the Bots main panel is active, the client renders `.rb-frame` as a fixed
full-viewport layer (`position: fixed; inset: var(--dsh-frame-chrome-top, 0) 0 0 0;
z-index: 10`). It covers the DSH sidebar and bottom bar, so the Rayrun Bot roster
is the leftmost column. DSH overlays (modals, z-index 20) stay above it. The Bots
view is the only product surface: there is no in-product Back to Harness control.
DSH remains the host; setup, Plugins, 云电脑 and Workspaces must be owned by Bots
(not implemented yet). Because the v0.1 surface is an in-memory preview, the
brand row carries a visible `Preview` pill; it goes away when real data replaces
the sample.

## 2. Screens

### 2.1 Chat list

- Top row: Rayrun mark and wordmark, `Preview` pill, search, `+` (new bot).
- Current bot block: 52 px avatar, name, `job · state`.
- Rows: 34 px avatar, name, one-line latest snippet, time; a 6 px dot marks
  needs attention (amber), unread (blue) or working (green). Opening a row marks
  it read.
- Empty roster: first-run copy plus a Create bot button; a search with no
  matches keeps `No matching bots`. Preview it with `?first-run=1` on the DSH
  page URL.
- Footer: the user's avatar, name, `Rayrun connected · balance`, settings gear.
  A low balance turns that line amber with an amber dot and a screen-reader
  label; the full top-up line stays in Usage.

### 2.2 Conversation

- Rich text messages with a 26 px avatar, name and job label; user messages are
  short right-aligned bubbles.
- A day separator (`Today 20:07`) opens each session.
- A new bot with no messages shows its avatar, name, job and
  `No messages yet`; the composer stays available.
- Sending a message shows a working row; after a short preview-only delay a
  simulated reply and a pending approval card appear. Nothing leaves the page.
  The thread scrolls to the newest entry on send, reply and bot switch.
- Approval and draft blocks are the only cards: thin border, white surface,
  origin/target chips, a risk line (`Outside your computer · Can't be undone`),
  `Deny` / `Allow once`, and a metadata line (`requested 20:07`).
- **Computer activity.** A thin row with a mini screen — `On the computer · Feishu #weekly — pasted the digest, waiting for approval` and a `View` button.
- Notices sit above the composer as one line with a dot. The line follows the
  computer state — reconnecting (amber), sleeping (quiet), unreachable (red) —
  and is absent while the computer is live; a flash message overrides it.
- Composer: `+` attach, input, dark circular send. The composer takes focus
  after a bot is created.

### 2.3 Details panel

Profile header (avatar, name, `job · computer`), then `Activity | Library` tabs.

**Activity** sections:

- **Recent** — receipts: task title, state (`ready` / `waiting` / `done`), time,
  artifact count and today's spend. A receipt is the "report back" surface.
- **Upcoming** — routines: one row per routine with title, schedule and a toggle.
  When every routine is off, a quiet `All routines are paused` line appears above
  the rows. v0.1 ships at most one routine (P1); the other rows illustrate the
  shape.
- **Computer** — a compact row near the bottom, like the reference: name and
  state (`live` / `reconnecting…` / `sleeping` / `unreachable`; `Not connected`
  when Rayrun is not configured) on the left with
  a colored dot (green / amber / gray / red), a small 44×30 screen thumbnail on
  the right, and `Open` / `Take over` / `Stop` right-aligned below. Stop appears
  only while the machine is live. No large preview in v0.1; Open starts or
  resumes the machine through the dependency's same-origin RPC, waits for
  `Running`, repairs the desktop service, opens `desktop_url` in a new tab, and
  shows the desktop password in a dismissible toast. Take over currently runs
  the same path. Stop asks for inline confirmation, calls `machine.action` with
  `stop`, and never destroys. Each failure gets one line: not connected, no
  machine, popup blocked, start timeout, no desktop, stop timeout, or stop
  failure. Preview the states with
  `?computer=live|reconnecting|sleeping|unreachable`.
- **Usage** — balance, machine-hours, this week's spend, idle-stop policy. The
  balance turns amber and a low-balance line appears below the threshold;
  preview it with `?low-balance=1`.

**Library** groups artifacts under Today / This week / Older; each row is a file,
image or link with one muted subline. P1 in v0.1.

Filled sections show their item count next to the section header. Empty Recent,
Upcoming or Library sections render a dashed block with one state line and one
hint about when content appears; no dead action button.

### 2.4 New bot

The `+` opens a small form, not a wizard: monogram preview, **Name**, **Job, one
line**, **Instructions, optional**, then `Cancel` / `Create bot`. The name field
is focused when the form opens. Defaults come from
[bot-persona.md](bot-persona.md); no personality picker.

### 2.5 Setup

Four thin steps on the same light canvas: Dependency · Rayrun · Computer ·
First bot. Current step shows one paragraph and its inputs; `Continue` enables
when the current step passes; `Skip for now` leaves the setup row in place. The
dependency step shows the installed cloud-computer plugin version
(`Installed · v…` / missing / incompatible) and the Rayrun Bot host health
(`Checking…` / `Loaded · v…` / `Not responding` with Retry). The Rayrun step
sends a pasted API token to the cloud-computer plugin's same-origin RPC and
shows the real balance and machine count; a rejected token gets one actionable
line. The computer step adopts an existing machine or creates one through the
plugin, with an optional DeepSeek key passed as its model credential; it says
the machine is billable and that Bots never destroys it. The first-bot step
remains preview-only.

### 2.6 Settings

Reached from the footer gear: Account (Rayrun connection, Rayrun Bot host
health, dependency health), Usage, Notifications, Appearance/language. The host
row shows the same-origin health state and offers Retry when the host does not
answer. Usage reads the cloud-computer plugin's `overview` through the same-origin
RPC: it shows balance, machine-hours and machine count when connected, and
`Connect Rayrun to see usage.` when not; the token is never in the page. A Back
control returns to the conversation; Escape does the same. There is no in-product
control that returns to the DSH shell (ADR-017). Plain rows with hairline
separators; no stat cards.

### 2.7 Approvals (inline only)

Cards render in the conversation where the action stopped. The chat list shows a
dot and the latest snippet says what waits. There is **no separate approvals
page in v0.1** — the earlier inbox is dropped to match the reference; the store
and RPC still expose the same list for future views.

Pending cards show `expires in N min` for background work (or `waits for you`
for chat-started work) plus `Deny` / `Allow once`. The background TTL decreases
once a minute; at zero the card becomes expired, loses its actions, and the
chat-list dot, snippet and time follow. Chat-started cards have no TTL. Expired cards
are muted, show `Expired — the bot did not act`, and have no actions. Answered
cards keep the local-only result line and no actions. The preview's background
card starts at one minute so the transition is observable.

## 3. Alignment with Grok Bot

| Grok Bot pattern | Source | Our v0.1 |
| --- | --- | --- |
| Chat list column: search, `+`, current bot, rows with snippet/time | reference screenshot, 2026-11-12 | copied |
| Center conversation as rich markdown with timestamp separators | reference screenshot | copied: paragraphs, lists, code spans |
| Right details panel per bot: profile, Activity/Library tabs, routines, computer | reference screenshot; `skills-routines-and-automations.md` | copied; usage section added, voice omitted |
| Inline approval card with Deny / allow | `approvals-security-and-privacy.md:30-57` | `Deny` / `Allow once`; `Always allow` deferred to Auto Review (v0.2) |
| Chat cards wait, background cards expire 30 min | `approvals-security-and-privacy.md:72-83` | copied via `origin` field |
| Editable draft marked Needs approval | `chat-and-collaboration.md:89-107` | copied |
| Computer preview with open/take over | `computer-and-apps.md:31-63` | small computer row at the bottom of the details panel, like the reference, plus activity rows in the conversation |
| Attention states in the list | `settings-and-notifications.md:205-214` | dots: needs attention / unread / working |
| Bot name, picture, job label; light persona | `bots.md:5-6,77-103`; [bot-persona.md](bot-persona.md) | copied; monogram avatar in v0.1 |
| Voice chat, group chats, mobile, shared bots, marketplace, Vault, Auto Review | Grok Bot product surface | out of v0.1 (§8) |

Two anchors: the reference screenshot decides the layout (three columns, chat-list rows, details panel); rayrunos.com decides the look (white canvas, light gray panels, navy primary buttons, blue active pills, hairline borders, dark navy terminal surfaces, blue geometric mark).

## 4. Component inventory

| Component | Used on | Wave | Notes |
| --- | --- | --- | --- |
| `AppShell` | all | C1 | three columns, collapsible details |
| `ChatList` | shell | C2 | search, `+`, current bot, rows, dots, footer |
| `ChatRow` | shell | C2 | avatar, name, snippet, time, attention dot |
| `Conversation` | center | C2 | markdown messages, day separators |
| `ApprovalCard` | conversation | C3 | Deny / Allow once, warning, origin, meta |
| `DraftCard` | conversation | C3 | editable, Discard / Send |
| `Composer` | center | C2 | attach, send, disabled reason |
| `Notice` | center | C1 | one line above the composer |
| `DetailsPanel` | right | C3 | profile, tabs |
| `ReceiptCard` | activity | C3 | task, state, time, artifacts, spend |
| `RoutineRow` | upcoming | C4 | title, schedule, toggle |
| `ComputerRow` | details (bottom) | C4 | name, state, small thumbnail, Open / Take over |
| `ComputerActivityRow` | conversation | C3 | mini screen, what the bot is doing, View |
| `UsageBlock` | details | C4 | balance, hours, week, idle stop |
| `NewBotForm` | newbot | C2 | name, job, instructions, monogram |
| `SetupWizard` | setup | C4 | four thin steps |
| `SettingsPage` | settings | C4 | account/usage/notifications/appearance |

## 5. Copy deck (source for `locale/en.json`)

| Key | English | 中文 |
| --- | --- | --- |
| `list.search` | Search | 搜索 |
| `list.newBot` | New bot | 新建 Bot |
| `attention.needs` | needs attention | 待你处理 |
| `attention.unread` | unread | 未读 |
| `attention.working` | working | 工作中 |
| `approval.title` | Needs approval | 需要审批 |
| `approval.allowOnce` | Allow once | 仅批准这一次 |
| `approval.deny` | Deny | 拒绝 |
| `approval.waits` | waits for you | 等你处理 |
| `approval.expires` | expires in {n} min | {n} 分钟后过期 |
| `approval.expired` | Expired — the bot did not act | 已过期——Bot 没有执行 |
| `approval.irreversible` | This can't be undone. | 此操作无法撤销。 |
| `approval.outside` | This shares data outside your computer. | 这会把数据发到你的电脑之外。 |
| `approval.originChat` | From this chat | 来自本对话 |
| `approval.originBackground` | From a routine | 来自定时任务 |
| `approval.riskOutside` | Outside your computer | 离开你的电脑 |
| `approval.riskIrreversible` | Can't be undone | 无法撤销 |
| `draft.send` | Send | 发送 |
| `draft.discard` | Discard | 丢弃 |
| `details.recent` | Recent | 最近 |
| `details.upcoming` | Upcoming | 即将进行 |
| `routine.paused` | All routines are paused. | 所有日程都已暂停。 |
| `details.computer` | Computer | 电脑 |
| `details.usage` | Usage | 用量 |
| `computer.live` | live | 在线 |
| `computer.reconnecting` | reconnecting… | 正在重连… |
| `computer.sleeping` | sleeping | 休眠 |
| `computer.unreachable` | Couldn't reach the computer. | 连不上电脑。 |
| `computer.takeOver` | Take over | 接管 |
| `notice.recovering` | The bot host is restarting. This conversation resumes on its own. | Bot host 正在重启，这个会话会自动恢复。 |
| `notice.sleeping` | Computer is sleeping. Open it in the cloud-computer plugin to wake it. | 电脑正在休眠。打开云电脑插件即可唤醒。 |
| `cost.low` | Balance is low — top up in the Rayrun console. Stop is safe; destroy is not. | 余额偏低——去 Rayrun 控制台充值。停机会保留磁盘，销毁不会。 |
| `cost.lowShort` | Balance low | 余额偏低 |

Approval and key copy never contains jokes; every error row has one next action.

## 6. Visual system

Two anchors: the reference screenshot decides the layout (§1–§3); rayrunos.com
decides the look. Captured from the Rayrun site and docs on 2026-11-12: white
canvas, very light gray panels, hairline gray borders, dark navy primary buttons,
blue links and active pills, dark navy terminal surfaces, a blue geometric logo
mark, and bold CJK-friendly headings.

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#ffffff` | app canvas |
| `list` | `#f7f8fa` | chat list, details panel |
| `main` | `#ffffff` | conversation canvas |
| `card` | `#ffffff` | approval, draft, receipt cards |
| `text` | `#0f172a` | primary text (slate/navy) |
| `muted` | `#5b6472` | secondary text |
| `faint` | `#8a93a3` | timestamps, hints |
| `border` | `#e4e8f0` | card and control borders |
| `border-soft` | `#eef1f6` | list separators |
| `primary` | `#0e2050` on `#ffffff` | primary buttons, send, toggles |
| `accent` | `#1d4ed8` | links, active rows, tabs |
| `accent-soft` | `#eaf1fd` | selected chat row |
| `success` | `#15803d` | done / working |
| `attention` | `#b45309` on `#fff7e6` | needs attention, warnings |
| `danger` | `#b42318` on `#fff5f4` | deny, irreversible warnings |
| `brand` | `#003d9b` | official Rayrun logo mark only |

Rules: white cards on light-gray panels; navy primary controls; blue reserved for
links, selected rows and tabs; amber only for warnings; one border weight and one
shadow level; radii 12 px cards / 9 px controls; no gradients or colored panels.
Brand: use the official Rayrun logo — the lucide **Boxes** mark shown in the rayrunos.com header, in `#003d9b`, plus the "Rayrun Bot" wordmark. The mockup inlines that official mark; the favicon variant (blue rounded square, white mark) is saved at [`docs/mockups/rayrun-logo.svg`](../mockups/rayrun-logo.svg) for packaging. Never redraw or restyle the mark; it is the only place the brand blue appears. Type: system stack with `PingFang SC` / `Microsoft YaHei` fallbacks;
14 px body, 13 px UI labels, 18 px page titles. Motion 120 ms; honor
`prefers-reduced-motion`. Light only in v0.1; dark follows DSH when available.

## 7. Accessibility and responsive

- Keyboard: search → rows → conversation → approval buttons; visible focus;
  Escape closes forms. Opening the new-bot form focuses its name field; creating
  a bot focuses the composer.
- Approval changes announced with `aria-live="polite"`; countdowns are silent.
- Contrast ≥ 4.5:1; dots always paired with an accessible label.
- Three columns ≥1120 px; details collapses below; list collapses below 900 px.
  No mobile-native layout in v0.1.

## 8. Out of scope for v0.1

Voice input/chat, group chats, X Chat, mobile layouts, shared bots, bot templates
and marketplace, Vault/Secure Form, bot email, Auto Review rules and
"Always allow" (v0.2), primary-bot check-ins, bot-to-bot handoff cards (v0.2
candidate, see [inspiration.md](../research/inspiration.md)), avatar upload or generation,
personality presets, custom themes, artifact preview beyond links, and keyboard
shortcuts beyond Enter/Escape.
