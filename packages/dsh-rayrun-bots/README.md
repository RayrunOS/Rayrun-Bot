# dsh-rayrun-bots

The Rayrun Bot plugin package. Status: **client shell with a local roster and
local sessions** — the bundle loads, the client half renders the v0.1 screens,
and the host half answers health, persists the bot roster, and stores a durable
per-bot session/transcript. With `dsh-rayrun-computer` 1.1+, a turn is posted as
a detached `dsh.start` task, its task id is persisted, and `reply.md` is
collected from the task result directory; 1.0.x falls back to the single-turn
`rayrun_agent` tool, and without either surface `session.send` fails closed with
`E_RUNTIME_UNAVAILABLE`. One-turn and detached live Rayrun smokes were verified
on 2026-11-22; the detached smoke closed the page and restarted the local DSH
while the task ran, and the restarted host collected `reply.md`. A second-turn
smoke stopped the machine, restarted DSH, and the next turn answered from the
persisted transcript. With 1.2+, a host-side `runtime.*` client is ready for
the platform-supervised bot host. The opt-in `cloudHost` runtime adapter ships
the host assets in this package, projects them with a SHA-256 manifest through
the dependency's `rayrun_files` tool, and wires one multi-bot host process into
`session.*`. It is preview and has passed a dev page E2E.
Approval execution now follows ADR-019: the local host is the authority and
executor for typed local actions, while the cloud side may only propose. The
first allowlist is `rayrun.machine.start/stop/pause/resume`; an approved
request gets a durable at-most-once execution claim, and denied, expired, or
crashed requests never execute. A cloud bot emits a structured `rayrun-approval`
block; the cloud host writes the proposal and the local `approvals.sync` bridge
imports it. A live cloud proposal -> local approve -> real machine stop -> stopped
result outbox -> restart flush, plus a start approval and next-turn outcome
context, passed on 2026-11-23. Other action types and
cloud-only credential actions are still pending. The conversation UI
uses the host session and real approval cards for roster bots; sample bots,
receipts and settings remain an in-memory preview. Real bots can create, pause
and remove local routines; the local scheduler enqueues one ordinary turn when a
routine is due. The page-level create/reload path was verified on 2026-11-21,
and the approval card deny/fail-closed path on 2026-11-23. Repository-level
status and verified combinations live in
[docs/12-status.md](../../docs/12-status.md).

## What it does today

- Host half: `GET /plugins/rayrun-bots?action=health` returns
  `{ ok: true, plugin: "rayrun-bots", version, ready: false, dependency, runtime }`.
  `dependency` reports `dsh-rayrun-computer` as `ok`, `missing` (`E_DEP_MISSING`),
  `incompatible` (`E_DEP_VERSION`), or `unknown` when no profile context exists.
  `runtime` reports the adapter name and whether its tool is currently
  registered. `POST` is same-origin gated: a browser `Origin` that does not
  match the request `Host` is refused with 403. No credentials are touched.
- Host half: `bots.list`, `bots.get`, `bots.create`, `bots.update` and
  `bots.delete` persist validated `bot.json` files under
  `$DSH_HOME/state/rayrun-bot/bots/<id>/` (atomic writes, private modes, stable
  `E_BOT_*` errors). The roster is the user's intent store until the cloud
  runtime lands; the machine will become the runtime truth. Ids are derived
  from the name when the client does not send one, and collisions get a numeric
  suffix.
- Host half: `routines.list/create/update/remove/sync` persist at most 32
  validated routines per bot in `routines.json` beside `bot.json`. A routine has
  a title, prompt, 1–10080 minute interval, enabled flag and next-run time. In
  the default non-cloudHost mode, the local scheduler checks every 30 seconds,
  enqueues at most one ordinary session turn per bot per tick, skips a busy bot,
  and does not backfill missed intervals. It claims the run
  (`lastRunAt`/next `nextAt`) before enqueueing, so a crash cannot replay it; a
  failed enqueue waits for the next interval instead. In cloudHost mode the
  local scheduler is disabled: the bridge mirrors `routines.json` and `bot.json`
  while the machine is Running, the cloud host claims schedule state and
  enqueues the task, expands it with the mirrored bot instructions and approval
  hint (the DSH session carries the conversation), and `routines.sync` imports
  routine results into local history. That cloud path has a fake E2E and a
  Rayrun dev/test live E2E (2026-11-24); production is still waiting for the
  platform deployment. A routine is a normal user turn and does not bypass
  approval. Because it uses the normal send path, a due routine may
  wake a stopped or paused machine and incur machine-hour charges; the interval
  and enabled switch are standing authorization, not per-run approval.
- Host half: `session.send`, `session.history` and `session.status` persist a
  per-bot `session.json` and append-only `transcript.jsonl` beside `bot.json`.
  Sends are queued one turn at a time; a runtime failure writes a redacted
  system line and leaves the transcript intact; a host restart marks a running
  turn `interrupted` instead of replaying it. When the dependency's
  `rayrun_agent` tool is registered, a queued turn is sent to the existing cloud
  computer (the adapter refuses to auto-create one); a stopped or paused machine
  is woken by the dependency, which may incur machine-hour charges. Without the
  tool, `session.send` returns `E_RUNTIME_UNAVAILABLE` and writes no session.
- Host half: `approvals.list/get/decide/propose/sync` operate on one request,
  decision and execution claim per approval under `bots/<id>/approvals/`.
  Requests carry an action id, nonce and canonical SHA-256 action hash; background
  requests expire after 30 minutes, chat requests wait; duplicate decisions are
  idempotent and a conflicting or replayed decision is refused. Every request,
  decision, refusal and execution is appended to `logs/audit.log` without the
  action payload. `propose` is host-side only and validates a typed action
  (`rayrun.machine.start`, `stop`, `pause`, `resume`). On approve, the local
  executor writes an `exec-<id>.json` claim and calls the dependency's Rayrun RPC
  with the token kept in the Harness vault; a failed execution is recorded and
  not retried. `sync` imports typed proposals from the cloud workspace with
  `rayrun_files`, validates them again and deduplicates by proposal id; decisions
  and execution results are written back to `approval-results/` (a stopped
  machine queues results locally for the next sync). The next cloud prompt also
  includes recent approval kind/target/state/execution/status, without payloads. Other action kinds are not
  built; the proposal bridge has fake-tool tests, and a live cloud-bot proposal
  E2E is still pending.
- Client half: a `Bots` sidebar entry and the three-column shell from
  [docs/design/ui-design.md](../../docs/design/ui-design.md) — chat list, conversation,
  details (Activity / Library), new bot, the four-step setup wizard, and
  settings. When the host roster has entries, the chat list shows those bots
  instead of the sample list; creating a bot in the new-bot screen or the setup
  wizard writes through to the host and selects the saved bot. For real roster
  bots, messages and approval cards come from the host session and approval
  store; real bots also create, pause and remove routines through the host, and
  the five-second poll imports cloud routine results into the conversation.
  Sample bots, receipts, sample routines and settings still live in the page
  only. Deny /
  Allow once for real approvals goes through the host and can execute a typed
  local action; after a decision the real card offers Continue bot, which sends
  the next turn only when the user clicks it. Sample cards update in-memory state. The client
  activates Bots on load and covers the DSH
  sidebar and bottom bar; there is no in-product return to the Harness shell
  (ADR-017). The setup Rayrun step calls the cloud-computer plugin's
  same-origin RPC with a pasted token and shows the real balance/machine count.
  The computer step calls `overview` and adopts an existing machine, or calls
  `machine.create` with the plugin's defaults; a pasted DeepSeek key is passed as
  `modelKey` and becomes the machine's Rayrun credential, then the input is
  cleared. The step says the machine is billable, and the button is disabled
  until Rayrun is connected. When several machines exist, Bots prefers
  `rayrun-bot`, then a machine with a desktop URL, then the first. Creating a
  machine was run on a real Rayrun account from a local harness with test keys
  (the keys never entered the sandbox); the Bots page adoption and Continue
  paths were run in a local DSH page, but the page-level create button itself
  still needs a pass with no existing machine.
  `Open` / `Take over` on the computer card uses the same RPC to start or resume
  the machine, wait for `Running`, repair the desktop service, read `desktop_url` and the desktop password,
  then open the desktop in a new tab and show the password in a dismissible
  toast; both buttons currently run the same path. It fails closed with one
  actionable line when Rayrun is not connected, there is no machine, the popup
  is blocked, the machine does not start in time, or it has no desktop. The
  start/repair/desktop/password path was run locally against a real machine, and
  the Bots page Open flow was run in a local DSH page (desktop window and
  password toast). When the machine is running, `Stop` asks for inline
  confirmation, calls `machine.action` with `stop`, polls to Stopped, and never
  destroys; the page-level Open to Stop path was also run in the local page.
  The Settings Usage row reads the real balance, machine-hours and machine count
  through the same RPC; without a connection it says so instead of showing sample
  numbers. The details panel's computer and usage blocks use the same overview
  data: real machine name/status, balance and machine-hours when connected, and
  an explicit Not connected / connect prompt when not. The copy ships in Chinese
  and English, Chinese primary and following the DSH language; the Settings
  language row writes the choice back to DSH so it survives a reload. The rest
  stays in the page, and the client keeps neither the token nor a DeepSeek key.

Not built yet: approval actions beyond machine start/stop/pause/resume, cloud-only
credential approvals, a Bots-page-level verified computer-creation success path,
production validation of the cloud-host routine scheduler, cron/event triggers,
a production cloud image, and the npm release path. The local routine store/
scheduler, cloud routine bridge, cloud scheduler, failed-result history and
result merge have plain-Node coverage, a fake end-to-end test, and a Rayrun
dev/test live E2E (cloud run while local DSH was stopped); the detail-panel
create, pause and remove paths passed a local DSH + Firefox smoke on 2026-11-23
without a Rayrun token, but no local scheduled turn was waited on. Approved
start/stop, denial/Continue, and the next-turn approval context were verified live
on 2026-11-23; pause/resume is also live. See the repo-level
[MVP plan](../../docs/plans/mvp-plan.md) and [client plan](../../docs/plans/client-plan.md).

## DSH compatibility

`package.json` declares `engines.dsh: >=0.2.0-rc.2 <0.3.0`. DSH `0.2.2-rc.5`'s
compatibility check reads that range: an out-of-range install is refused and the
profile is restored, and an incompatible row is disabled at composition. Older
runtimes that ignore `engines.dsh` still load the bundle. The range covers the verified runtimes: `0.2.0-rc.2` (the Rayrun
cloud image), `0.2.2-rc.5`, and `0.2.1-rc.5` from the CI matrix. It is not a claim
that every feature works on every version; see the repository's
[version matrix](../../docs/version-matrix.md) for the combinations actually
verified.

## Install from a checkout

Install this directory into the current DSH profile: **Plugins → Add plugin** and
point it at `packages/dsh-rayrun-bots`, or use the `plugin_manager`
`install_bundle` action with the package's absolute path. Refresh the DSH page;
the client half loads when the page starts.

The cloud-computer dependency (`dsh-rayrun-computer`) is **not declared as a
package dependency**: install both packages in one `dsh plugin add` command so
both bundles are selected. Installing only this package does not activate the
dependency's bundle. The host detects the installed version at runtime and
reports it through health.

Install the packed artifact instead of the checkout:

```bash
npm pack ./packages/dsh-rayrun-bots --pack-destination /tmp
dsh plugin --profile web add /tmp/dsh-rayrun-bots-0.1.1-alpha.1.tgz
```

`test/package-contents.mjs` checks the tarball with `npm pack --dry-run`: the
host half, client half, locale, bundle patch, `lib/*.js`, icon, README and
LICENSE must ship; tests, docs, tools and environment files must not.

## Checks

No build step, no runtime dependencies. Plain ESM, Node 24+.

```bash
node --check index.js
node --check client.js
node test/manifest-check.mjs
node test/locale-audit.mjs
node test/rpc-contract.mjs
node test/client-contract.mjs
node test/bot-schema.mjs
node test/bot-store.mjs
node test/session-runtime.mjs
node test/rayrun-runtime.mjs
node test/rayrun-detached-runtime.mjs
node test/runtime-rpc.mjs
node test/cloud-host-runtime.mjs
node test/host-projection.mjs
node test/cloud-host.mjs
node test/cloud-host-routines.mjs
node test/cloud-host-dsh-agent.mjs
node test/cloud-routine-bridge.mjs
node test/cloud-routine-e2e.mjs
node test/bot-workspace.mjs
node test/dependency.mjs
node test/approvals.mjs
node test/approval-executor.mjs
node test/cloud-approval-bridge.mjs
node test/cloud-host-proposal.mjs
node test/routines.mjs
node test/routine-results.mjs
node test/package-contents.mjs
```

The same commands run in the repository's checks-only CI workflow on push and
pull requests, on Node 24 and 26: [`.github/workflows/checks.yml`](../../.github/workflows/checks.yml).
CI also installs this package into a throwaway DSH profile and composes its
config against DSH `0.2.1-rc.5` and `0.2.2-rc.5`; it does not start the web app,
test the cloud-computer plugin, or make Rayrun calls. Live integration tests
need real Rayrun credentials and never run in CI.

## Layout

```
package.json       # name, exports, dsh.bundle + dsh.client
cordis.patch.yml   # the bundle row (id rayrun-bots -> package dsh-rayrun-bots)
index.js           # host half: same-origin RPC, health + bots.* + session.* + approvals.*
client.js          # client half: v0.1 shell, roster read/write, preview conversation
lib/approvals.js   # approval request/decision protocol, TTL, action hash, audit
lib/approval-actions.js # typed local action allowlist (machine start/stop/pause/resume)
lib/approval-executor.js # local at-most-once execution claim and audit
lib/cloud-approval-bridge.js # import cloud proposals and write results
lib/bots.js        # persistent roster: list/get/create/update/delete
lib/bot-schema.js  # bot.json validation, defaults and creation
lib/bot-workspace.js # per-bot local git checkout for detached tasks
lib/dependency.js  # dsh-rayrun-computer detection, version, detached/runtime gates
lib/errors.js      # stable error codes (shared with docs/plans/mvp-plan.md §4.3)
lib/local-store.js # state-directory resolution and atomic JSON writes
lib/rpc.js         # JSON responses and request-body parsing
lib/runtime.js     # single-turn and detached runtime contracts
lib/runtime-rpc.js # host-side runtime.* client (cloud bot host)
lib/cloud-host-runtime.js # opt-in persistent host runtime over runtime.* + rayrun_files
lib/host-projection.js # SHA-256 manifest and projection of cloud-host assets
lib/routines.js    # per-bot routine definitions and local schedule state
lib/routine-scheduler.js # local due checks and ordinary session turns
lib/routine-results.js # imported cloud routine results for history
lib/cloud-routine-bridge.js # definitions upload and result import; never starts a machine
cloud-host/host.mjs # cloud host entry point (projected to the machine)
cloud-host/lib/host.mjs # queue/transcript/outbox/session id/DSH agent wiring
cloud-host/lib/dsh-agent.mjs # headless DSH profile + --session-id runner
cloud-host/lib/proposal.mjs  # structured approval block parser/writer
cloud-host/lib/routines.mjs  # cloud routine definitions/state and due selection
cloud-host/lib/prompt.mjs    # full routine prompt from bot.json + cloud transcript
cloud-host/bin/propose.mjs   # typed approval proposal writer for the bot
lib/rayrun-rpc.js  # shared same-origin dependency RPC caller
lib/rayrun-runtime.js # rayrun_agent-backed runtime adapter
lib/rayrun-detached-runtime.js # dsh.start/status/result adapter
lib/sessions.js    # per-bot queue, transcript and detached polling
locale/en.json     # source copy
locale/zh.json     # mirror; keys must match
icon.svg           # plugin icon (Rayrun blue, monitor mark)
test/              # plain-Node checks, no framework
```

MIT © RayrunOS.
