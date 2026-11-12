# UI design — v0.1

*Status: 2026-11-12. The client follows the shape of Grok Bot's desktop app (as
captured in the 2026-11-09 docs snapshot): bot roster in the sidebar, chat as the
main surface, a computer preview in the right-hand panel, and approval cards
inline in the chat. This is the design for the DSH plugin client; the clickable
reference is [`docs/mockups/index.html`](mockups/index.html). Related:
[client-plan.md](client-plan.md) (surfaces, RPC), [mvp-plan.md](mvp-plan.md)
(approval semantics), [local-file-design.md](local-file-design.md) (state).*

Rendered previews: [conversation](mockups/conversation.png) · [approvals](mockups/approvals.png) · [library](mockups/library.png) · [setup](mockups/setup.png) · [settings](mockups/cost-settings.png).

## 0. Principles

1. **Chat-first, Grok-shaped.** The conversation is the product; everything else
   (roster, approvals, library, settings) hangs off it. No dashboard, no separate
   app shell inside DSH.
2. **Three panes on desktop.** Bot roster (left) · conversation (center) ·
   computer preview (right, collapsible). This is the Grok Bot desktop shape.
3. **Attention is a tri-state in the roster**, exactly like Grok Bot: **needs
   attention** (question, approval, handoff), **unread activity** (a new result),
   **working or typing**. Opening the conversation marks it read.
4. **Cards, not pages, where Grok uses cards.** Approvals, editable drafts and
   tool/computer activity render as cards inside the conversation; a dedicated
   inbox exists only as an attention filter, not as the primary surface.
5. **The computer is visible.** A right-hand preview shows what the bot's
   computer is doing; "open computer" and "take over" are one click away.
6. **Honest states.** Reconnecting, could-not-reach, expired approval, low
   balance, missing dependency: each is one sentence above the composer plus one
   action. No fake success.
7. **English source, zh mirror.** All strings in `locale/en.json` and
   `locale/zh.json`; identifiers untranslated.
8. **Keyboard-first.** Visible focus; Enter sends; Escape closes cards/dialogs;
   approval state changes announced via `aria-live`.

## 1. App shell

```
┌──────────────┬───────────────────────────────────────┬──────────────────┐
│ Rayrun Bot + │  ◉ weekly-watch      working          │  Computer        │
│              │  dsh-workspace · ¥3.10 today          │  ● live          │
│ ◉ weekly-    │ ─────────────────────────────────────  │ ┌──────────────┐ │
│   watch   ●  │  … transcript, tool activity,          │ │  desktop     │ │
│ ◔ inbox-     │    created files, approval cards,      │ │  preview     │ │
│   triage  ◔  │    draft cards, questions…             │ └──────────────┘ │
│ ○ docs-      │                                        │ [Open ↗] [Take  │
│   refresh ◉  │  ⚠ Computer reconnecting… retrying     │  over]          │
│              │ ┌────────────────────────────────────┐ │                  │
│ ─────────    │ │ Ask weekly-watch…            [Send]│ │                  │
│ Approvals ②  │ └────────────────────────────────────┘ │                  │
│              │                                        │                  │
│ ⚙ Settings   │                                        │                  │
│ dsh-workspace│                                        │                  │
│ ¥41.20       │                                        │                  │
└──────────────┴───────────────────────────────────────┴──────────────────┘
```

- **Left — roster.** Pinned/primary bot first, then the rest ordered by attention
  (needs attention → unread → working → idle). Each row: avatar, name, optional
  label, status dot + text. `+` creates a bot. Row menu (right-click or ⋯):
  rename, pin, hide from sidebar, delete. "Approvals" row is an attention filter
  with a count. Footer: computer status, balance, settings.
- **Center — conversation.** Bot name at top opens the details panel (Details /
  Library tabs). Transcript mixes messages, tool activity, computer use, created
  files, questions, approval cards and draft cards — Grok Bot's transcript is an
  activity log, ours is too. Composer at the bottom, notices above it.
- **Right — computer preview.** Collapsible panel; a thumbnail of the desktop,
  status (live / reconnecting / couldn't reach), "Open computer" and "Take over".
  Leaving the preview does not stop work.

## 2. Screens and components

### 2.1 Roster (left sidebar)

| State | Dot | Text |
| --- | --- | --- |
| needs attention | amber | `needs attention` |
| unread activity | blue | `unread` |
| working / typing | green pulse | `working` |
| idle | gray | `idle` |
| recovering | amber outline | `recovering` |

Behaviors: opening a bot marks activity read; pin keeps it on top; hide removes
it from the sidebar without deleting work; delete is destructive and separate
from hide (Grok Bot makes the same distinction, `bots.md:105-121,172-181`). A
"primary bot" that proactively checks in is a Grok Bot concept — P1 for us; in
v0.1 the top row is simply the pinned or most-recently-attended bot.

### 2.2 Conversation

- Header: avatar, name, label, attention state, computer name, today's spend.
- Transcript cards: message, tool activity line (`ran shell in dsh-workspace`),
  created file card, question card, approval card, draft card, error notice.
- Composer: attach, message, send; disabled with a reason while the bot host is
  recovering. "Stop now" sends a direct message that takes priority over
  background work (`chat-and-collaboration.md:109-115`).
- Notices above the composer: one line + one action (Grok Bot puts errors above
  the composer under **Notifications**, `settings-and-notifications.md:239-247`).

### 2.3 Approval card

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠ Needs approval · publish draft                             │
│ Publish "Week 45 digest" to Feishu #weekly                   │
│ This shares data outside your computer.                      │
│ requested 09:13 · waits for you (started from this chat)     │
│                         [Allow once] [Always allow¹] [Deny]  │
└──────────────────────────────────────────────────────────────┘
¹ Always allow saves an Auto Review rule — v0.2, disabled in v0.1.
```

- Buttons follow Grok Bot's vocabulary: **Allow once**, **Always allow** (writes
  a Custom Rule; not in v0.1), **Deny** (`approvals-security-and-privacy.md:45-57`).
- Warning labels reuse Grok Bot's phrasing: "This can't be undone", "This shares
  data outside your computer", "This changes sign-in or security settings"
  (`approvals-security-and-privacy.md:39-43`).
- **Unanswered:** a card raised by a chat message waits with no timer; a card
  raised by background work (routine, webhook) expires after 30 minutes and shows
  **Expired** (`approvals-security-and-privacy.md:72-83`). Our approval schema
  carries `origin: "chat" | "background"` to model this.
- Deny means the bot does not retry that action until the user sends another
  message; it never silently downgrades to approve.

### 2.4 Draft card

Outgoing messages (email, chat, publish) are editable drafts marked **Needs
approval** with **Send** and **Discard** before anything leaves the computer
(`chat-and-collaboration.md:89-107`). v0.1 shows the card for the gated-send
actions we support; the "disable drafts for this bot" switch is v0.2.

### 2.5 Bot details and Library

Clicking the bot name opens details: name, label, avatar (P1), the bot's job
(instructions), computer assignment; tabs **Details** and **Library**. The
Library lists artifacts the bot made, newest first under **Today**, **This
week**, **Older**, with **Pinned** on top and **Show more** per group — the same
grouping Grok Bot uses (`files-and-results.md:246-253`). Library is P1 in v0.1;
the tab is designed now so the data model keeps artifacts attributable to a bot.

### 2.6 Approvals inbox

Our addition, because a pending approval must be answerable without hunting
through chats. Two panes: attention list (needs attention first, then background
cards with expiry) and detail with the same card actions. History keeps request
id, bot, decision and time — no payloads. Grok Bot's sidebar tri-state already
surfaces attention; our inbox is that state, filterable.

### 2.7 Setup

Grok Bot's first run is sign-in → short intro → first bot created and chat
opened (`get-started.md:48-57`). Ours keeps that feel but adds the BYO steps we
need: ① dependency check → ② Rayrun sign-in → ③ DeepSeek key → ④ first bot
(name, optional one-line job) → chat opens. Continue is disabled until the step
passes; skip leaves an attention banner.

### 2.8 Settings

Left sub-nav mirrors Grok Bot's settings groups: **Account** (Rayrun connection,
dependency health), **Usage & billing** (balance, machine hours, threshold),
**Auto-review** (placeholder until v0.2; explains that all external actions are
ask-first in v0.1), **Notifications** (per-bot on/off, attention tri-state note),
**Appearance** (language, theme follows DSH). One page, no marketing.

### 2.9 Computer preview states

live (thumbnail, open, take over) · reconnecting (spinner + "retrying in Ns") ·
couldn't reach (sentence + "Open computer anyway") · stopped (start computer) ·
takeover (banner "You have control — finish the step, then return control").
Takeover is one step, then handed back, matching Grok Bot's sensitive-step
handoff (`computer-and-apps.md:31-63`). In v0.1 the preview may be a link card to
the dependency plugin's desktop page if embedding is not verified (spike C-S5).

## 3. Alignment with Grok Bot

| Grok Bot pattern | Source (docs snapshot) | Our v0.1 |
| --- | --- | --- |
| Sidebar roster with attention tri-state | `settings-and-notifications.md:205-214` | copied: needs attention / unread / working (+ idle, recovering) |
| Chat-first conversation with activity transcript | `chat-and-collaboration.md:14-25` | copied: messages + tool/computer/file/approval cards |
| Approval card with Allow once / Always allow / Deny | `approvals-security-and-privacy.md:30-57` | Allow once + Deny now; Always allow reserved for Auto Review (v0.2) |
| Unanswered semantics: chat waits, background expires 30 min | `approvals-security-and-privacy.md:72-83` | copied via `origin` field |
| Editable draft marked Needs approval | `chat-and-collaboration.md:89-107` | copied for gated sends |
| Right-hand computer preview, open/take over | `computer-and-apps.md:31-63` | copied; preview may be a link card in v0.1 |
| Bot name opens details; Library grouped Today/Week/Older | `bots.md:77-103`; `files-and-results.md:246-253` | details in v0.1; Library P1 |
| Pin / hide / delete, primary bot | `bots.md:48-60,105-121` | pin/hide/delete v0.1; primary bot check-ins P1 |
| Errors above composer as notices | `settings-and-notifications.md:239-247` | copied |
| Sign-in → intro → first bot → chat | `get-started.md:48-57` | adapted with dependency + key steps |
| Settings: Account / Usage & billing / Auto-review / Notifications | `settings-and-notifications.md` | matched, Auto-review placeholder |
| Voice, group chat, X Chat, mobile, shared bots, templates, marketplace, Vault/Secure Form, Bot email | Grok Bot product surface | **out of v0.1** — listed in §9 |
| Auto Review rules engine | `approvals-security-and-privacy.md:99-104` | v0.2; v0.1 is ask-first for every external action |

## 4. Component inventory

| Component | Used on | Wave | Notes |
| --- | --- | --- | --- |
| `AppShell` | all | C1 | three panes, collapsible preview |
| `BotRoster` | shell | C2 | rows, attention dots, pin/hide/delete menu |
| `AttentionDot` | shell, inbox | C2 | 5 states, dot + text |
| `BotHeader` | conversation | C2 | avatar, name, label, computer, spend |
| `Transcript` | conversation | C2 | message/activity/file/question cards |
| `ApprovalCard` | conversation, inbox | C3 | Allow once / Always allow(disabled) / Deny, warnings, origin |
| `DraftCard` | conversation | C3 | editable draft, Send/Discard |
| `Composer` | conversation | C2 | attach, send, stop-now, disabled reasons |
| `Notice` | conversation | C1 | above composer, one action |
| `ComputerPreview` | shell | C4 | live/reconnecting/takeover states |
| `BotDetails` + `Library` | details | C5 | tabs, grouped artifacts |
| `SetupWizard` | setup | C4 | 4 steps, status per step |
| `ApprovalsInbox` | approvals | C3 | attention list + detail + history |
| `SettingsPage` | settings | C4 | Account/Usage/Auto-review/Notifications/Appearance |

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
| `approval.alwaysAllow` | Always allow | 始终允许 |
| `approval.alwaysAllowSoon` | Auto Review rules arrive in v0.2. | Auto Review 规则将在 v0.2 提供。 |
| `approval.deny` | Deny | 拒绝 |
| `approval.waits` | waits for you | 等你处理 |
| `approval.expires` | expires in {n} min | {n} 分钟后过期 |
| `approval.expired` | Expired — the bot did not do it | 已过期——Bot 没有执行 |
| `approval.irreversible` | This can't be undone. | 此操作无法撤销。 |
| `approval.outside` | This shares data outside your computer. | 这会把数据发到你的电脑之外。 |
| `approval.security` | This changes sign-in or security settings. | 这会改动登录或安全设置。 |
| `draft.needs` | Needs approval | 待批准 |
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

Grok Bot's desktop app is dark and near-monochrome, with color reserved for
attention states. We follow that, using DSH theme tokens where they exist.

| Token | Value (mockup fallback) | Use |
| --- | --- | --- |
| `bg` | `#0b0c0e` | app background |
| `panel` | `#121316` | sidebar, preview |
| `elevated` | `#191b1f` | cards, composer, menus |
| `text` | `#f4f5f7` | primary text |
| `muted` | `#9aa0aa` | secondary text |
| `border` | `#262a30` | separators, card edges |
| `primary` | `#f4f5f7` on `#0b0c0e` | primary buttons (white, Grok-style) |
| `attention` | `#e3a53a` | needs attention, warnings |
| `unread` | `#5b91f5` | unread dot |
| `success` | `#4ade80` | live / working |
| `danger` | `#f87171` | deny, irreversible warning |

Type: system stack; body 13–14 px; titles 17–20 px; mono for ids and commands.
Radii 10–12 px cards, 8 px controls. Motion 120 ms; honor
`prefers-reduced-motion`. Status is always dot + text, never color alone.

## 7. Accessibility and responsive

- Full keyboard path: roster → conversation → approval buttons; focus ring
  visible; Escape closes menus/cards.
- Approval state changes announced with `aria-live="polite"`; ticking countdowns
  are not announced.
- Contrast ≥ 4.5:1 for text; danger/attention colors paired with icons + words.
- Desktop-first: three panes ≥1200 px; preview collapses <1200 px; roster
  collapses to icons <900 px; single column below (read-only conversation).
  No mobile-native layout in v0.1.

## 8. Acceptance mapping

| Screen | Acceptance tasks |
| --- | --- |
| Setup (sign-in, key, first bot) | A1, A2, A3 |
| Roster attention states | A4, A9, A10 |
| Conversation + computer preview | A4, A5, A8 |
| Approval card + inbox | A6, A7, A11 |
| Settings / usage | A10 |
| Notices (recovering, low balance) | A1, A2, A9, A11 |

## 9. Out of scope for v0.1

Voice input/chat, group chats, X Chat, mobile layouts, shared bots, Bot
templates and marketplace, Vault/Secure Form, bot email addresses, Auto Review
rules (v0.2), "disable drafts per bot", primary-bot check-ins, custom themes,
artifact preview beyond links, and keyboard shortcuts beyond Enter/Escape.
