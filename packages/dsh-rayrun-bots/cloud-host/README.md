# Cloud bot host

> Status: 2026-11-23. **Preview.** This directory ships as a package asset and
> is projected to the user's machine by `lib/host-projection.js`; it is not
> loaded by the DSH host half. The CLI can use a headless DSH agent; the library
> still defaults to an echo stub for tests.

A host for a Rayrun machine, intended to run under the platform `runtimes`
API (R-G008, ADR-036 in the Rayrun repo). **One process serves every bot on
the machine** with one serial queue, round-robin across bots:

- one queue per bot under `/workspace/.rayrun/bots/<id>/inbox/`;
- a chronological per-bot `transcript.jsonl`, one outbox entry per task;
- a global heartbeat/state file in `host/state.json` plus per-bot summaries;
- recovery of a task that was in flight when the process died;
- duplicate task ids are idempotent;
- a DSH session id persisted per bot in `bots/<id>/host/session-id` and reused
  for that bot's next task;
- an optional task `origin` (`chat` or `routine`); routine tasks keep the origin
  in the transcript, and a structured approval block from one is written with
  `origin: background` so the local approval TTL applies;
- stdout/state logs do not contain credential values.

The library agent defaults to `echo:<text>` for tests. `host.mjs` uses
`createDshAgent` when `DSH_BOT_AGENT=dsh`: it creates a `bot` profile from the
shipped `headless` template if absent, runs `dsh --profile bot --json` per
task, and passes `--session-id` after the first run. It never reads the Rayrun
token; `DEEPSEEK_API_KEY` is only observed as a boolean.

## Files

| File | Purpose |
| --- | --- |
| `lib/host.mjs` | Queue, transcript, outbox, state, session id and recovery; no timers |
| `lib/dsh-agent.mjs` | Headless DSH profile bootstrap and `--json`/`--session-id` runner |
| `host.mjs` | Process entry point: heartbeat and poll loops, SIGTERM/SIGINT |
| `lib/proposal.mjs` | Parse the structured approval block and write one typed proposal |
| `lib/routines.mjs` | Validate mirrored routine definitions and claim cloud schedule state |
| `lib/prompt.mjs` | Validate mirrored `bot.json` and build the full routine prompt |
| `bin/propose.mjs` | Optional CLI proposal writer for shell-capable bots; no token, no network |
| `test/cloud-host.mjs` | Host checks with a fake agent; no framework, no network |
| `test/cloud-host-routines.mjs` | Cloud routine scheduler checks with a fake agent |
| `test/cloud-host-dsh-agent.mjs` | DSH agent checks with a fake `dsh` executable |

## Run the checks

```bash
node test/cloud-host.mjs
node test/cloud-host-routines.mjs
node test/cloud-host-dsh-agent.mjs
```

## Live dev acceptance

The host was uploaded to a devcheck Rayrun machine and registered as a
`runtimes` entry with `restart=always`, `autostart=true`, `keep_alive=true`
and the `deepseek-flash` credential. It passed (2026-11-22/23):

- `PUT` runtime → running, heartbeat and `hasCredential=true`;
- three tasks produced `user,bot` pairs in order and one outbox file each;
- sandbox `stop → start` autostarted a new host process;
- `kill -9` restarted the host with a new pid and `restarts=1`;
- no task was duplicated after recovery.

DSH session spike on the same dev image (DSH 0.2.0-rc.2):

- direct `dsh --profile headless --json` answered `RUN1_OK`;
- the same session id via `--session-id` answered `ALPHA` on the next process;
- the host with `DSH_BOT_AGENT=dsh` answered `HOST1_OK` then `BETA`, stored the
  DSH session id, and wrote the expected transcript/outbox;
- automatic projection (2026-11-23): the adapter uploaded these assets to
  `/workspace/.rayrun/host/0.1.0-alpha.0/`, verified the SHA-256 manifest, and
  the page E2E replied `HOST_E2E_OK`.

The dependency's `dsh.start` produced no `reply.md` on this image because its
oneshot manifest runs `/bin/sh -c`, not DSH. Use a DSH stdin/ndjson image for
`dsh.start`; the host's direct-DSH path does not depend on the oneshot argv.

See `docs/10-rayrun-verification.md` §3.1 for the full record. The test machine
was stopped (not destroyed); the dev token was revoked and its temporary files
were removed.

## Intended runtime spec (dev)

```json
{
  "name": "bot-host",
  "argv": ["node", "/workspace/.rayrun/host/<package version>/host.mjs"],
  "workdir": "/workspace",
  "env": {
    "DSH_BOT_ROOT": "/workspace/.rayrun",
    "DSH_BOT_AGENT": "dsh",
    "DSH_BOT_PROFILE": "bot",
    "DSH_HOME": "/workspace/.rayrun/dsh",
    "HOME": "/workspace/.rayrun/home",
    "DSH_BOT_LOG": "/workspace/.rayrun/logs/bot-host.log",
    "DSH_BOT_PROPOSE": "/workspace/.rayrun/host/<package version>/bin/propose.mjs",
    "DSH_BOT_MACHINE": "<cloud computer name>"
  },
  "credentials": ["deepseek-flash"],
  "restart": "always",
  "autostart": true,
  "keep_alive": true,
  "stop_signal": "SIGTERM",
  "stop_timeout_seconds": 10
}
```

The multi-bot queue has plain-Node coverage (round-robin, independent session
ids, recovery and state), and the multi-bot single-host page E2E passed on
2026-11-23 (`MULTI_A_OK`/`MULTI_B_OK`, independent sessions, one `bot-host`).

The adapter sets `DSH_BOT_PROPOSE` and `DSH_BOT_MACHINE` in the runtime spec and
passes `DSH_BOT_ID` to each agent process, so `bin/propose.mjs` can write the
proposal under the current bot. The adapter projects the assets with `lib/host-projection.js` into
`/workspace/.rayrun/host/<package version>/` and verifies the SHA-256 manifest
before registering the runtime. An explicit `hostScript` config bypasses the
projection for development.

## Approval proposals

The primary path is structured: the bot ends its reply with a fenced
`rayrun-approval` block; the cloud host parses it and writes one typed proposal
into `bots/<DSH_BOT_ID>/proposals/<id>.json`. The local DSH host imports it
through `rayrun_files`, re-validates it, and only a local human decision can
execute it (ADR-019). `bin/propose.mjs` remains an optional shell path for
images where the agent can run commands. The prompt uses the structured block;
the live E2E did not rely on shell execution. A proposal file is not an authorization.

```bash
DSH_BOT_ROOT=/workspace/.rayrun DSH_BOT_ID=my-bot \
  node bin/propose.mjs --kind rayrun.machine.stop --machine my-computer
```

The local bridge writes decisions/execution results to
`bots/<id>/approval-results/`. A stopped machine queues results locally and
uploads them on the next sync. A live cloud-bot proposal -> local approve -> real
`machine.stop` -> stopped outbox -> restart flush, and a live start approval
whose next-turn prompt carried the recent outcome, both passed on 2026-11-23;
the live bot used the structured block, not the optional CLI.

## Routine scheduling (preview)

The local host mirrors each bot's `routines.json` and `bot.json` into the
workspace while the machine is Running. The cloud host validates it, keeps its own claim in
`bots/<id>/host/routines-state.json`, and enqueues at most one due routine per
idle bot per tick:

- the run is claimed before the inbox task is written, so a crash cannot replay
  the same interval;
- a bot with queued/processing work is skipped until a later tick;
- missed intervals are not backfilled;
- a routine task carries `origin: routine` and `routineId`; the task text is the
  routine prompt, and `lib/prompt.mjs` expands it with the mirrored `bot.json`
  and the structured approval hint before the DSH run; the persistent DSH session
  carries the conversation, so the prompt does not replay the transcript;
- its approval proposal is `background` and its successful reply is written to
  `bots/<id>/routine-results/<taskId>.json` (latest 200 kept).

The local `routines.sync` bridge uploads definitions and imports results only
while the machine is Running; it never wakes a stopped machine. Imported results
are display history merged by `session.history`, not queue state. The cloud
scheduler has fake end-to-end coverage but no live Rayrun run yet. A failed
routine task writes `state: failed` + `error` to the same results directory, and
local history shows it as an `E_ROUTINE_FAILED` system error.

## Not built yet

- a production guestd 0.6 + DSH image and build/deploy pipeline;
- approval actions beyond machine start/stop/pause/resume;
- live validation of the routine scheduler, routine failure display and
  cron/event triggers;
- package release and the one-install path.
