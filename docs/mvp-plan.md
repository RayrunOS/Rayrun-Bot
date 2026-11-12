# MVP plan — v0.1 (detailed)

*Status: 2026-11-11. Detailed execution plan for the first release. Scope is
frozen; only the P0 items below ship. Estimates are engineer-days and assume
1–2 engineers plus coding agents; the research estimate of 4–6 weeks assumes the
cloud-computer layer is reused as-is and no platform blocker hits. Related:
[client plan](client-plan.md), [platform asks](platform-asks.md),
[architecture](architecture.md), [roadmap](roadmap.md).*

## 0. How to read this plan

- §2 holds the sign-off table (A1–A12); a row that cannot be demonstrated blocks
  the release.
- §5 holds work items with IDs, deliverables, dependencies and estimates; §6
  sequences them into milestones M0–M5.
- §4 fixes the interfaces so host, bot host and client can be built in parallel
  against stubs.
- Anything not in §3 is out of scope; open decisions in §11 are due before M1.

## 1. What the MVP is

One person, on their own laptop, installs the Rayrun Bot DSH plugin — which pulls
in the separate cloud-computer plugin as a dependency — signs in to their own
Rayrun account, stores their own DeepSeek key, creates a cloud computer, creates
a named bot, talks to it, closes the laptop, and the bot finishes a background
task and stops for an approval. The user approves it from the browser, the bot
continues, and the machine-hours bill is visible. That is the whole MVP.

The demo we must be able to record on the first day of alpha:

1. Fresh DSH profile; install both plugins from the README; restart.
2. Sign in to Rayrun; store the DeepSeek key.
3. Create a computer (one screen); open its desktop.
4. Create a bot named "weekly-watch"; give it one instruction.
5. Send it a task; watch the reply stream in the panel.
6. Close the local DSH; the bot keeps working.
7. Reopen: the task is done, and the bot is waiting on one approval.
8. Approve; the bot takes the gated action; the cost bar shows the spend.

## 2. Acceptance tasks — v0.1 sign-off

Every row must pass with the stated evidence; a row that cannot be demonstrated
blocks the release. Automated rows run as plain-Node tests (`node test/*.mjs`);
manual rows are recorded as a screen capture plus the log files.

| ID | Task | Pass evidence |
| --- | --- | --- |
| A1 | Clean-machine install | fresh DSH profile: install both plugins per README, restart, both pages load; a missing dependency shows an actionable error; ≤ 3 minutes |
| A2 | Sign-in and key | Rayrun login stores the token in the vault; the DeepSeek key is stored as a Rayrun credential; without a token the tools answer `token_required` |
| A3 | Create a computer | ≤ 15 s, at least 2 GB, desktop optional; balance and machine hours visible |
| A4 | Create a bot and talk to it | a named bot with instructions appears in the roster, streams a reply, and its directory exists on the machine (`rayrun_files` evidence) |
| A5 | Laptop closed | with the local DSH closed, a bot finishes one background task; reopening shows the result, with timestamps on both sides |
| A6 | Approve | a gated action stops; the card appears within 10 s; approval resumes the bot within 10 s; the side effect happens only after the decision |
| A7 | Deny and expiry | a denial means no side effect; a background card expires after 30 minutes and is denied; a chat-started card waits; replayed, wrong-bot and expired requests are rejected and logged (negative tests) |
| A8 | Resume | the same bot's second conversation continues the first, and still continues after the host process is killed and after machine stop/start |
| A9 | Recovery | killing the bot host loses no queued work; the watchdog restarts it within 60 s and the queue drains |
| A10 | Cost and lifecycle | balance and hours shown; idle stop stops, never destroys; `destroy` only from an explicit human action |
| A11 | Security regression | repo, logs and workspace scan clean of tokens and keys; no public ingress; approval negative tests green; dependency version check enforced |
| A12 | Release | README/quickstart three-minute path verified on a clean machine; npm tarball contains host half, client half, locale and bundle patch; CI green |

Alpha gate after A1–A12: 10–20 seed users; first-bot success ≥ 80 %; week-2
retention ≥ 40 %; zero billing complaints. These are signals, not ship gates.

## 3. Scope

In — P0 unless marked P1:

| Item | Note |
| --- | --- |
| Bot registry: name, label, avatar, instructions, skills, memory dir | bots are profile directories on the machine, not code |
| Roster page and per-bot chat | reuse DSH chat where the API allows; see client plan |
| Bot↔session mapping | persisted on the machine, mirrored locally |
| Cloud bot host: queue, inbox/outbox, watchdog | one agent task at a time |
| Fail-closed approval gate | TTL 30 min, replay protection, audit line |
| Approval inbox UI | the card the user actually answers |
| Cloud-computer dependency integration | dependency declaration, version check, missing-plugin error |
| Cost bar: balance and machine hours | per-bot attribution is P1 |
| Onboarding wizard | login → key → computer → first bot |
| npm package, CI, DSH version matrix | required to ship v0.1.0 |
| Scheduled wake-up, one cron per bot (P1) | only if W3 ends on schedule |

Out — deliberately: multi-tenant SaaS, hosted accounts, team/RBAC, IM channel
(v0.2), mobile app, marketplace, provider abstraction, standalone desktop shell,
browser-login persistence, public ingress panel, and parallel execution of
multiple bots on one computer. The MVP serializes bots through a queue; that is a
feature until the platform can run more than one agent task per machine.

## 4. Architecture and interfaces

The local (plugin-side) file layout is specified in
[local-file-design.md](local-file-design.md).

### 4.1 Frozen decisions

1. **No inbound networking.** Local → cloud control goes through the Rayrun API;
   cloud → local state is written as files under `/workspace/.rayrun/`. The
   public desktop port is never used as the product panel.
2. **One computer per user**, shared by that user's bots. Rayrun runs one agent
   task per machine (`409 sandbox_busy`), so the bot host owns a FIFO queue.
3. **Bot state lives on the machine**; the local side keeps a read-only mirror
   and pulls it back as the recovery anchor.
4. **Persistent host on the machine**: a small Node supervisor, shipped by the
   existing worker projection, runs the queue and the DSH sessions; a local
   watchdog restarts it through `exec`.
5. **Approval bridge v0.1 is a file mailbox**, not an HTTP callback: request and
   decision JSON files carry a nonce, bot id, action hash and TTL; the local host
   polls every 3 s, shows the card, uploads the decision. Missing, expired,
   replayed or wrong-bot responses are denied and logged.
6. **Session strategy is decided by spike S1**: preferred long-lived DSH process
   on the machine; fallback per-turn headless with a session id; last resort
   transcript replay.
7. **Separate projects, one dependency edge.** `dsh-rayrun-computer` stays in its
   own repository and is consumed as an npm dependency (MIT). The bundle is meant
   to declare the dependency so one install brings both; S6 decides, and the
   documented two-install path is the fallback.
8. **One queue, one agent task.** The host never relies on the platform to queue;
   busy is retried, never dropped.
9. **Authority split.** Local-first for ownership and decisions, cloud for
   execution; see [architecture.md](architecture.md#where-the-truth-lives).

### 4.2 On-machine layout

```
/workspace/.rayrun/
├── bots/<botId>/
│   ├── bot.json            # definition + schema version
│   ├── memory/             # per-bot notes and artifacts
│   ├── sessions/           # session ids + transcript refs
│   ├── queue.jsonl         # append-only FIFO work items
│   ├── approvals/          # req-<id>.json, res-<id>.json
│   └── log/bot.jsonl       # host log, no secrets
├── host/state.json         # supervisor pid, health, schema version
└── outbox/events.jsonl     # events for the local UI, append-only
```

### 4.3 Schemas

**`bot.json`** — `{ schema: 1, id, name, label, avatar, instructions, skills: [], model?: "deepseek", createdAt, updatedAt }`.
`id` is kebab-case and unique per user; `name` is the Title Case display name;
`label` is the one-line job shown under the name; `avatar` is a monogram spec
(`{ kind: "monogram", letter, hue }`) in v0.1; instructions are plain markdown,
capped at 8 KB. New bots start from the default instruction template in
[bot-persona.md](bot-persona.md) §6.

**Queue item** — `{ id, botId, kind: "message" | "task" | "wake", text, createdAt, state, attempts }`
with states `queued → running → waiting_approval → done | failed | cancelled`.
One in-flight item per machine; the rest stay `queued`.

**Approval request** — `{ schema: 1, id, botId, nonce, actionHash, action, risk,
origin: "chat" | "background", createdAt, expiresAt }`; **decision** — `{ schema: 1, id, nonce, decision:
"approve" | "deny", decidedAt }`. Both written to a temp name and renamed into
place; the decision must match id, nonce and bot id. A card raised from a chat
message waits with no timer; a card raised by background work expires after 30
minutes and is denied. The action hash covers the normalized action payload, so a
stale card cannot approve a different action.

**Outbox event** — `{ seq, at, botId?, type: "status" | "message" | "approval" |
"error", payload }`; the client reads by `seq` cursor and ignores gaps older than
its checkpoint.

**Error codes** (stable, used by RPC and logs): `E_DEP_MISSING`,
`E_DEP_VERSION`, `E_TOKEN_REQUIRED`, `E_KEY_REQUIRED`, `E_MACHINE_STOPPED`,
`E_MACHINE_BUSY`, `E_APPROVAL_EXPIRED`, `E_APPROVAL_REPLAY`,
`E_APPROVAL_UNKNOWN`, `E_HOST_DOWN`, `E_BOT_UNKNOWN`, `E_QUEUE_FULL`,
`E_BALANCE_LOW`, `E_INTERNAL`.

### 4.4 RPC surface

The client ↔ host contract is defined in [client-plan.md](client-plan.md):
same-origin `/plugins/<bundle-id>/rpc`, size-limited JSON, `{ action, payload }`
in and `{ ok, data }` or `{ ok: false, code, message }` out. Responses never
carry the Rayrun token or the DeepSeek key. The bot host has no public RPC; it is
driven by the host half through the dependency's `rayrun_*` tools or its RPC
route, decided by spike S6.

### 4.5 Dependency contract

- **We use:** the `rayrun_*` tools (create/stop/pause/resume/destroy, `exec`,
  `files`, `agent`, `dsh`, `workspace`), their exact names and semantics, and the
  same-origin RPC route when a direct host-to-host call is cheaper.
- **Version check:** the host records the installed version at startup and fails
  with `E_DEP_MISSING` / `E_DEP_VERSION` plus one sentence on what to install.
- **Never:** edit, fork or vendor `dsh-rayrun-computer`; changes it needs go to
  its own repository issue tracker.
- **Not a dependency:** `dsh-superagent-prototype` — a reference-only research
  prototype with no cloud computer, persistent bot object or remote approvals. We
  borrow ideas, not code, and revisit it for v0.2 event triggers.

## 5. Workstreams and task breakdown

Estimates include tests; "Done when" is the evidence, not a code-complete claim.

### A. Repo, packaging, release

| ID | Task | Deliverable | Depends | Est | Done when |
| --- | --- | --- | --- | --- | --- |
| A1 | Scaffold `packages/dsh-rayrun-bots` | package.json (`dsh.bundle` + `dsh.client.inject`), `cordis.patch.yml`, `index.js`, `client.js`, `lib/`, `locale/en+zh`, `test/` | — | 2 | bundle loads in a profile and renders an empty page |
| A2 | Dependency declaration + version check | dependency range, `E_DEP_MISSING`/`E_DEP_VERSION` copy | A1 | 1 | fresh profile without the dependency shows the action, not a crash |
| A3 | Host RPC route + envelope + limits | `/plugins/<id>/rpc`, `{ok,data}` / `{ok:false,code,message}`, 64 KB body cap | A1 | 1 | contract tests for success and every error code |
| A4 | CI | `node --check`, `node test/*.mjs`, locale audit | A1 | 1 | a failing test turns CI red |
| A5 | npm publish flow | tarball check, bootstrap token → OIDC trusted publishing | A4 | 1 | dry run lists host/client/locale/bundle files |
| A6 | Version matrix | DSH × `dsh-rayrun-computer` × Rayrun Bot table | A2 | 0.5 | table committed and linked from README |
| A7 | Package docs | package README with install path and limits | A5 | 0.5 | a fresh user can install from the tarball |

### B. Bot model and local state

| ID | Task | Deliverable | Depends | Est | Done when |
| --- | --- | --- | --- | --- | --- |
| B1 | `bot.json` schema + validation | validator for id/name/label/avatar/instructions + default persona template; `schema` version | A1 | 1 | invalid definitions rejected with a code; a new bot gets the default template |
| B2 | Machine layout init | idempotent directory creation | B1 | 0.5 | re-running never loses files |
| B3 | Registry + local mirror | host cache, rotation on refresh | B1 | 1 | mirror survives a host restart |
| B4 | Bot CRUD RPC | list/get/create/update/delete | A3, B1 | 1.5 | contract tests, delete removes machine dir |
| B5 | Recovery pull | pull bot dirs to local snapshot | B3 | 1 | losing the machine is recoverable |
| B6 | Migration runway | schema field + upgrade function | B1 | 0.5 | an old `bot.json` still opens |

### C. Cloud bot host

| ID | Task | Deliverable | Depends | Est | Done when |
| --- | --- | --- | --- | --- | --- |
| C1 | Supervisor module | host code shipped by the worker projection, hash-verified | A2 | 2 | files land on a fresh machine |
| C2 | Boot + handshake | `exec` start, pid/state, first heartbeat | C1 | 1 | host starts without a manual shell |
| C3 | Queue worker | FIFO, single-flight, retry/backoff | C2 | 2 | a second item waits, never drops |
| C4 | DSH invocation | per S1 strategy: prompt in, stream out | C3 | 2 | task → reply in a session |
| C5 | Inbox/outbox polling | 3 s poll, cursor, dedupe | C3 | 1.5 | message round trip < 5 s |
| C6 | Watchdog | local `exec` restart on missing heartbeat | C2 | 1 | killed host is back within 60 s |
| C7 | Health and status | heartbeat → `host/state.json` → roster status | C2 | 1 | roster shows idle/working/recovering |
| C8 | Recovery | queue and approval state re-read after restart | C3 | 1.5 | killing the host loses no work |
| C9 | Busy handling | 409 mapping, retry budget, never drop | C4 | 1 | busy test: all items eventually run |

### D. Sessions

| ID | Task | Deliverable | Depends | Est | Done when |
| --- | --- | --- | --- | --- | --- |
| D1 | S1 strategy implementation | session create/continue per selected approach | C4 | 2 | two prompts share one session |
| D2 | Mapping persistence | bot↔session↔profile dir, restart-safe | D1 | 1 | mapping survives host restart |
| D3 | Transcript capture | redacted `sessions/*.jsonl`, cursor for UI | D1 | 1.5 | history replays in order |
| D4 | Resume tests | host kill, machine stop/start, new chat | D2 | 1 | A8 evidence |
| D5 | Fallback path | transcript replay when the contract fails | D3 | 1 | fallback tested and documented |

### E. Approvals

| ID | Task | Deliverable | Depends | Est | Done when |
| --- | --- | --- | --- | --- | --- |
| E1 | Gate API | `requestApproval(action)` blocks before the side effect | C4 | 1.5 | gated step never runs early |
| E2 | Request writer | nonce, actionHash, TTL, atomic rename | E1 | 1 | schema tests for both files |
| E3 | Local poller | polls, dedupes, drives card state | E2 | 1.5 | card appears within 10 s |
| E4 | Approval RPC | `list/get/decide`, idempotent by id | A3, E3 | 1 | contract tests |
| E5 | TTL and expiry | 30 min default, deny on expiry, cleanup | E2 | 1 | expired request cannot execute |
| E6 | Negative tests | replay, wrong bot, stale action, malformed | E4 | 2 | suite green and referenced in A7/A11 |
| E7 | Audit line | one line per request and decision, no secrets | E4 | 0.5 | log format checked |

### F. Client

Detailed in [client-plan.md](client-plan.md); estimates live there too. Work
streams C1–C6 (shell, roster, approvals, onboarding/cost, computer view, polish)
are built against stub RPC from M1, so client and host progress in parallel.

### G. Cost and operations

| ID | Task | Deliverable | Depends | Est | Done when |
| --- | --- | --- | --- | --- | --- |
| G1 | Balance/hours read | adapter call + parsing, no token leak | A2 | 1 | values visible in the panel |
| G2 | Cost summary RPC | balance, hours, low-balance threshold | G1 | 1 | warning renders |
| G3 | Idle stop integration | stop only, skipped when a task runs | C7 | 1 | idle machine stops, never destroys |
| G4 | Destroy guard | destroy only from an explicit human action | C7 | 0.5 | code path audit |
| G5 | Recovery runbook | machine loss, balance exhaustion, dependency loss | B5 | 1 | runbook in `docs/` |
| G6 | Error copy audit | one sentence + one action everywhere | F1 | 1 | all codes have copy |

### H. Acceptance, alpha, release

| ID | Task | Deliverable | Depends | Est | Done when |
| --- | --- | --- | --- | --- | --- |
| H1 | Acceptance runner | checklist for A1–A12 with evidence slots | all | 1 | one run produces a filled checklist |
| H2 | Integration harness | fake Rayrun API + fake DSH for CI | C4 | 2 | end-to-end loop runs in CI |
| H3 | Live smoke | real account, one bot, one approval | H2 | 1 | evidence attached to the release |
| H4 | First publish | npm package + provenance | A5 | 1 | install on a clean profile works |
| H5 | Release | notes, tag `v0.1.0`, version matrix | H1–H4 | 0.5 | release page links the evidence |
| H6 | Alpha kit | 20-user invite, issue templates, feedback form | H5 | 1 | first user onboarded |

**Effort summary:** A 7, B 5.5, C 13, D 6.5, E 8.5, F ~22 (client plan), G 5.5,
H 6.5 ≈ **74 engineer-days**, plus W0 3 days and 2 weeks of alpha. With two
engineers working the host and client streams in parallel, the MVP is a 6–8 week
calendar effort; one engineer should plan for 10–12 weeks.

## 6. Milestones and schedule

| Milestone | Week | Work delivered | Exit criterion | Demo |
| --- | --- | --- | --- | --- |
| M0 | W0 (3 d) | spikes S1–S6, platform questions sent | decisions recorded, go/no-go | written decision log |
| M1 | W1 | A1–A3, B1–B3, F1, G1 | roster read-only from stub data | empty→stub roster in the panel |
| M2 | W2 | C1–C5, B4, D1–D2, F2 | a bot replies end to end | create bot, send task, get reply |
| M3 | W3 | E1–E4, D3, F3, G2–G3 | approval loop works | gated action → card → approve → continue |
| M4 | W4 | E5–E7, D4–D5, C6–C8, F4–F5 | resume and recovery pass | close laptop, reopen, still working |
| M5 | W5 | C9, G4–G6, F6, H1–H4 | A1–A12 pass on a clean machine | acceptance run recorded |
| Alpha | W6–W7 | H6, fixes | alpha gate | 10–20 users on the loop |

If one engineer: run M1→M5 sequentially, with the client stream merged into the
host stream and the same exit criteria.

## 7. Testing and evidence

- **Unit** — pure modules (queue, approval state machine, bot schema, formatters)
  as `node test/*.mjs`; no framework.
- **Contract** — RPC request/response and error codes against stubs.
- **Integration** — the H2 harness: fake Rayrun API and fake DSH; CI runs the
  closed loop without real credentials.
- **Live smoke** — real Rayrun account, manual, never in CI; records the
  acceptance checklist.
- **Acceptance** — A1–A12 run on a clean profile; evidence (screen captures,
  logs) attached to the release notes, never committed with secrets.
- No browser test framework in v0.1; the client's manual golden path is the
  checklist in [client-plan.md](client-plan.md).

## 8. Platform dependencies

MVP blockers from [platform-asks.md](platform-asks.md): the session/long-lived
runtime contract (#1) and balance grace (#2). Everything else has a workaround:
file-mailbox polling for control, local watchdog for restart, account token in the
vault, no inbound networking, two-install path if S6 fails.

## 9. Risks

| Risk | Trigger | Mitigation | Fallback |
| --- | --- | --- | --- |
| Session contract is not what we think | S1 fails both host and id resume | transcript replay, cut scope | ship without resume, call it out |
| Long-lived host cannot be restarted | S2 shows no way to keep it alive | local watchdog + open-on-connect | document "host restarts when you open the panel" |
| Approval latency too high | p95 over 10 s in S3 | shorter polling, exec-based mailbox | move IM forward to v0.2 |
| Dependency install friction | one-install path fails or package stays off npm | documented two-install path, version check | install both from checkouts for alpha |
| Dependency drift | tool names/RPC change upstream | version contract + adapter + contract tests | pin a known version |
| Balance exhaustion destroys data | account hits zero | warn, recommend lifetime cap, pull state locally | recovery runbook |
| Scope creep | IM, desktop, routines enter W3 | P1 cut at the W3 gate | ship P0 only |
| Public ingress temptation | someone asks for a panel URL | forbidden: no inbound, no `public` desktop | local-only UI |
| DSH version drift | image vs laptop mismatch | version matrix in M5 | pin image request |

## 10. Metrics

Install → sign-in conversion; first-bot success rate; approval latency p50/p95;
week-2 retention; recovery events per user (watchdog restarts, resumed sessions);
support issues per user; Rayrun spend per user per week.

## 11. Open decisions

1. **Bot concurrency** — serialized queue for v0.1 (recommended) or a machine per bot. Due W0.
2. **Routines** — one cron per bot as P1 (recommended) or cut entirely. Due W0.
3. **Approval channel** — file mailbox for v0.1, IM in v0.2 (recommended). Due W0.
4. **Resolved (2026-11-11)** — `dsh-rayrun-computer` stays untouched in its own
   repository; Rayrun Bot is a separate project that depends on it. Open
   sub-decision: one-install dependency (S6) or documented two-install fallback.
5. **npm ownership** — which account owns both packages, who publishes the
   dependency, and who configures trusted publishing. Due W1.

## 12. Release checklist for v0.1.0

- [ ] A1–A12 pass with evidence on a clean machine.
- [ ] CI green: checks, unit tests, contract tests, integration harness.
- [ ] Locale audit passes; every error code has one-sentence copy.
- [ ] Version matrix updated; dependency range pinned.
- [ ] No secret, token or key in the diff, logs, fixtures or tarball.
- [ ] README, README.zh-CN and quickstart match shipped behavior.
- [ ] npm tarball contains host half, client half, locale and bundle patch.
- [ ] `v0.1.0` tagged from `main`; release notes link the acceptance evidence.
- [ ] One clean-profile install from npm verified after publishing.
- [ ] Alpha kit ready: invite text, issue templates, feedback form.

## 13. Out of scope for v0.1

Multi-tenant SaaS, hosted accounts, team/RBAC, IM channel, mobile app,
marketplace, provider abstraction, standalone desktop shell, browser-login
persistence, public ingress panel, per-bot cost charts, custom themes, and
parallel execution of multiple bots.

## 14. Week 0 checklist

Day 1 — S1 session contract; S2 long-lived host; client spike C-S1 (shell).
Day 2 — S3 approval mailbox latency; S6 bundle dependency; send
[platform-asks.md](platform-asks.md) questions #1 and #2 to Rayrun.
Day 3 — record the decision log (session strategy, one-install vs two-install,
routines in/out), freeze §4 interfaces, start M1.
