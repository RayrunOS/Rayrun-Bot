# Local file design — v0.1

*Status: 2026-11-11. Where every file lives: the plugin package in this
repository, the mutable state on the user's machine, and the cloud layout it
mirrors. This is the file half of [mvp-plan.md](mvp-plan.md) §4; UI surfaces are
in [client-plan.md](client-plan.md).*

## 0. Principles

1. **The install directory is immutable.** Code lives in the package; all mutable
   state lives under the DSH home state directory, never next to `index.js`.
2. **The local side is a mirror and a control surface.** The machine is
   authoritative for bot runtime, the user's checkout is authoritative for code,
   and the local files here are derived and rebuildable.
3. **No secrets on disk, for us.** The Rayrun token stays in the Harness vault
   and the DeepSeek key in Rayrun credentials; this project never writes either
   to a file, a log or the mirror.
4. **Every persisted file has a schema version, an owner and a retention rule.**
   Formats are JSON or JSONL; writes are atomic (`tmp` + rename); logs are
   append-only.
5. **No build step.** Plain ESM, kebab-case file names, one responsibility per
   module.
6. **Deleting local state is safe.** Losing `$DSH_HOME/state/rayrun-bot/` costs
   cache and audit history, not bots: the machine can rebuild it.

## 1. Repository layout — `packages/dsh-rayrun-bots/`

```
packages/dsh-rayrun-bots/
├── package.json          # name, exports, dsh.bundle.patch, dsh.client.inject, files
├── cordis.patch.yml      # the bundle row that mounts the host half
├── index.js              # host half entry: registers RPC, tools, routes
├── client.js             # client half entry, loaded by DSH on page start
├── README.md             # package-level install and limits
├── icon.png              # sidebar icon (P1)
├── locale/
│   ├── en.json           # source copy for every string
│   └── zh.json           # mirror; keys must match exactly
├── lib/
│   ├── rpc.js            # /plugins/<id>/rpc: envelope, origin check, size cap
│   ├── bots.js           # registry CRUD against the machine + mirror
│   ├── bot-schema.js     # bot.json validation, defaults, migration
│   ├── local-store.js    # state dir resolution, atomic writes, locks
│   ├── dependency.js     # detect dsh-rayrun-computer, version check, tool calls
│   ├── queue.js          # local queue view: enqueue, dispatch, retry
│   ├── approvals.js      # poller, state machine, decisions, TTL
│   ├── setup.js          # onboarding status: dependency, token, key, computer, bot
│   ├── cost.js           # balance / machine hours read and thresholds
│   ├── errors.js         # stable error codes and one-sentence copy
│   └── log.js            # redacted JSONL logging and rotation
├── client/
│   └── ...               # only if spike C-S1 proves relative module loading
└── test/
    ├── bot-schema.mjs
    ├── queue.mjs
    ├── approvals.mjs
    ├── rpc-contract.mjs
    └── locale-audit.mjs
```

Rules for this package:

- `package.json` lists exactly `index.js`, `client.js`, `cordis.patch.yml`,
  `lib/*.js`, `locale/*.json`, `icon.png` and `README.md` in `files`; a published
  tarball that misses a host module is a broken install.
- `client.js` is a **single file** in v0.1. DSH loads it as a client module and
  there is no build step, so pages and components are functions in that file
  until spike C-S1 proves relative imports work; only then may a `client/`
  directory appear.
- Import direction is one-way: `index.js` → `lib/*`; `client.js` stays
  self-contained; `lib/` never imports the client half.
- All user-facing copy lives in `locale/en.json` (source) and `locale/zh.json`
  (mirror). Keys are namespaced: `bots.*`, `approval.*`, `setup.*`, `cost.*`,
  `error.*`.
- Tests mirror modules: `test/<module>.mjs` for `lib/<module>.js`; no framework.
- The dependency on `dsh-rayrun-computer` is declared here once spike S6 confirms
  a bundle dependency loads both halves; until then the package documents the
  two-install path.

## 2. Local state — `$DSH_HOME/state/rayrun-bot/`

`$DSH_HOME` resolves from the environment (`%USERPROFILE%\.dsh` on Windows,
`~/.dsh` elsewhere). If the variable is unset we do not guess silently: setup
reports `E_HOST_DOWN` with the expected path. Everything here is created on
first boot with user-only permissions.

```
$DSH_HOME/state/rayrun-bot/
├── schema.json              # { schema: 1, pluginVersion, createdAt }
├── mirror/
│   └── bots/<botId>/
│       ├── bot.json         # copy of the machine definition (read-only here)
│       ├── queue.json       # last known queue snapshot
│       └── approvals.jsonl  # decision history (ids, timestamps, no payloads)
├── cache/
│   ├── dependency.json      # detected version and path, TTL 1 h
│   ├── cost.json            # balance and hours, TTL 15 s
│   └── setup.json           # onboarding status, TTL 5 s
├── outbox/cursor.json       # last seq consumed by the client
├── locks/<botId>.lock       # { pid, host, acquiredAt, beatAt }
├── tmp/                     # staging for atomic writes; purged on boot
└── logs/
    ├── host.log             # JSONL, rotated at 5 MB, keep 3
    └── audit.log            # approval requests/decisions, append-only
```

| Path | Written by | Read by | Secrets | Retention | Rebuildable |
| --- | --- | --- | --- | --- | --- |
| `schema.json` | host | host | no | forever | no (recreated) |
| `mirror/bots/<id>/` | host | client, host | no | last state | yes, from machine |
| `cache/*.json` | host | client, host | no | TTL above | yes |
| `outbox/cursor.json` | host | client | no | forever | yes |
| `locks/*.lock` | host | host | no | stale after 2× poll interval | yes |
| `logs/host.log` | host | user on request | no | rotating | no |
| `logs/audit.log` | host | user on request | no | forever | no (important) |

Rules:

- **No config file in v0.1.** Non-secret settings live in the bundle row in the
  profile's `cordis.patch.yml`; this directory holds only derived data and cache.
- **The mirror is disposable.** `rm -rf` it and reopen the panel: bots are
  re-listed from the machine. Audit history is the only thing that does not come
  back, which the runbook says explicitly.
- **Lock files are hints, not authority.** A lock older than two poll intervals
  is stale and may be reclaimed; the machine-side queue remains the source of
  truth.
- **Logs never contain tokens, keys, prompts or workspace contents.** They carry
  ids, byte counts, error codes and timings; approval payloads stay on the
  machine and expire.
- Stale `tmp/` entries are purged on boot; nothing reads them.

## 3. What lives on the machine (mirror reference)

The authoritative runtime files are in [mvp-plan.md](mvp-plan.md) §4.2:
`/workspace/.rayrun/bots/<id>/` holds `bot.json`, `memory/`, `sessions/`,
`queue.jsonl`, `approvals/` and `log/bot.jsonl`; `/workspace/.rayrun/host/` holds
the supervisor state, and `outbox/events.jsonl` feeds the local UI.

Direction rules: machine wins for runtime state (sessions, queue, approvals
pending), local wins for user intent (a create/edit/delete request, an approval
decision), and the repo/checkout wins for code. A local mirror file is never
written back to the machine wholesale; only explicit actions are sent.

## 4. Formats and atomicity

The schemas are fixed in [mvp-plan.md](mvp-plan.md) §4.3 (`bot.json`, queue item,
approval request/decision, outbox event). This design adds four local formats:

- **`schema.json`** — `{ schema: 1, pluginVersion, createdAt }`; the host refuses
  to open state from a newer schema and migrates older ones.
- **`locks/<botId>.lock`** — `{ pid, host, acquiredAt, beatAt }`, rewritten while
  the owner lives, deleted on clean exit.
- **`approvals.jsonl`** — `{ at, requestId, botId, nonce, actionHash, decision,
  decidedAt }`; no action payload, no secrets; append-only.
- **`host.log` / `audit.log` lines** — `{ at, level, code?, botId?, event, n? }`;
  stable fields so the runbook can grep them.

Write rule for every JSON/JSONL file: write `name.tmp-<random>` in the same
directory, `fsync`, `rename` over the target; readers fall back to
`name.bak` if the target is missing. JSONL appends are single `appendFile`
calls under a per-bot lock.

## 5. Permissions

- POSIX: directories `0700`, files `0600`; no world- or group-readable state.
- Windows: files inherit the user's profile ACL; the design does not add
  everyone-readable paths.
- The mirror may contain user instructions and bot conversation metadata; treat
  it as private user data even though it holds no credentials.
- The Harness vault (`.credentials.yaml`) and Rayrun credential slots are
  **never read directly**; the host asks the Harness API for a value only when a
  call needs it, and never caches it on disk.

## 6. Lifecycle

| Event | What happens |
| --- | --- |
| First boot | create state dir, write `schema.json`, purge `tmp/`, detect the dependency, start the poller |
| Upgrade | back up state dir to `state/rayrun-bot.bak-<version>/`, run migrations, bump `schema` |
| Dependency missing | keep state, write `cache/dependency.json` with the error, show setup with `E_DEP_MISSING` |
| Machine lost or destroyed | mirror stays; bot definition is recoverable if it was never pulled — the runbook says to pull before destroy |
| Uninstall | delete `$DSH_HOME/state/rayrun-bot/` and the package; the Rayrun token is revoked by the user in the vault, not by us |
| Cache growth | TTLs above; `logs/` rotation; `tmp/` purge; mirror pruned when a bot is deleted |

## 7. Mapping to work items

| Work item | Files it creates |
| --- | --- |
| A1 package scaffold | `package.json`, `cordis.patch.yml`, `index.js`, `client.js`, `locale/*`, `test/locale-audit.mjs` |
| A2 dependency check | `lib/dependency.js`, `cache/dependency.json` |
| A3 RPC | `lib/rpc.js`, `lib/errors.js` |
| B1–B3 bot model and mirror | `lib/bot-schema.js`, `lib/bots.js`, `lib/local-store.js`, `mirror/` |
| B5 recovery pull | `mirror/bots/<id>/` refresh path |
| C5/C7 queue and status | `cache/setup.json`, `outbox/cursor.json`, `mirror/bots/<id>/queue.json` |
| E3/E7 approvals | `lib/approvals.js`, `approvals.jsonl`, `logs/audit.log` |
| G5 runbook | `docs/` recovery page, referencing the retention table above |

## 8. Open questions

1. **State directory convention.** Does DSH document a per-plugin state directory
   to use instead of `$DSH_HOME/state/<plugin>`? If yes, adopt it and keep the
   same tree underneath.
2. **Client module loading.** Can a DSH client module import relative files
   (decides single `client.js` versus a `client/` directory) — spike C-S1.
3. **Vault read path.** The exact Harness API the host half uses to obtain the
   Rayrun token value at call time — A2 spike.
4. **Bundle dependency.** If S6 works, `dsh-rayrun-computer` moves from
   "documented two-install" to `dependencies` in `package.json`; the file layout
   does not change.
5. **Transcript mirror size.** P1: whether to mirror truncated transcripts
   locally, with what size cap; default is metadata only in v0.1.
