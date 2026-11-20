# Update prototype

A small, dependency-free prototype of the update kernel used by the v1.0
desktop distribution design. It verifies a signed manifest, checks the version
matrix, copies an artifact into a staging directory, switches a version pointer,
and keeps one rollback target.

**This is a prototype, not a production updater.** It is not loaded by the DSH
plugin and is not in the npm package. It does not download over HTTP, extract an
installer archive, manage signing keys, or run `electron-updater`; those belong
to the distribution layer (A/B/C in
[`docs/design/desktop-distribution.md`](../../docs/design/desktop-distribution.md)).

## Run

```bash
node tools/update-poc/test/update.mjs
```

The same command runs in the checks CI workflow. No dependencies, no network,
no real keys: the tests generate an Ed25519 key pair in a temporary directory.

## Layout

```
tools/update-poc/
├── manifest.mjs      # canonical JSON, Ed25519 sign/verify, semver, validation
├── apply.mjs         # staging, atomic switch, state.json, rollback
├── test/update.mjs   # plain-Node checks
└── README.md
```

## Manifest

The signature covers the canonical JSON of the manifest **without** the
`signature` field:

```json
{
  "schema": 1,
  "app": "rayrun-bot",
  "version": "1.4.0",
  "minVersion": "1.0.0",
  "dsh": "0.2.2-rc.1",
  "plugins": {
    "dsh-rayrun-bots": "0.1.0",
    "dsh-rayrun-computer": "0.2.1"
  },
  "files": [
    { "path": "app/main.js", "sha256": "64-hex" }
  ],
  "signature": "base64-ed25519-signature"
}
```

Validation enforces:

- `schema` is `1`; `app`, `version`, `minVersion` are present and semver-valid;
- the target version is newer than the installed version, and the installed
  version is at least `minVersion`;
- file paths are relative, unique, and cannot traverse (`..`, absolute paths,
  drive prefixes, backslashes or NUL);
- every file has a 64-hex SHA-256;
- the Ed25519 signature verifies against the pinned public key.

## Apply layout

```
targetRoot/
├── versions/
│   ├── 1.4.0/            # current
│   └── 1.3.0/            # previous, kept for rollback
└── state.json            # { schema, app, current, previous, updatedAt }
```

`stageUpdate` copies only manifest-listed files into a temporary staging
directory, re-hashes each copied file, and then renames the staging directory
into `versions/<version>`. `state.json` is written with a temporary file and a
rename. Any failure before the state switch removes staging; a failure after
the directory rename removes the new version and leaves the old state.

`rollback` switches `current` back to `previous`, writes the state first, then
removes the failed version directory.

## What this does not cover

- HTTP download, manifest freshness, mirrors, retries and rate limits;
- archive extraction (tar/zip), differential updates and installer formats;
- code signing/notarization of the application or installer;
- key generation, rotation, revocation, or a production key-management policy;
- full RFC 8785/JCS canonicalization (the prototype uses sorted-key
  `JSON.stringify`; use a vetted JCS implementation before production);
- semver build metadata (`+build`) or numeric prerelease leading-zero rules;
- file permissions, xattrs, hard links, empty directories and platform ACLs;
- cross-process locking and concurrent updater instances;
- Windows atomic-replace guarantees for `rename` over an existing file;
- rollback of data migrations or user-profile changes;
- telemetry, update prompts, or a UI.

## Why it is a separate prototype

The update unit is a distribution decision (official DSH desktop, a custom DSH
desktop distribution, or a thin shell). This kernel is shared by all three, so
it can be tested before that decision is made. The next step is to attach it to
the chosen distribution's download, packaging and UI layer; do not ship this
directory as part of the DSH plugin.
