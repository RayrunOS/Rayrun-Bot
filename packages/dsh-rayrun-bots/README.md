# dsh-rayrun-bots

The Rayrun Bot plugin package. Status: **A1 skeleton** — the bundle loads, the
client half adds a "Bots" entry with a placeholder page, and the host half answers
one health action. There is no bot layer yet.

## What it does today

- Host half: `GET /plugins/rayrun-bots?action=health` returns
  `{ ok: true, plugin: "rayrun-bots", version, ready: false }`. No credentials are
  touched.
- Client half: a `Bots` sidebar entry and a placeholder page. It does not call
  the host yet.

Not built yet: bot roster, chat list, conversation, details panel, approvals,
routines, the adapter to `dsh-rayrun-computer`, and the npm release path. See the
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
```

## Layout

```
package.json       # name, exports, dsh.bundle + dsh.client
cordis.patch.yml   # the bundle row (id rayrun-bots -> package dsh-rayrun-bots)
index.js           # host half: same-origin RPC route, health action only
client.js          # client half: sidebar "Bots" + placeholder page
lib/errors.js      # stable error codes (shared with docs/mvp-plan.md §4.3)
lib/rpc.js         # JSON responses and request-body parsing
locale/en.json     # source copy
locale/zh.json     # mirror; keys must match
test/              # plain-Node checks, no framework
```

MIT © RayrunOS.
