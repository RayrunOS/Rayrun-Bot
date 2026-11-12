# UI design — v0.1

*Status: 2026-11-12. The screens, states and copy for the DSH web client. The
static reference is [`docs/mockups/index.html`](mockups/index.html) — open it in a
browser to see the five screens. This complements [client-plan.md](client-plan.md)
(surfaces, RPC) and [local-file-design.md](local-file-design.md) (state).*

Rendered previews: [roster](mockups/roster.png) · [bot detail](mockups/bot.png) · [approvals](mockups/approvals.png) · [setup](mockups/setup.png) · [cost & settings](mockups/cost-settings.png).

## 0. Principles

1. **Inside DSH, not a second app.** One sidebar entry ("Bots") and a few pages
   inside the DSH shell. No custom top-level app chrome, no second login.
2. **Status in one glance.** Bot state, pending approvals, machine state and
   balance are visible from the roster without clicking.
3. **Approval-first.** Pending approvals are the loudest element on any screen;
   default-deny is stated in plain words; no jokes in approval copy.
4. **Honest states.** Every screen has loading, empty, error and recovering
   states, each with one sentence and one action. No fake success, no dead ends.
5. **Quiet density.** Desktop-first (≥1024 px), content max-width, no dashboard
   walls or decorative charts in v0.1.
6. **English source, zh mirror.** Every string in `locale/en.json` and
   `locale/zh.json`; identifiers stay untranslated.
7. **Keyboard-first.** Visible focus, Enter/Space on cards, Escape closes
   dialogs, approvals announced with `aria-live`.

## 1. Navigation map

```
DSH sidebar
└── Bots                         (badge = pending approvals)
    ├── Roster                   default page
    ├── Bot detail               per bot, from a roster card
    ├── Approvals                badge on the nav item too
    ├── Setup                    first run, or from the setup banner
    └── Cost & settings          tab on the Bots page
DSH Settings → Plugins → Rayrun Bot    (P1 row, same settings form)
```

Entry rules: first run opens **Setup**; if setup is incomplete, the roster shows a
banner that links back to the failing step; the approvals badge is global and
never cleared without a decision.

## 2. Screens

### 2.1 Setup wizard (first run)

```
┌──────────────────────────────────────────────────────────────┐
│  Set up Rayrun Bot                                        ×  │
│                                                              │
│  ① Dependency   ② Rayrun   ③ DeepSeek key   ④ First bot      │
│  ●──────────────○──────────────○──────────────○             │
│                                                              │
│  Step 2 of 4 — Connect Rayrun                                │
│  Rayrun supplies the cloud computers. Sign in with your own  │
│  account; the token is stored in the DSH vault, never here.  │
│                                                              │
│  [ Sign in with Rayrun ]        status: not connected        │
│  …or paste an API token: [••••••••••••]  [ Connect ]         │
│                                                              │
│  account: —                    balance: —                    │
│                                                              │
│  [ Back ]                                        [ Continue ]│
└──────────────────────────────────────────────────────────────┘
```

Steps: ① dependency (`dsh-rayrun-computer` installed and compatible) → ② Rayrun
account → ③ DeepSeek key stored as a Rayrun credential → ④ create a computer and
the first bot. Each step shows a status line and a link to the page that fixes it
(sign-in and machine creation belong to the dependency's UI). "Continue" is
disabled while the step is not satisfied; "Skip for now" closes the wizard and
leaves the setup banner on the roster.

### 2.2 Roster

```
┌───────────────┬──────────────────────────────────────────────┐
│ DSH sidebar   │  Bots                          [ + New bot ]│
│               │  ┌────────────────────────────────────────┐  │
│ ▸ Chat        │  │ ⚠ Setup incomplete · connect Rayrun →  │  │
│ ▸ Bots    ②   │  └────────────────────────────────────────┘  │
│               │                                              │
│               │  ┌──────────────┐ ┌──────────────┐           │
│               │  │ weekly-watch │ │ inbox-triage │           │
│               │  │ ● working    │ │ ◔ needs you  │           │
│               │  │ dsh-workspace│ │ dsh-workspace│           │
│               │  │ 2 min ago    │ │ 1 approval   │           │
│               │  └──────────────┘ └──────────────┘           │
│               │                                              │
│               │  balance ¥41.20 · 38.4 machine-hours        │
└───────────────┴──────────────────────────────────────────────┘
```

Card anatomy: name, status chip (`idle` / `working` / `needs you` /
`offline` / `recovering`), computer name, last activity, pending approval count.
Card actions: open, edit, stop/start. Empty state: "No bots yet — create one to
give your cloud computer a job." Error state: host unreachable → one sentence and
a retry; dependency missing → setup banner only, roster stays empty.

### 2.3 Bot detail

```
┌───────────────┬──────────────────────────────────────────────┐
│ ▸ Bots        │ ← Bots   weekly-watch      ● working         │
│               │ computer dsh-workspace · ¥3.10 today         │
│               │ ┌──────────────────────────────────────────┐ │
│               │ │ Bot  09:12  Working on the weekly digest │ │
│               │ │ You  09:12  Summarise last week's PRs    │ │
│               │ │ Bot  09:13  Draft ready. Two things need │ │
│               │ │             your approval:               │ │
│               │ │ ┌──────────────────────────────────────┐ │ │
│               │ │ │ ⚠ Approval needed · publish draft     │ │ │
│               │ │ │ Publish "Week 45 digest" to Feishu   │ │ │
│               │ │ │ expires in 27 min      [Deny][Approve]│ │ │
│               │ │ └──────────────────────────────────────┘ │ │
│               │ └──────────────────────────────────────────┘ │
│               │ [ Message weekly-watch…            ] [Send] │
└───────────────┴──────────────────────────────────────────────┘
```

Header: back link, name, status, computer, today's spend. Transcript: DSH chat
where possible, otherwise a read-only transcript plus composer. Pending approval
renders inline as a card and duplicates in the inbox. Composer disabled while
the bot is `recovering` with "Waiting for the bot host to come back…".

### 2.4 Approvals inbox

```
┌───────────────┬──────────────────────────────────────────────┐
│ ▸ Bots    ②   │  Approvals               Pending 2 · History │
│               │  ┌────────────────┬─────────────────────────┐│
│               │  │ publish draft  │ Publish "Week 45 digest"││
│               │  │ inbox-triage   │ to Feishu               ││
│               │  │ 27 min left    │                         ││
│               │  ├────────────────┤ Bot: weekly-watch       ││
│               │  │ send reply     │ Risk: writes outside    ││
│               │  │ weekly-watch   │ the computer            ││
│               │  │ 28 min left    │ Requested: 09:13        ││
│               │  │                │ Expires:  09:43         ││
│               │  │                │ [ Deny ]  [ Approve ]   ││
│               │  └────────────────┴─────────────────────────┘│
│               │  History: last 10 decisions, time + outcome │
└───────────────┴──────────────────────────────────────────────┘
```

Detail fields: action, bot, risk sentence, requested/expires, then Deny/Approve.
Both buttons are explicit and equal weight is avoided (Approve is primary only
after the user opens the item). Expired items become read-only with "Expired —
denied"; already-decided items show the decision and time. History lists request
id, bot, decision, time — no payloads.

### 2.5 Cost & settings

```
┌───────────────┬──────────────────────────────────────────────┐
│ ▸ Bots        │  Cost & settings                             │
│               │  balance ¥41.20      38.4 machine-hours      │
│               │  this week ¥6.80     idle stop: 15 min       │
│               │  warning below ¥10   [ Change… ]             │
│               │  ───────────────────────────────────────────  │
│               │  default model: DeepSeek (Rayrun credential) │
│               │  language: English ▾      notifications: ✓   │
└───────────────┴──────────────────────────────────────────────┘
```

Only values the platform already provides (balance, hours); no per-bot charts in
v0.1. Low balance (< threshold) turns the number amber and adds one sentence:
"Balance is low — top up in the Rayrun console; a stop is safe, destroy is not."

### 2.6 Global banners

One banner per page, highest severity first: dependency missing/old → setup
incomplete → host recovering → offline → low balance. Each banner is one
sentence plus one link; banners never stack more than one.

## 3. Component inventory

| Component | Used on | Wave | Notes |
| --- | --- | --- | --- |
| `AppPage` | all | C1 | title, description, action slot |
| `SetupWizard` | setup | C4 | 4 steps, status line per step |
| `BotCard` | roster | C2 | name, chip, computer, last seen |
| `StatusChip` | roster, detail, inbox | C2 | 5 states, dot + text |
| `Banner` | all | C1 | severity, one action |
| `BotHeader` | detail | C2 | back, name, status, cost |
| `ChatTranscript` | detail | C2 | reuse DSH chat when possible |
| `Composer` | detail | C2 | disabled states, send |
| `ApprovalCard` | detail, inbox | C3 | shared anatomy, TTL countdown |
| `ApprovalInbox` | approvals | C3 | list + detail, history |
| `CostBar` | roster, settings | C4 | balance, hours, idle stop |
| `SettingsForm` | settings | C4 | threshold, language, notifications |
| `ErrorState` | all | C1 | one sentence + action |
| `EmptyState` | roster, inbox | C1 | one sentence + action |

## 4. Copy deck (source of truth for `locale/en.json`)

| Key | English | 中文 |
| --- | --- | --- |
| `bots.empty` | No bots yet — create one to give your cloud computer a job. | 还没有 Bot——建一个，给你的云电脑一份工作。 |
| `bots.new` | New bot | 新建 Bot |
| `status.idle` | idle | 空闲 |
| `status.working` | working | 工作中 |
| `status.waiting` | needs you | 待你处理 |
| `status.offline` | offline | 离线 |
| `status.recovering` | recovering | 恢复中 |
| `approval.title` | Approval needed | 需要审批 |
| `approval.expires` | expires in {n} min | {n} 分钟后过期 |
| `approval.approve` | Approve | 批准 |
| `approval.deny` | Deny | 拒绝 |
| `approval.expired` | Expired — denied | 已过期——视为拒绝 |
| `approval.risk` | Risk: writes outside the computer | 风险：会写到电脑之外 |
| `setup.banner` | Setup incomplete | 设置未完成 |
| `setup.dependency.missing` | The cloud-computer plugin is not installed. Install it, then restart DSH. | 云电脑插件未安装。装上并重启 DSH。 |
| `setup.dependency.old` | The cloud-computer plugin is older than this version needs. Update it, then restart DSH. | 云电脑插件版本过旧。更新后重启 DSH。 |
| `error.hostDown` | The bot host is not responding. It is being restarted. | Bot host 无响应，正在重启。 |
| `cost.low` | Balance is low — top up in the Rayrun console. Stop is safe; destroy is not. | 余额偏低——去 Rayrun 控制台充值。停机会保留磁盘，销毁不会。 |

Approval and key-related copy never contains jokes; every error row has a next
action.

## 5. Visual system

- **Use DSH theme tokens where they exist** (background, surface, text, border,
  accent); name them once in `client.js` and reuse. The mockup approximates the
  palette; spike C-S1 confirms the token names.
- Fallback tokens for the mockup: surface `#ffffff` / `#f6f7f9`, text `#16181d`,
  muted `#5b6270`, border `#e3e6eb`, accent `#2f6feb`, success `#1a7f45`, warning
  `#9a5b00`, danger `#b42318`.
- Status chips: idle = neutral, working = accent with subtle pulse, needs you =
  amber, offline = neutral with strikethrough dot, recovering = amber outline.
- Type: system font stack; body 14 px, titles 20/16 px, mono for ids/commands.
- Spacing: 4/8/12/16/24; radii 8 px cards, 6 px controls; no shadows beyond one
  level.
- Motion: 120 ms opacity/slide only; honor `prefers-reduced-motion`.

## 6. Accessibility

- All cards/buttons reachable by Tab in reading order; visible focus ring.
- Approval actions are real `<button>`s with labels; countdown announced only on
  request (`aria-live` off for ticking numbers, on for state changes).
- Contrast ≥ 4.5:1 for text; status never communicated by color alone (chip
  text always present).
- Errors are inline text next to the action, not toasts that vanish.

## 7. Responsive

Desktop-first: roster is a 2–3 column grid ≥1024 px, 1 column below; detail and
inbox are list+detail ≥1024 px, stacked (list then detail) below. No mobile
optimization in v0.1.

## 8. Acceptance mapping

| Screen | Acceptance tasks |
| --- | --- |
| Setup wizard | A1, A2, A3 |
| Roster | A4, A9, A10 |
| Bot detail | A4, A5, A8 |
| Approvals | A6, A7, A11 |
| Cost & settings | A10 |
| Global banners | A1, A2, A9, A11 |

## 9. Out of scope for v0.1

Custom themes, mobile layout, per-bot cost charts, a message editor rewrite,
artifact preview beyond links, notification center, and onboarding tours.
