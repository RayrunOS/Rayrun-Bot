# Cloud bot host

> Status: 2026-11-23. **Preview.** This directory ships as a package asset and
> is projected to the user's machine by `lib/host-projection.js`; it is not
> loaded by the DSH host half. The CLI can use a headless DSH agent; the library
> still defaults to an echo stub for tests.

A minimal host for a Rayrun machine, intended to run under the platform
`runtimes` API (R-G008, ADR-036 in the Rayrun repo). It proves the lifecycle
mechanics that the future cloud bot runtime needs:

- one queue under `/workspace/.rayrun/bots/<id>/inbox/`;
- a chronological `transcript.jsonl`, one outbox entry per completed task;
- a heartbeat/state file in `host/state.json`;
- recovery of a task that was in flight when the process died;
- duplicate task ids are idempotent;
- a DSH session id persisted in `host/session-id` and reused for the next task;
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
| `test/cloud-host.mjs` | Host checks with a fake agent; no framework, no network |
| `test/cloud-host-dsh-agent.mjs` | DSH agent checks with a fake `dsh` executable |

## Run the checks

```bash
node test/cloud-host.mjs
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
  DSH session id, and wrote the expected transcript/outbox.

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
    "DSH_BOT_ROOT": "/workspace/.rayrun/bots/demo",
    "BOT_ID": "demo",
    "DSH_BOT_AGENT": "dsh",
    "DSH_BOT_PROFILE": "bot",
    "DSH_HOME": "/workspace/.rayrun/dsh",
    "HOME": "/workspace/.rayrun/home",
    "DSH_BOT_LOG": "/workspace/.rayrun/logs/bot-host.log"
  },
  "credentials": ["deepseek-flash"],
  "restart": "always",
  "autostart": true,
  "keep_alive": true,
  "stop_signal": "SIGTERM",
  "stop_timeout_seconds": 10
}
```

The adapter projects the assets with `lib/host-projection.js` into
`/workspace/.rayrun/host/<package version>/` and verifies the SHA-256 manifest
before registering the runtime. An explicit `hostScript` config bypasses the
projection for development.

## Not built yet

- a production guestd 0.6 + DSH image and build/deploy pipeline;
- one host process serving multiple bots (currently one runtime per bot);
- approval proposals or execution (ADR-001 remains closed);
- package release and the one-install path.
