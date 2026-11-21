# dsh-rayrun-bots

The Rayrun Bot plugin package. Status: **client shell with a local roster** —
the bundle loads, the client half renders the v0.1 screens, and the host half
answers health and persists the bot roster. Conversations, approvals, routines
and settings are still an in-memory preview; there is no cloud runtime yet. The
page-level create/reload path was verified on 2026-11-21 in a local DSH page.

## What it does today

- Host half: `GET /plugins/rayrun-bots?action=health` returns
  `{ ok: true, plugin: "rayrun-bots", version, ready: false, dependency }`.
  `dependency` reports `dsh-rayrun-computer` as `ok`, `missing` (`E_DEP_MISSING`),
  `incompatible` (`E_DEP_VERSION`), or `unknown` when no profile context exists.
  `POST` is same-origin gated: a browser `Origin` that does not match the request
  `Host` is refused with 403. No credentials are touched.
- Host half: `bots.list`, `bots.get`, `bots.create`, `bots.update` and
  `bots.delete` persist validated `bot.json` files under
  `$DSH_HOME/state/rayrun-bot/bots/<id>/` (atomic writes, private modes, stable
  `E_BOT_*` errors). The roster is the user's intent store until the cloud
  runtime lands; the machine will become the runtime truth. Ids are derived
  from the name when the client does not send one, and collisions get a numeric
  suffix.
- Client half: a `Bots` sidebar entry and the three-column shell from
  [docs/design/ui-design.md](../../docs/design/ui-design.md) — chat list, conversation,
  details (Activity / Library), new bot, the four-step setup wizard, and
  settings. When the host roster has entries, the chat list shows those bots
  instead of the sample list; creating a bot in the new-bot screen or the setup
  wizard writes through to the host and selects the saved bot. Messages,
  receipts, the approval card and settings still live in the page only. Deny /
  Allow once, the wizard, and settings update that in-memory state. The client
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

Not built yet: a Bots-page-level verified computer-creation success path,
bot↔session mapping, remote approvals, routines that run, and the npm release
path. See the
repo-level [MVP plan](../../docs/plans/mvp-plan.md) and [client plan](../../docs/plans/client-plan.md).

## DSH compatibility

`package.json` declares `engines.dsh: >=0.2.0-rc.2 <0.3.0`. DSH `0.2.2-rc.5`'s
compatibility check reads that range: an out-of-range install is refused and the
profile is restored, and an incompatible row is disabled at composition. Older
runtimes that ignore `engines.dsh` still load the bundle. The range covers the verified runtimes: `0.2.0-rc.2` (the Rayrun
cloud image), `0.2.2-rc.5`, and `0.2.1-rc.5` from the CI matrix. It is not a claim
that every feature works on every version; the host half is still health-only.

## Install from a checkout

Install this directory into the current DSH profile: **Plugins → Add plugin** and
point it at `packages/dsh-rayrun-bots`, or use the `plugin_manager`
`install_bundle` action with the package's absolute path. Refresh the DSH page;
the client half loads when the page starts.

The cloud-computer dependency (`dsh-rayrun-computer`) is **not declared as a
package dependency yet**: whether one bundle can declare it so one install brings
both is spike S6. Until then a user installs both plugins separately; the host
detects the installed version at runtime and reports it through health.

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
index.js           # host half: same-origin RPC route, health + bots.* actions
client.js          # client half: v0.1 shell, roster read/write, preview conversation
lib/bots.js        # persistent roster: list/get/create/update/delete
lib/bot-schema.js  # bot.json validation, defaults and creation
lib/dependency.js  # dsh-rayrun-computer detection and version check
lib/errors.js      # stable error codes (shared with docs/plans/mvp-plan.md §4.3)
lib/local-store.js # state-directory resolution and atomic JSON writes
lib/rpc.js         # JSON responses and request-body parsing
locale/en.json     # source copy
locale/zh.json     # mirror; keys must match
icon.svg           # plugin icon (Rayrun blue, monitor mark)
test/              # plain-Node checks, no framework
```

MIT © RayrunOS.
