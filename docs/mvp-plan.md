# MVP plan — v0.1

*Status: 2026-11-10. This is the build order for the first release. It assumes
one or two engineers plus coding agents, and the cloud-computer package as the
starting base. Weeks are relative, not calendar promises.*

## The MVP in one paragraph

One person, on their own laptop, installs one DSH plugin, signs in to their own
Rayrun account, stores their own DeepSeek key, creates a cloud computer, creates
a named bot, talks to it, closes the laptop, and the bot finishes a background
task and stops for an approval. The user approves it from the browser, the bot
continues, and the machine-hours bill is visible. That is the whole MVP;
everything else waits.

## Exit criteria — all must pass

1. **Three-minute first bot.** From README to a running bot without reading source code.
2. **Laptop closed.** A bot completes one background task while the user's machine is closed.
3. **Approval round trip.** A gated action stops; the card appears within 10 s; the decision resumes the bot within 10 s; a 30-minute timeout denies.
4. **Resume.** The same bot's second conversation continues where the first stopped, including after a host restart.
5. **Recovery.** If the cloud bot host dies or the machine restarts, the queued work survives and nothing is lost silently.
6. **Cost.** Balance and machine hours are visible, idle stop works, and nothing is destroyed without an explicit human request.
7. **Security.** No token or key in logs, workspace or repo; the approval path has negative tests (replay, wrong bot, expired request).
8. **No public ingress.** The MVP needs no inbound networking and exposes no panel to the internet.
9. **Alpha.** 10–20 seed users; first-bot success ≥ 80 %; week-2 retention ≥ 40 %; zero billing complaints.

## Scope — in

| Item | Priority | Note |
| --- | --- | --- |
| Bot registry: name, instructions, skills, memory dir | P0 | bots are profile directories on the machine, not code |
| Roster page and per-bot chat in the DSH panel | P0 | reuse DSH sessions and chat UI |
| Bot↔session mapping | P0 | persisted on the machine, mirrored locally |
| Cloud bot host: queue, inbox/outbox, watchdog | P0 | one agent task at a time |
| Fail-closed approval gate | P0 | TTL 30 min, replay protection, audit line |
| Approval inbox UI | P0 | the card the user actually answers |
| Cost bar: balance and machine hours | P0 | per-bot attribution is P1 |
| Onboarding wizard | P0 | login → key → computer → first bot |
| npm package, CI, DSH version matrix | P0 | required to ship v0.1.0 |
| Scheduled wake-up, one cron per bot | P1 | only if W3 ends on schedule |

## Scope — out (deliberately)

Multi-tenant SaaS, hosted accounts, team/RBAC, IM channel (v0.2), mobile app,
marketplace, provider abstraction, standalone desktop shell, browser-login
persistence, public ingress panel, and parallel execution of multiple bots on one
computer. The MVP serializes bots through a queue; that is a feature, not a gap,
until the platform can run more than one agent task per machine.

## Architecture decisions for the MVP

1. **No inbound networking.** Local → cloud control goes through the Rayrun API;
   cloud → local state is written as files under `/workspace/.rayrun/`. The
   public desktop port is never used as the product panel.
2. **One computer per user**, shared by that user's bots. Rayrun runs one agent
   task per machine (`409 sandbox_busy`), so the bot host owns a FIFO queue.
3. **Bot state lives on the machine**: `/workspace/.rayrun/bots/<id>/` holds
   `bot.json`, `memory/`, `sessions/` and `approvals/`. The local side keeps a
   read-only mirror and pulls it back as the recovery anchor.
4. **Persistent host on the machine**: a small Node supervisor, shipped by the
   plugin's existing worker projection, runs the queue and the DSH sessions. A
   local watchdog restarts it through `exec` when it dies.
5. **Approval bridge v0.1 is a file mailbox**, not an HTTP callback: request and
   decision JSON files carry a nonce, bot id, action hash and TTL. The local host
   polls every 3 s, shows the card, uploads the decision. Missing, expired,
   replayed or wrong-bot responses are denied and logged.
6. **Session strategy is decided by spike S1** (below). Preferred: one long-lived
   DSH process on the machine that keeps sessions in memory. Fallback: per-turn
   headless runs with a session id. Last resort: transcript replay, documented as
   slower and more expensive.

## Week 0 — spikes and decisions (2–3 days)

| # | Spike | Question | Decision gate |
| --- | --- | --- | --- |
| S1 | Session resume | Can a DSH session be resumed by id from the cloud path, or does a long-lived process hold it? | pick strategy 6.1 / 6.2 / 6.3 and write it down |
| S2 | Long-lived host | Can a process started via `exec` survive, and be restarted by the local watchdog? | supervisor + watchdog design frozen |
| S3 | Approval mailbox | Round-trip latency and failure modes of file polling through the Rayrun files API | bridge accepted, poll interval chosen |
| S4 | Profile projection | Minimal projection that gets bot definitions and skills onto the machine (today only the worker layer is projected) | projection format frozen |
| S5 | Platform gaps | Files API polling limits, `exec` timeouts, machine restart behavior | workarounds recorded in the plan |

Week 0 ends with the scope table: routines in or out, and whether the alpha can
start after W5.

## Delivery plan

| Week | Goal | Ships |
| --- | --- | --- |
| W1 | Packages land; bot model; local mirror; roster skeleton | monorepo migration, `bot.json` schema, persistence, roster page without chat |
| W2 | Cloud bot host and the chat path | queue + inbox/outbox + supervisor + watchdog; an echo bot answers end to end |
| W3 | Approvals and cost | gated action stops in the panel, decision resumes it; cost bar; timeout/replay tests |
| W4 | Resume, recovery, onboarding | bot survives restart and a dead host; wizard; three-minute demo path works |
| W5 | Release hardening | negative tests, version matrix, npm publish, CI, alpha seed, tag `v0.1.0` |
| W6–7 | Alpha and fixes | 10–20 seed users, fixed top issues, no billing complaints |

## Task breakdown (P0)

| ID | Task | Definition of done |
| --- | --- | --- |
| A1 | Migrate `dsh-rayrun-computer` into `packages/` | package unchanged in behavior, README links fixed |
| A2 | Scaffold `packages/dsh-rayrun-bots` bundle | loads in DSH, host and client halves resolve |
| A3 | CI: `node --check` + plain-Node tests | runs on every push, red when a test fails |
| B1 | Bot schema and validation | invalid bot definitions are rejected with a clear error |
| B2 | Machine-side persistence | bot state survives host restart and machine stop/start |
| B3 | Local mirror + recovery pull | losing the machine is recoverable from local state |
| B4 | Roster CRUD | create/edit/delete a bot from the panel |
| C1 | Supervisor boot via projection | host starts on a fresh machine without manual shell |
| C2 | Queue and busy handling | second request queues; `409` is retried, never lost |
| C3 | Inbox/outbox protocol | message → prompt → reply works with no inbound network |
| C4 | Watchdog and restart | host death is detected and recovered within 60 s |
| C5 | Machine log file | one log per bot, no secrets, readable from local |
| D1 | Session wiring per spike S1 | chosen strategy implemented and covered by a test |
| D2 | Per-bot directories | memory and sessions are isolated per bot |
| D3 | Resume test | closing and reopening continues the conversation |
| E1 | Approval gate in the host | gated action blocks before the side effect |
| E2 | Local poller and card | card appears ≤ 10 s, decision returns ≤ 10 s |
| E3 | TTL and fail-closed | unanswered, expired or malformed means deny |
| E4 | Negative tests | replay, wrong bot, wrong action hash are rejected |
| F1 | Panel pages | roster, bot chat, approval inbox, computer view |
| F2 | Cost bar | balance and machine hours shown from Rayrun usage |
| F3 | Onboarding wizard | four steps, each with a working default |
| G1 | Idle stop integration | stops, never destroys; skipped when a task is running |
| G2 | Quickstart dogfood | the documented three-minute path works on a clean machine |
| G3 | Version matrix | DSH version × image × package recorded and enforced |
| G4 | npm publish | bootstrap token first, then OIDC trusted publishing |
| H1 | Release notes and tag | `v0.1.0` tagged from `main`, checks green |

## Risks and mitigations

| Risk | Trigger | Mitigation |
| --- | --- | --- |
| Session resume contract is not what we think | S1 shows neither long-lived host nor id resume works | fall back to transcript replay, cut cost/quality expectations, re-scope |
| Long-lived host cannot be restarted | watchdog cannot bring it back after a machine restart | start the host on open/connect, document the caveat, ask Rayrun for a start hook |
| Approval latency kills the UX | p95 needs more than 10 s | shorten polling, switch to `exec`-based mailbox, or move IM forward |
| Balance exhaustion deletes machines and disks | account hits zero | pull bot state locally, warn in the cost bar, recommend lifetime caps, never auto-destroy |
| Scope creep (IM, desktop, routines) | W3 overruns | P1 items are cut at the W3 gate; MVP ships P0 only |
| Public ingress temptation | someone asks for a panel URL | forbidden: no inbound, no `public` desktop as the panel |
| Old repo migration stalls | rename blocked or history conflicts | copy code with package names unchanged; do not block W1 |
| DSH version drift between image and laptop | plugins load but tools fail | version matrix in W5, pinned image request to Rayrun |

## Metrics

Install → sign-in conversion; first-bot success rate; approval latency p50/p95;
week-2 retention; recovery events per user (watchdog restarts, resumed sessions);
support issues per user; Rayrun spend per user per week.

## Open decisions for sign-off

1. **Bot concurrency**: serialized queue for v0.1 (recommended) or a machine per bot.
2. **Routines**: one cron per bot as P1 (recommended) or cut entirely from v0.1.
3. **Approval channel**: file mailbox for v0.1, IM in v0.2 (recommended).
4. **Old repo**: rename with history (recommended) or fresh copy.
5. **npm ownership**: which account owns `dsh-rayrun-computer` and `dsh-rayrun-bots`, and who configures trusted publishing.

## Definition of done for v0.1.0

- Every exit criterion above is demonstrated, not asserted, on a clean machine.
- `README.md`, `README.zh-CN.md` and `docs/quickstart.md` describe the shipped
  behavior, including what is still missing.
- CI is green, the version matrix is documented, and the npm tarball contains the
  host half, client half, locale and bundle patch.
- The approval path has passing negative tests, and no secret appears in any log,
  fixture or tarball.
