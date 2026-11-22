# Cloud bot host POC

> Status: 2026-11-22. **Proof of concept, not shipped.** This directory is not
> part of `packages/dsh-rayrun-bots`, is not in the npm tarball, and is not
> wired to the local Bots control plane. The agent is an echo stub.

A minimal host for a Rayrun machine, intended to run under the platform
`runtimes` API (R-G008, ADR-036 in the Rayrun repo). It proves the lifecycle
mechanics that the future cloud bot runtime needs:

- one queue under `/workspace/.rayrun/bots/<id>/inbox/`;
- a chronological `transcript.jsonl`, one outbox entry per completed task;
- a heartbeat/state file in `host/state.json`;
- recovery of a task that was in flight when the process died;
- duplicate task ids are idempotent;
- stdout/state logs do not contain credential values.

The POC does **not** call DSH or the model. `agent` defaults to `echo:<text>`.
It never reads the Rayrun token; `DEEPSEEK_API_KEY` is only observed as a
boolean to prove boot-time credential injection.

## Files

| File | Purpose |
| --- | --- |
| `lib/host.mjs` | Queue, transcript, outbox, state and recovery; no timers |
| `host.mjs` | Process entry point: heartbeat and poll loops, SIGTERM/SIGINT |
| `test/host.mjs` | Plain-Node checks; no framework, no network |

## Run the checks

```bash
node tools/cloud-host-poc/test/host.mjs
```

## Live dev acceptance (2026-11-22)

The POC was uploaded to a devcheck Rayrun machine and registered as a
`runtimes` entry with `restart=always`, `autostart=true`, `keep_alive=true`
and the `deepseek-flash` credential. It passed:

- `PUT` runtime → running, heartbeat and `hasCredential=true`;
- three tasks produced `user,bot` pairs in order and one outbox file each;
- sandbox `stop → start` autostarted a new host process;
- `kill -9` restarted the host with a new pid and `restarts=1`;
- no task was duplicated after recovery.

See `docs/10-rayrun-verification.md` §3.1 for the full record. The test machine
was stopped (not destroyed); the dev token was revoked and its temporary files
were removed.

## Intended runtime spec (dev)

```json
{
  "name": "bot-host",
  "argv": ["node", "/workspace/.rayrun/bin/host.mjs"],
  "workdir": "/workspace",
  "env": {
    "DSH_BOT_ROOT": "/workspace/.rayrun/bots/demo",
    "BOT_ID": "demo"
  },
  "credentials": ["deepseek-flash"],
  "restart": "always",
  "autostart": true,
  "keep_alive": true,
  "stop_signal": "SIGTERM",
  "stop_timeout_seconds": 10
}
```

For the POC, upload both files with the platform files API, preserving the
relative path:

```
.rayrun/bin/host.mjs
.rayrun/bin/lib/host.mjs
```

A shipped image/worker projection still needs to be chosen.

## Not built yet

- DSH agent execution and session continuation (the current agent is a stub);
- local control-plane transport (inbox/outbox upload/poll) and the
  `dsh-rayrun-computer` `runtime.*` host RPC;
- approval proposals or execution (ADR-001 remains closed);
- image build/release and the one-install path.
