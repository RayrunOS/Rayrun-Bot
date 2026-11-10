# Architecture

*Status: 2026-11-10. This is the design v0.1 is being built against. What actually
runs today is the cloud-computer plugin, a **separate project** at
[RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)
that this project consumes as a dependency; the bot half described here is not
built. Untested pieces are marked **TBD**.*

## The picture

```
you ── chat / approve ──▶ DSH client (browser tab or desktop app)      [today: DSH]
                            │  plugin client half:
                            │  cloud-computer page · bot roster* · approval inbox*
                            │  computer view* · cost bar*
                            ▼
                      local DSH host + plugin host half               [today / planned*]
                      tools · same-origin RPC · tool guard
                      bot registry* · bot↔session mapping* · scheduler*
                            │  HTTPS; Rayrun token never leaves the host
                            ▼
                      Rayrun API · https://api.rayrunos.com/v1
                      sandboxes · exec · files · agent prompts + SSE ·
                      credentials · billing
                            ▼
        your Rayrun cloud computer (one per person, shared by your bots)
          ├─ persistent DSH host (web profile)                        [planned; today the
          ├─ one session + one profile dir per bot                    platform starts
          ├─ /workspace · X11 desktop :99 · browser profile           `dsh --profile headless`
          └─ model calls ──▶ DeepSeek API (your key, injected           per prompt]
                             into the agent process only)
```

`*` = not built yet.

## Layers

**1. Thin client.** The user talks to bots, approves actions and changes
settings in DeepSeek Harness itself — `dsh web` in a browser tab, or the DSH
desktop app. The plugin's client half adds pages to that UI: today the
cloud-computer page and the per-session cloud/local toggle; planned are the bot
roster, approval inbox, computer view and cost bar. We reuse DSH's chat,
sessions, approval UI, settings and plugin handling instead of writing a
separate app. The tradeoff: we are bound by DSH's client APIs. A standalone
desktop shell is deferred until there is evidence it is needed (see
[roadmap.md](roadmap.md)).

**2. Local DSH host + two plugin halves.** Two bundles run in the same profile.
The separate cloud-computer plugin registers the `rayrun_*` tools, the
same-origin RPC route (`/plugins/rayrun/rpc`) and a tool guard that enforces the
cloud/local choice. Rayrun Bot's host half consumes that surface — it does not
fork or vendor it — and adds the bot registry, the bot↔session mapping, the
scheduler and approval routing. Together they are the authority for
configuration, profile projection and file merges. Once the persistent host
lands, bot sessions and memory are authoritative on the machine — see
[Where the truth lives](#where-the-truth-lives). The tradeoff: anything the bot
needs in the background depends on a host that is running somewhere — today only
on the user's own machine.

**3. Rayrun API.** A single HTTPS API at `https://api.rayrunos.com/v1` for
machine lifecycle, commands, files, agent prompts (streamed over SSE),
credentials and billing. The Rayrun token lives in the Harness vault on the
host side and is used only here. One machine runs one agent task at a time; a
second prompt while busy returns `409 sandbox_busy` rather than queueing.

**4. The cloud computer.** One Linux machine per person, shared by that
person's bots: own vCPU and memory, a persistent `/workspace`, an X11 desktop
on `:99`, and a browser profile. The design wants a persistent DSH host inside
the machine (web profile), with one session and one profile directory per bot
so a bot can resume instead of restart. Today the platform starts
`dsh --profile headless` for each prompt, so sessions do not yet survive a run
and the persistent-host piece is **TBD**.

**5. Bot↔session mapping.** A bot is meant to be a persistent object: name,
instructions, skills, a memory directory and a session id, all on the machine.
The mapping from bot to session must be stored outside host memory — the
existing plugin keeps routing state, locks and idle timers in memory and loses
them when the host restarts. How DSH resumes a specific session from the cloud
path is **not verified**; this is one of the platform questions v0.1 has to
answer.

**6. Approval channel.** The intended flow: a gated action in DSH asks the
approval seam, the host half routes the request to the client half, the user
answers in a card, and the decision is written back to the waiting action.
Local-first means the approval can come from the user's own browser; IM is a
later channel. Fail-closed is the contract: timeout, unknown answer or closed
panel means no.

**7. Routines and triggers.** Scheduled or event-triggered prompts that wake a
bot: cron-like schedules, webhooks, and messages from channels. DSH has
scheduling in its core, and the web profile mounts it; a headless cloud profile
does not, so routines need the persistent host above.

**8. Model providers.** The bot thinks with the user's own DeepSeek API key,
stored as a Rayrun credential and injected into the agent process. Other model
providers are DSH's business, not this repo's; v0.1 is DeepSeek-first and a
provider abstraction is not designed.

## Design decisions and tradeoffs

| Decision | Why | Tradeoff |
| --- | --- | --- |
| Thin client on DSH | no rewrite of chat/approvals/plugins; distribution is a plugin install, not a signed app | bound by DSH client APIs; multi-tenant and push support would be ours to build |
| Local-first for ownership | the user's checkout is authoritative and cloud work is reviewable; bot sessions live on the machine and are pulled back for review | two writers must reconcile through the review/merge path, and a bot cannot keep working while the laptop is closed until a persistent cloud host exists |
| Bring your own accounts | no project-owned control plane, no keys or meters held by us; Rayrun gets the compute revenue, DeepSeek the model revenue | no protection layer from us: balance, spend and provider terms are the user's |
| One computer per person | cheaper, and bots share files/browser/credentials like a person's tools | a bot is **not** a security boundary; two bots must not be used as sandboxes against each other |
| Separate cloud-computer project | reuse a proven cloud layer without forking or merging repositories; the other project keeps its own history and users | two packages and a version contract; install friction; feature requests cross repositories |
| Bot = persistent object | a bot is more than a chat session: instructions, skills, memory, schedule | the durable-object contract (session resume, per-bot dirs) is unverified |
| Approvals fail-closed | external side effects need a human yes | more UX work; and today the cloud path has approvals **off** (`approval: never`) until the channel exists |
| Cost guardrails | always-on machines have a real bill (about ¥57.6/month for 2 vCPU / 2 GiB at 24/7 at the time of writing) | the platform has no idle auto-stop or spend cap today; the plugin can stop idle machines but not enforce a budget |
| Rayrun-only for now | one integration done well beats a provider abstraction done early | switching the backend later is a rewrite; the abstraction is an open decision |

## Where the truth lives

Local-first does not mean execution has to happen on the user's laptop. It means
the user owns the data and makes the decisions; the cloud computer is the user's
own rented machine, not somebody else's server. Splitting the layers keeps the
two ideas compatible:

| Layer | Authority | On the machine | Conflict rule |
| --- | --- | --- | --- |
| Code and workspace | the user's checkout | a copy in `/workspace` | push verifies both hashes; pull lands in `.dsh/incoming/` and is never applied automatically; the user merges |
| Bot state, sessions, memory | the cloud computer | the live session, profile dir and memory dirs | local copies are read-only mirrors; pull them back for review and as a recovery anchor |
| Approvals | the human | only the channel that asks | fail-closed: an unreachable user, a timeout or an unknown answer means no; the machine never answers for the user |
| Credentials | the user's side | the model key injected into the agent process, when the user supplied it | the Rayrun token stays in the local Harness vault and never enters the machine |
| Profile and bot definitions | the local DSH profile | a hash-verified projection | drift is detected and the local side wins; re-project before restarting a bot |

The one-line rule: **local-first for ownership and decisions, cloud for
execution.** A thin client makes the client cheap to replace; it does not move
trust away from the user.

## What this repo builds vs what Rayrun must add

This repo can build:

- the adapter to the separate cloud-computer plugin: capability calls over its
  tools/RPC, version checks, and a clear error when it is missing or too old;
- the bot registry, roster UI and bot↔session persistence;
- approval routing from DSH's approval seam to a browser card (IM later);
- routine/trigger wiring on top of DSH scheduling;
- the cost bar and the honest status reporting;
- packaging, tests and docs.

The cloud-computer plugin stays a separate project: we depend on it and never
modify it, and its own repository owns its roadmap.

The Rayrun platform has to add, for a real product:

- **the session and long-lived-runtime contract** — whether a session id can be
  created or continued, and how a supervised process survives stop/start, is
  unverified and is v0.1's biggest unknown;
- **balance grace and guardrails** — exhaustion force-destroys machines and
  disks today, and there is no spend cap or budget alert;
- **safe inbound networking** — the token tier of the ingress API is unusable
  today, so only `public` works; v0.2 needs a product-safe entry;
- **idle auto-stop or wake-on-request** — today only `max_lifetime_seconds`
  exists, and it stops without restarting;
- **runtime egress updates** — a machine's allowlist is fixed at creation
  (the documented runtime endpoint was not usable in the 2026-11-01 test);
- smaller items: generic secret injection beyond model slots, full profile
  projection (skills/MCP, not just the worker layer), per-sandbox usage, and
  image/DSH version alignment.

The full handoff list, with priority and the workaround we ship in the meantime,
is [platform-asks.md](platform-asks.md).

## Concurrency, cost and failure

The cost model bounds the design. A machine is billed by the second, keeps its
disk while stopped, and loses everything (including its workspace) on destroy.
Balance exhaustion can force-destroy a whole organization's machines. So the
product must be honest about persistence: `/workspace` survives stop/pause, the
machine's memory does not; a bot that must keep working needs the machine
running and paid for. One machine runs one agent task at a time, so multiple
bots on one machine serialize unless a queue is built.

Availability is the user's Rayrun account plus the DSH host on their machine;
there is no HA, no SLA and no cross-region story in this design.

## Open questions

The decisions that would change this picture are tracked in
[FAQ](faq.md) and [roadmap](roadmap.md): backend abstraction, per-bot machines,
where approvals live (browser only or IM too), and whether v0.1 ships routines.
