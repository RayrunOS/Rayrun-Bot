# dsh-rayrun-bots

The Rayrun Bot plugin package. Status: **client shell** — the bundle loads, the
client half renders the v0.1 screens, and the host half answers one health
action. The screens are an in-memory preview. There is no bot layer yet.

## What it does today

- Host half: `GET /plugins/rayrun-bots?action=health` returns
  `{ ok: true, plugin: "rayrun-bots", version, ready: false, dependency }`.
  `dependency` reports `dsh-rayrun-computer` as `ok`, `missing` (`E_DEP_MISSING`),
  `incompatible` (`E_DEP_VERSION`), or `unknown` when no profile context exists.
  `POST` is same-origin gated: a browser `Origin` that does not match the request
  `Host` is refused with 403. No credentials are touched.
- Client half: a `Bots` sidebar entry and the three-column shell from
  [docs/design/ui-design.md](../../docs/design/ui-design.md) — chat list, conversation,
  details (Activity / Library), new bot, the four-step setup wizard, and
  settings. Sample bots, messages, receipts, and the approval card live in the
  page only. Deny / Allow once, creating a bot, the wizard, and settings update
  that in-memory state. The client activates Bots on load and covers the DSH
  sidebar and bottom bar; there is no in-product return to the Harness shell
  (ADR-017). The setup Rayrun step calls the cloud-computer plugin's
  same-origin RPC with a pasted token and shows the real balance/machine count.
  `Open` / `Take over` on the computer card uses the same RPC to start or resume
  the machine, wait for `Running`, repair the desktop service, read `desktop_url` and the desktop password,
  then open the desktop in a new tab and show the password in a dismissible
  toast; both buttons currently run the same path. It fails closed with one
  actionable line when Rayrun is not connected, there is no machine, the popup
  is blocked, the machine does not start in time, or it has no desktop. The
  success path against a real machine has not been run in the Rayrun sandbox.
  The rest stays in the page, and the client keeps neither the token nor a
  DeepSeek key.

Not built yet: the DeepSeek-key and computer-creation setup steps, a verified
`Open` success path, a real bot roster, bot↔session mapping, remote approvals,
routines that run, and the npm release path. See the
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
index.js           # host half: same-origin RPC route, health action only
client.js          # client half: v0.1 shell (in-memory preview)
lib/bot-schema.js  # bot.json validation, defaults and creation
lib/dependency.js  # dsh-rayrun-computer detection and version check
lib/errors.js      # stable error codes (shared with docs/plans/mvp-plan.md §4.3)
lib/rpc.js         # JSON responses and request-body parsing
locale/en.json     # source copy
locale/zh.json     # mirror; keys must match
icon.svg           # plugin icon (Rayrun blue, monitor mark)
test/              # plain-Node checks, no framework
```

MIT © RayrunOS.
