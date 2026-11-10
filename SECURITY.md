# Security Policy

Rayrun Bot is pre-alpha. No release is published yet, so no released
version is currently supported with security fixes. The first release is
planned as `v0.1.x`; the table below will be updated when it ships.

| Version | Supported |
| ------- | --------- |
| `v0.1.x` | planned, not released yet |
| `main` | best effort, no guarantees |

## Reporting a vulnerability

Please report vulnerabilities privately through **GitHub Security Advisories**
on the repository's [Security tab](https://github.com/RayrunOS/Rayrun-Bot/security).
Do not open a public issue for a vulnerability, and never include live tokens,
API keys, or credentials in a report.

This is a volunteer-maintained pre-alpha project. We will acknowledge reports as
soon as we can, but we do not promise a response time, a fix SLA, or an audit.

## What is in scope

- **Rayrun credential handling** — how the bot obtains and uses Rayrun cloud
  computer credentials, and whether they can leak to another bot, a log, or a
  third party.
- **DeepSeek API key handling** — the user's DeepSeek key stays with the user;
  anything that exposes it outside the user's own Harness or cloud computer.
- **Plugin RPC** — the DSH web plugin talks to the local Harness over
  same-origin RPC; bypasses, CSRF, or cross-origin exposure matter.
- **Approval flow** — actions that a user must approve should not be
  executable without that approval.
- **Cloud computer isolation** — the Rayrun cloud image currently runs as root
  without `bubblewrap`, so the worker profile runs with `danger-full-access`.
  This is a deliberate workaround for that environment, **not** a sandbox
  guarantee: treat a compromised bot as having full access to its own cloud
  computer.

## Handling practices

- This repository ships no telemetry. Once the computer package moves in, its
  only outbound request is a version check against the npm registry; anything
  beyond that must be opt-in and documented before it ships.
- The Rayrun token lives in the Harness vault, host side, and must never reach
  a client module, an RPC response, or a log.
- The DeepSeek key is injected into the bot's agent process as a Rayrun
  credential; it must never be written into the workspace, the repository,
  fixtures, prompts, or chat.
- Log redaction is still being verified — see the status note in
  [README.md](README.md).

Out of scope: bugs in DeepSeek Harness itself, in Rayrun's platform or cloud
images, or in third-party dependencies. Report those to the relevant upstream
project.
