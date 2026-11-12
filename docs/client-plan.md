# Client plan — v0.1

*Status: 2026-11-11. The client is the Rayrun Bot plugin's client half — the
pages a user touches in the DSH web UI (`dsh web` or the DSH desktop shell). This
plan covers the client only; the bot host, approval bridge and cloud calls are in
Layout is the three-column shell in [ui-design.md](ui-design.md): chat list, conversation, per-bot details. [mvp-plan.md](mvp-plan.md). Assumption, per the research: v0.1 ships as a DSH
plugin + `dsh web`, with no standalone desktop app. Visual spec, copy deck and
clickable mockups: [ui-design.md](ui-design.md). Bot identity, names, avatars and
voice: [bot-persona.md](bot-persona.md).*

## What the client owns

- Renders the product surfaces and talks to **our host half** over same-origin
  RPC. It never talks to the Rayrun API directly and never holds a token.
- Collects user decisions (approve/deny, create/edit a bot) and forwards them; it
  is not an authority. State comes from the host, not from the client cache.
- Reuses DSH's shell, chat, settings, locale and plugin handling; it does not
  re-implement them.
- Ships as plain ESM with **no runtime dependencies**; only modules DSH provides
  (`react`, etc.). Loaded when the page starts.

## Surfaces

| Surface | Where | Purpose | v0.1 |
| --- | --- | --- | --- |
| Chat list | left column | search, `+`, current bot, bot rows with latest snippet, time and attention dot | P0 |
| Conversation | center column | markdown messages, day separators, inline approval/draft cards, composer | P0 |
| Bot details panel | right column | profile, large computer preview, Activity/Library tabs, receipts, routines, usage | P0 |
| Inline approval cards | conversation | action, warning, origin and TTL; Deny / Allow once; attention dot in the chat list | P0 |
| Onboarding wizard | own page | dependency check → Rayrun sign-in → DeepSeek key → computer + first bot | P0 |
| Usage block | details panel + list footer | balance, machine hours, week spend, idle-stop policy, low-balance notice | P0 |
| Settings | own page | default model, budget warning threshold, notifications, language | P1 |
| Computer view | deep link | opens the separate cloud-computer plugin's desktop page; we do not rebuild noVNC | P0 |
| Library tab | details panel | artifacts grouped by date, pulled by the host; no editor in v0.1 | P1 |

Everything the dependency already renders — Rayrun sign-in, token handling,
machine creation, the noVNC desktop — is **linked to, not rebuilt**. The client
plan treats those pages as an external UI with a route contract to confirm in
spike C-S5.

## RPC contract with the host

The client talks to `/plugins/<bundle-id>/rpc` (same-origin, origin-checked,
size-limited, JSON). The host adapter owns the Rayrun token and the file mailbox.

| Group | Actions (draft) |
| --- | --- |
| health | `setup.status`, `dependency.health` (installed version, compatible) |
| setup | `setup.rayrun.loginStatus`, `setup.key.status`, `setup.computer.ensure` |
| bots | `bots.list`, `bots.get`, `bots.create`, `bots.update`, `bots.delete`, `bots.start`, `bots.stop` |
| sessions | `session.history`, `session.send`, `session.subscribe` (stream) |
| approvals | `approvals.list`, `approvals.get`, `approvals.decide`, `approvals.history` |
| cost | `cost.summary`, `cost.byBot` (P1) |
| settings | `settings.get`, `settings.update` |

Rules: responses never carry the Rayrun token or the DeepSeek key; errors carry a
stable code plus a human sentence; `approvals.decide` is idempotent by approval
id and rejects stale, replayed or wrong-bot decisions. Streaming: SSE from the
host if it is cheap, otherwise 1 s transcript polling — decided by spike C-S4.

## DSH integration

- Inject the client UI modules the same way the cloud-computer plugin does:
  sidebar, conversation, settings, locale, API remotes.
- Keep one `client.js` entry with plain ESM; split pages into modules when it
  outgrows a single file, but ship them inside the package's `client.js` export.
- Locale through our own `locale/en.json` and `locale/zh.json`, with the same
  key-parity audit test the dependency uses.
- Reuse DSH chat where possible. If the client cannot programmatically open a
  session (spike C-S2), fall back to a transcript view plus a composer that
  posts through `session.send`.

## Week 0 — client spikes (C0)

| # | Spike | Question | Decision gate |
| --- | --- | --- | --- |
| C-S1 | Shell integration | Do sidebar page, settings page and locale injection work on DSH `0.2.2-rc.1`? | page skeleton approved |
| C-S2 | Chat reuse | Can the client half create/open a DSH session and send a message? | reuse chat, or transcript + composer fallback |
| C-S3 | Approvals | Can we use DSH's approval seam UI, or must we render our own inbox? | own inbox unless the seam is programmable |
| C-S4 | Streaming | SSE from the host versus polling: latency, cost, complexity | transport frozen |
| C-S5 | Deep links | Stable route ids for the dependency's sign-in and desktop pages; embedding rules | link contract written down |
| C-S6 | Approval card safety | Card data cannot be spoofed across bots; decisions are bound to bot id and action hash | threat notes added to the card |

If C-S2 and C-S3 both fail, the MVP narrows to **roster + approvals + computer
link**, with conversation handled through DSH's own chat hand-off. This is the
research's "client API cannot express the product" gate.

## Delivery waves

| Wave | Goal | Ships |
| --- | --- | --- |
| C1 (W1) | Three-column shell | chat list, conversation and details skeleton, locale, empty/error states, stub RPC |
| C2 (W2) | Chat list and conversation | rows with attention dots, new-bot form, markdown conversation, history |
| C3 (W3) | Approvals and receipts | inline cards with TTL, attention dots, receipt cards, stale/expired states |
| C4 (W3–4) | Onboarding and cost | wizard with dependency health and deep links, cost bar, low-balance warning |
| C5 (W4) | Computer and resilience | desktop deep link, recovery banners (host restarting), resume UX, artifacts list |
| C6 (W5) | Polish and gates | complete i18n, keyboard/focus pass, first-paint check, manual acceptance run |

## UX flows and failure states

1. **First run.** Wizard shows four steps, each with an inline status and a link
   to the page that fixes it (sign-in, key, computer). It can be skipped when
   everything is already set up.
2. **Daily.** Open → chat list → the bot with an attention dot → answer the inline card →
   approve or deny. Everything reachable in two clicks from the sidebar.
3. **Laptop closed.** On reopen, a working bot shows "working", finished work
   shows as unread, and approvals still in the inbox stay visible.
4. **Failures.** Dependency missing or too old; no Rayrun token; no DeepSeek
   key; computer stopped or asleep; bot host recovering; approval expired;
   balance low; network offline. Each state shows one sentence and one next
   action — never a dead end and never a fake success.

## Client-side state

Server authoritative; the client keeps a read-only cache.

- `Bot { id, name, instructions, status, computerId, lastSeenAt, cost? }`
- `Approval { id, botId, action, risk, createdAt, expiresAt, state }`
- `Machine { status, balance, hours, idleMinutes }`
- `Setup { dependency, rayrunLogin, deepseekKey, computer, firstBot }`

Optimistic UI only for composing a message and pressing approve/deny, and it
rolls back on any RPC error.

## Testing

- Pure logic (state reducers, selectors, formatters) as plain Node tests
  (`node test/client-*.mjs`); no browser test framework in v0.1 unless a
  regression demands one.
- Locale parity audit (en/zh keys) in the same style as the dependency.
- RPC contract tests live in the host; the client builds against stubs from W1.
- Manual golden path maps to mvp-plan acceptance tasks A1–A12, with screen
  captures as evidence.
- Every error path in "Failures" above gets a manual check.

## Risks

| Risk | Signal | Mitigation |
| --- | --- | --- |
| DSH client API cannot express the product | C-S2/C-S3 fail | narrow to roster + approvals + computer link; standalone shell stays a later option |
| Reusing DSH chat is not programmable | C-S2 fails | transcript view + composer through the host |
| Two-plugin UI seams break | deep links 404 across versions | dependency health check, version contract, one-sentence fallback copy |
| Stale approval cards | decision rejected server-side | refresh on rejection, show "expired or already answered" |
| i18n drift | zh/en keys diverge | same-commit rule plus audit test |
| Client grows dependencies | bundle imports a library | no runtime dependencies invariant; plain ESM only |

## Definition of done for the client (v0.1)

- Every client-facing acceptance task (A1–A12) is demoed on a clean profile.
- Locale parity audit passes; approval and key copy contains no jokes.
- No RPC response carries the Rayrun token or DeepSeek key; the client never
  reads a config file directly.
- Pages first-paint within a second on a normal laptop; no new runtime
  dependencies; client module loads on `0.2.2-rc.1`.
- Failure states above are all implemented and checked manually.

## Not in v0.1

Standalone desktop app, mobile app, push notifications, a message editor
rewrite, artifact preview beyond links, custom themes, and charts for per-bot
spend.
