# dsh-rayrun-bots

The Rayrun Bot plugin package. Status: **client shell** — the bundle loads, the
client half renders the v0.1 screens, and the host half answers one health
action. The screens are an in-memory preview. There is no bot layer yet.

## What it does today

- Host half: `GET /plugins/rayrun-bots?action=health` returns
  `{ ok: true, plugin: "rayrun-bots", version, ready: false }`. `POST` is
  same-origin gated: a browser `Origin` that does not match the request `Host`
  is refused with 403. No credentials are touched.
- Client half: a `Bots` sidebar entry and the three-column shell from
  [docs/ui-design.md](../../docs/ui-design.md) — chat list, conversation,
  details (Activity / Library), new bot, the four-step setup wizard, and
  settings. Sample bots, messages, receipts, and the approval card live in the
  page only. Deny / Allow once, creating a bot, the wizard, and settings update
  that in-memory state. The page does not call the host, and it does not keep a
  Rayrun token or a DeepSeek key.

Not built yet: a real bot roster, bot↔session mapping, remote approvals, routines
that run, the adapter to `dsh-rayrun-computer`, and the npm release path. See the
repo-level [MVP plan](../../docs/mvp-plan.md) and [client plan](../../docs/client-plan.md).

## Install from a checkout

```bash
# from the repository root
dsh plugin --profile web add "<absolute path to packages/dsh-rayrun-bots>"
# restart DSH; the client half loads when the page starts
```

The cloud-computer dependency (`dsh-rayrun-computer`) is **not declared yet**:
whether one bundle can declare it so one install brings both is spike S6. Until
then a user installs both plugins separately.

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
pull requests: [`.github/workflows/checks.yml`](../../.github/workflows/checks.yml).
Live integration tests need real Rayrun credentials and never run in CI.

## Layout

```
package.json       # name, exports, dsh.bundle + dsh.client
cordis.patch.yml   # the bundle row (id rayrun-bots -> package dsh-rayrun-bots)
index.js           # host half: same-origin RPC route, health action only
client.js          # client half: v0.1 shell (in-memory preview)
lib/errors.js      # stable error codes (shared with docs/mvp-plan.md §4.3)
lib/rpc.js         # JSON responses and request-body parsing
locale/en.json     # source copy
locale/zh.json     # mirror; keys must match
test/              # plain-Node checks, no framework
```

MIT © RayrunOS.
