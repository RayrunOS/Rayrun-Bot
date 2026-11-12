# UI design — v0.1

*Status: 2026-11-12 (rev 3). The client follows Grok Bot's desktop app as closely
as a DSH plugin can: dark, near-monochrome, three panes, chat first, minimal
chrome. Rayrun contributes only its name and logo mark. The clickable reference
is [`docs/mockups/index.html`](mockups/index.html) — append `#approvals`,
`#library`, `#setup` or `#settings` to the URL to see the other screens. Related:
[client-plan.md](client-plan.md) (surfaces, RPC), [mvp-plan.md](mvp-plan.md)
(approval semantics), [local-file-design.md](local-file-design.md) (state).*

Rendered previews: [conversation](mockups/conversation.png) · [approvals](mockups/approvals.png) · [new bot](mockups/newbot.png) · [library](mockups/library.png) · [setup](mockups/setup.png) · [settings](mockups/cost-settings.png).

## 0. Principles

1. **Grok Bot, minimal.** Chat is the product; the shell is a roster, a
   conversation and a computer preview. No dashboards, no badges, no filled
   status pills, no second app frame inside DSH.
2. **Near-monochrome.** Black and gray surfaces, white text, white primary
   buttons. Color appears only as small status dots and warning lines.
3. **Three panes on desktop.** Bot roster (left) · conversation (center) ·
   computer preview (right, collapsible).
4. **Attention is a dot.** Needs attention, unread, working and idle are 6 px
   dots in the roster with an accessible label; words appear only in the
   conversation header and inbox.
5. **Cards only where Grok uses cards.** Approval, draft and activity rows are
   thin bordered blocks inside the conversation; everything else is plain text
   and hairline separators.
6. **Honest states.** Reconnecting, couldn't reach, expired, missing dependency,
   low balance: one short line and one action, never a fake success.
7. **English source, zh mirror.** Strings in `locale/en.json` / `locale/zh.json`;
   identifiers untranslated.
8. **Keyboard-first.** Visible focus, Enter sends, Escape closes menus; approval
   state changes announced via `aria-live`.
9. **Bots are colleagues, not characters.** A Name in Title Case, a one-line job
   label and a monogram avatar; no mascots, catchphrases or role-play. The voice
   is a restrained professional teammate — see [bot-persona.md](bot-persona.md).

## 1. App shell

```
┌──────────────┬───────────────────────────────────┬────────────────┐
│ ▣ Rayrun Bot │  ◉ weekly-watch ●                 │ Computer   ●   │
│              │  dsh-workspace · ¥3.10 today      │ ┌────────────┐ │
│ ◉ weekly- ●  │ ─────────────────────────────────  │ │  desktop   │ │
│   watch      │  … messages, one activity line,    │ │  preview   │ │
│ ◉ inbox-  ●  │    approval block, draft block …   │ └────────────┘ │
│   triage     │                                    │ dsh-workspace  │
│ ◉ docs-   ●  │  ● Computer reconnecting… 5s       │ [Open][Take over]
│              │ ┌────────────────────────────────┐ │                │
│ Approvals 2  │ │ Message weekly-watch…        ↑ │ │                │
│ Bot details  │ └────────────────────────────────┘ │                │
│ Settings     │                                    │                │
│              │                                    │                │
│ dsh-workspace · running                          │                │
│ ¥41.20 · 38.4 h                                  │                │
└──────────────┴───────────────────────────────────┴────────────────┘
```

Left: brand row, three bot rows (avatar, name, small label, status dot), then
`Approvals` (count), `Bot details`, `Settings`, and two muted footer lines.
Center: bot header (avatar, name, dot, `computer · today's spend`), transcript,
notices above the composer. Right: computer preview with status dot, a dark
desktop thumbnail, two buttons; leaving it does not stop work.

## 2. Screens

### 2.1 Roster

Rows are the whole roster UI. Status is a dot; the word lives in `title` and in
the conversation header. The `+` action for a new bot sits in the sidebar header
(next to the brand), matching Grok Bot's `+` in the sidebar.

| State | Dot | Notes |
| --- | --- | --- |
| needs attention | amber | question, approval or handoff waiting |
| unread | blue | new result since last open |
| working | green, slow pulse | task in progress |
| idle | gray | nothing queued |
| recovering | amber | bot host restarting |

Opening a bot clears unread. Pin / hide / delete stay in the row context menu
(v0.1: hide and delete only).

### 2.2 Conversation

- Header: 24 px avatar, name, status dot, and one muted line
  `dsh-workspace · ¥3.10 today`. A `⋯` menu holds hide/stop/delete.
- Messages are plain text; only the user's own message sits in a dark bubble.
- Tool and computer activity is one muted line: `● ran shell in dsh-workspace · 41s`.
- Approval and draft blocks are thin bordered cards (see below).
- Notices sit above the composer as one line with a dot, not a banner.
- Composer: attach glyph, input, white circular send button. Disabled with a
  reason while the host is recovering.

### 2.3 Approval block

```
┌────────────────────────────────────────────────────────┐
│ ⚠ Publish “Week 45 digest” to Feishu #weekly  waits    │
│ This shares data outside your computer.                │
│ inbox-triage · requested 09:13                         │
│                                    [ Deny ] [ Allow ]  │
└────────────────────────────────────────────────────────┘
```

- **Two actions in v0.1: Deny and Allow once.** Grok Bot's third option,
  **Always allow** (auto-review rule), is hidden until Auto Review exists in
  v0.2 — the UI does not show disabled controls.
- The warning line reuses Grok Bot's phrasing: "This can't be undone", "This
  shares data outside your computer", "This changes sign-in or security settings".
- **Unanswered:** a card raised by a chat message waits with no timer; a card
  raised by background work (routine, webhook) expires after 30 minutes and
  shows `Expired` — the bot does not act. Our approval schema carries
  `origin: "chat" | "background"` for this.
- Deny means the bot does not retry that action until the user sends another
  message.

### 2.4 Draft block

Outgoing messages render as an editable draft with `Discard` and `Send` before
anything leaves the computer. A muted `needs approval` label sits on the right.

### 2.5 Bot details and Library

Clicking the bot name opens details: name, label, computer, then two tabs,
**Details** and **Library**. Library groups artifacts under **Today**, **This
week**, **Older** — plain rows with type, name, one muted subline and a time.
Library is P1 in v0.1; the tab is designed now so artifacts stay attributable to
a bot.

### 2.6 Approvals inbox

Two panes, both quiet: left rows (title, subline, `waits` / `28 min` / `expired`),
right a bordered panel with the request title, one red warning line, four
key/value lines and `Deny` / `Allow once`. History is not shown in v0.1; the
audit log exists in the bot log.

### 2.7 Setup

Centered, no card: title, one-line subtitle, four thin progress bars with tiny
labels (Dependency · Rayrun · DeepSeek key · First bot), then the current step's
heading, one paragraph and its inputs. Continue is disabled until the step
passes; Skip leaves the setup row in place.

### 2.8 Settings

Left sub-nav: **Account**, **Usage & billing**, **Auto-review**, **Notifications**,
**Appearance**. One muted usage line, at most one notice, then plain rows with
hairline separators. No stat cards, no colored numbers.

### 2.9 Computer preview

Live / reconnecting / couldn't reach / stopped. A dark thumbnail, one meta line,
`Open` and `Take over`. Takeover is for one sensitive step, then handed back.

### 2.10 Bot identity and creation

Bots are colleagues: a Title Case display name (id stays kebab-case inside the
product), a one-line job label, a monogram avatar and a short instruction brief.
No description, bio or personality picker in v0.1. The `+` in the sidebar opens a
small creation form — Name, Job (one line), Instructions (optional), monogram
preview — with `Cancel` / `Create bot`. Full rules and the default instruction
template: [bot-persona.md](bot-persona.md).

## 3. Alignment with Grok Bot

| Grok Bot pattern | Source (2026-11-09 docs snapshot) | Our v0.1 |
| --- | --- | --- |
| Sidebar roster, attention states | `settings-and-notifications.md:205-214` | dots only: needs attention / unread / working / idle / recovering |
| Chat-first transcript with activity | `chat-and-collaboration.md:14-25` | messages, one-line activity, approval/draft blocks |
| Approval card: Allow once / Always allow / Deny | `approvals-security-and-privacy.md:30-57` | Allow once + Deny; Always allow deferred to Auto Review (v0.2) |
| Chat cards wait, background cards expire 30 min | `approvals-security-and-privacy.md:72-83` | copied via `origin` field |
| Editable draft, Needs approval | `chat-and-collaboration.md:89-107` | copied |
| Right-hand computer preview, open/take over | `computer-and-apps.md:31-63` | copied; preview may be a link card in v0.1 |
| Bot name opens details; Library by date | `bots.md:77-103`; `files-and-results.md:246-253` | copied; Library P1 |
| Name, picture, label; personal Bots stay light | `bots.md:5-6,77-103` | Title Case display name + job label + monogram avatar; no bio; creation form takes name/job/instructions ([bot-persona.md](bot-persona.md)) |
| Errors above composer as notices | `settings-and-notifications.md:239-247` | copied as one-line notices |
| Sign-in → intro → first bot → chat | `get-started.md:48-57` | adapted with dependency + key steps |
| Voice, group chats, X Chat, mobile, shared bots, templates, marketplace, Vault, bot email, Auto Review rules | Grok Bot product surface | out of v0.1 (§9) |

Rayrun's contribution is deliberately small: the wordmark and the blue logo mark
in the sidebar brand row. The earlier light "rayrunos.com" palette is dropped —
it read busy next to Grok Bot's quiet shell.

## 4. Component inventory

| Component | Used on | Wave | Notes |
| --- | --- | --- | --- |
| `AppShell` | all | C1 | three panes, collapsible preview |
| `BotRoster` | shell | C2 | rows, dots, context menu |
| `StatusDot` | shell, header, inbox | C2 | 5 states, `title` + `aria-label` |
| `BotHeader` | conversation | C2 | avatar, name, dot, computer · spend |
| `Transcript` | conversation | C2 | messages, activity line, blocks |
| `ApprovalBlock` | conversation, inbox | C3 | Deny / Allow once, warnings, origin |
| `DraftBlock` | conversation | C3 | editable, Discard / Send |
| `Composer` | conversation | C2 | attach, send, disabled reason |
| `Notice` | conversation | C1 | one line + one action |
| `ComputerPreview` | shell | C4 | live / reconnecting / take over |
| `BotDetails` + `Library` | details | C5 | tabs, date groups |
| `SetupWizard` | setup | C4 | 4 thin steps |
| `ApprovalsInbox` | approvals | C3 | list + panel |
| `SettingsPage` | settings | C4 | sub-nav + rows |

## 5. Copy deck (source for `locale/en.json`)

| Key | English | 中文 |
| --- | --- | --- |
| `attention.needs` | needs attention | 待你处理 |
| `attention.unread` | unread | 未读 |
| `attention.working` | working | 工作中 |
| `attention.idle` | idle | 空闲 |
| `attention.recovering` | recovering | 恢复中 |
| `approval.title` | Needs approval | 需要审批 |
| `approval.allowOnce` | Allow once | 仅批准这一次 |
| `approval.deny` | Deny | 拒绝 |
| `approval.waits` | waits for you | 等你处理 |
| `approval.expires` | expires in {n} min | {n} 分钟后过期 |
| `approval.expired` | Expired — the bot did not act | 已过期——Bot 没有执行 |
| `approval.irreversible` | This can't be undone. | 此操作无法撤销。 |
| `approval.outside` | This shares data outside your computer. | 这会把数据发到你的电脑之外。 |
| `approval.security` | This changes sign-in or security settings. | 这会改动登录或安全设置。 |
| `draft.send` | Send | 发送 |
| `draft.discard` | Discard | 丢弃 |
| `roster.hide` | Hide from sidebar | 从侧边栏隐藏 |
| `roster.delete` | Delete bot… | 删除 Bot… |
| `computer.live` | live | 在线 |
| `computer.reconnecting` | reconnecting… | 正在重连… |
| `computer.unreachable` | Couldn't reach the computer. | 连不上电脑。 |
| `computer.takeOver` | Take over | 接管 |
| `computer.done` | Return control | 交还控制 |
| `notice.recovering` | The bot host is restarting. This conversation resumes on its own. | Bot host 正在重启，这个会话会自动恢复。 |
| `cost.low` | Balance is low — top up in the Rayrun console. Stop is safe; destroy is not. | 余额偏低——去 Rayrun 控制台充值。停机会保留磁盘，销毁不会。 |

Approval and key copy never contains jokes; every error row has one next action.

## 6. Visual system

Dark, near-monochrome, hairline borders, one accent: the Rayrun logo mark.

| Token | Value | Use |
| --- | --- | --- |
| `bg` | `#0a0a0b` | app canvas |
| `side` | `#0c0c0d` | sidebar, preview |
| `panel` | `#101012` | cards, composer |
| `hover` | `#161618` | row hover |
| `selected` | `#1a1a1d` | active row |
| `text` | `#ececee` | primary text |
| `muted` | `#8d8d93` | secondary text |
| `faint` | `#5d5d64` | timestamps, hints |
| `border` | `#1f1f22` | card and control borders |
| `border-soft` | `#17171a` | separators |
| `primary` | `#ececee` on `#0a0a0b` | primary buttons (white) |
| `attention` | `#c8a45c` | needs attention, warning lines |
| `unread` | `#7d9fd0` | unread dot |
| `success` | `#63c68d` | working / live dot |
| `danger` | `#e0736a` | deny, irreversible warning |
| `brand` | `#4f7cf0` | Rayrun logo mark only |

Rules:

- No filled status pills, no colored card backgrounds, no gradients. Color only
  in dots, one-word labels and warning lines.
- One border weight (`1px`), one shadow level at most (menus/popovers).
- White primary button, ghost secondary; danger is text-only.
- Brand: official Rayrun mark + "Rayrun Bot" wordmark; the mark is the only place
  `brand` blue appears. Use the official asset when available; the mockup
  approximates the mark.
- Type: system stack with `PingFang SC` / `Microsoft YaHei` fallbacks; body
  12–13 px, headers 14–17 px, sparse bolding.
- Radii 7–10 px; motion 120 ms, honor `prefers-reduced-motion`; status is always
  dot + accessible label, never color alone.
- Dark only in v0.1; light mode follows DSH when available.

## 7. Accessibility and responsive

- Full keyboard path: roster → conversation → approval buttons; visible focus;
  Escape closes menus.
- Approval changes announced with `aria-live="polite"`; countdowns are not
  announced.
- Contrast ≥ 4.5:1 for text; dots always paired with an accessible label.
- Desktop-first: three panes ≥1120 px; preview collapses below; roster collapses
  below 900 px. No mobile-native layout in v0.1.

## 8. Acceptance mapping

| Screen | Acceptance tasks |
| --- | --- |
| Setup | A1, A2, A3 |
| Roster + dots | A4, A9, A10 |
| Conversation + preview | A4, A5, A8 |
| Approval block + inbox | A6, A7, A11 |
| Settings / usage | A10 |
| Notices | A1, A2, A9, A11 |

## 9. Out of scope for v0.1

Voice input/chat, group chats, X Chat, mobile layouts, shared bots, bot templates
and marketplace, Vault/Secure Form, bot email, Auto Review rules and
"Always allow" (v0.2), primary-bot check-ins, bot-to-bot handoff cards (v0.2
candidate, see [inspiration.md](inspiration.md)), avatar upload or generation,
personality presets, custom themes, artifact preview beyond links, and keyboard
shortcuts beyond Enter/Escape.
