# Quickstart

*Status: 2026-11-13. Two separate projects. This repository is pre-alpha: it
holds docs, repository scaffolding and the `dsh-rayrun-bots` A1 skeleton, no
publishable code yet. The cloud-computer plugin at
[RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)
is untouched and stays its own project; this repository builds the bot layer and
reuses that plugin as an external dependency — two plugins in one DSH profile.*

This page has two tracks. **What you can run today** installs the separate
cloud-computer package, which is the required dependency. **The target path**
covers the bot product this repository is building — none of its steps exist
yet.

## Prerequisites

| You need | Why | Status |
| --- | --- | --- |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | the agent runtime this plugs into — desktop app or `dsh web` | the computer package was verified on `0.2.1-rc.5`; the design baseline is `0.2.2-rc.1` and re-verification is in progress |
| [dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer) | the cloud-computer layer — a separate project, required by Rayrun Bot | not on npm yet — install from a checkout (below) |
| A [Rayrun](https://rayrunos.com/) account | supplies your cloud computer; Rayrun bills it by the second | required — you pay Rayrun directly for compute |
| A DeepSeek API key | the model calls made by the agent on the machine | required — the key and the model bill are yours |
| Node / build tools | not needed: plain ESM, no build step | none |

Nothing is hosted by this project: no account, no relay, no control plane.

## What you can run today

Rayrun Bot does not vendor the cloud-computer layer: it is a separate project
and a required dependency. Today two plugins must be installed in the same DSH
profile; one install is planned once bundle-dependency support is verified. Start
with the dependency — it is not on npm yet, so install it from a checkout:

```bash
git clone https://github.com/RayrunOS/dsh-rayrun-computer.git
cd dsh-rayrun-computer
dsh plugin --profile web add "$(pwd)"
# restart DSH: the client half only loads when the page starts
```

On Windows, run the same commands in PowerShell with `"$PWD"` as the path.

Then, in the DSH page:

1. Open **Cloud Computer → Connection settings** and sign in with your Rayrun
   account, or paste an API token. A token is created for you and stored in the
   Harness vault.
2. **New computer** → choose an image, give it at least 2 GB of memory, turn on
   the remote desktop → **Create and open**. It takes about 15 seconds.
3. Ask the agent to list your machines — it should return the one you just
   created. The negative check is worth doing once: before you sign in, the same
   request must answer `token_required`, never pretend the work happened.

What that package does today:

| Works | Notes |
| --- | --- |
| Seven `rayrun_*` tools | sandbox lifecycle, exec, desktop computer use, files, agent delegation, worker layer, workspace sync |
| noVNC desktop in the page | machines created with a remote desktop publish their desktop port |
| Per-session cloud/local routing | in "cloud" mode the host refuses local write/execute tools |
| Verified workspace sync | git bundle + dirty patch, SHA-256 checked on both sides; pulls land in `.dsh/incoming/` and are never applied |
| Task delegation | an objective + acceptance criteria, multi-round, `start`/`result` can outlive one turn |
| Optional idle stop | `idle_stop_minutes`; stops the machine, never destroys it |
| Login and vault | password/WeChat/API token; the token stays host-side |

Everything above comes from the separate `dsh-rayrun-computer` project, not from
this repository. It is verified on DeepSeek Harness `0.2.1-rc.5`.

## The target 3-minute path (v0.1, not built yet)

When the bot half lands, the first-run path should be:

1. Install `dsh-rayrun-bots` (npm is not published yet; a checkout will work).
   The bundle is intended to declare `dsh-rayrun-computer` as a dependency so
   one install brings both plugins — that path is the W0 spike S6 and is
   **TBD**. Until then, install the separate plugin first (see above).
2. Sign in to Rayrun once; the first-run wizard creates your cloud computer.
3. Create a bot: a name, instructions, and the skills it can load. It gets its
   own session on your computer.
4. Talk to it, or let a routine wake it up while you are away.
5. Approve its first gated action from the panel.

None of steps 1–5 exist yet in this repository. See
[roadmap.md](roadmap.md) for what each milestone needs.

## What works today vs what is still missing

| | |
| --- | --- |
| **Works today** (separate project) | the seven tools, noVNC desktop, per-session cloud/local routing, hash-verified workspace sync, task delegation, worker projection, optional idle stop; verified on DSH `0.2.1-rc.5` |
| **This repository** | README, docs, issue/PR templates, agent rules, and the `dsh-rayrun-bots` A1 skeleton with plain-Node checks and a checks-only CI workflow. No publishable code. |
| **Planned, unverified** | two-plugin install: the Rayrun Bot bundle declares `dsh-rayrun-computer` as a dependency so one install loads both host and client halves (W0 spike S6) |
| **Not built yet** | bot roster and bot↔session mapping, a persistent DSH host on the machine, remote approvals, routines and triggers, cost bar, IM channel, npm packages and the release/publish CI path |
| **Blocked on the Rayrun platform** | safe inbound networking (the token ingress is unusable today and only `public` works), idle auto-stop, a spend cap, the session-resume contract |

## Troubleshooting

- **`token_required`.** No Rayrun token is configured. Open
  **Cloud Computer → Connection settings**; the page never fakes a successful
  call.
- **The machine has no outbound network, and its allowlist is fixed at
  creation.** Set `egress_allow` when you create the machine. Runtime changes
  are not verified: the documented runtime endpoint was not usable in the
  2026-11-01 test.
- **`destroy` is irreversible.** The machine and its workspace are deleted
  together. Use stop/pause to keep the disk; a stopped machine still occupies
  storage, which is free up to the image's included allowance and billed above
  it.
- **Background work costs money and is not self-healing.** Rayrun bills by the
  second, has no platform-side idle auto-stop, and `max_lifetime_seconds`
  stops a machine without restarting it. If your Rayrun balance is exhausted,
  the platform can force-destroy your organization's machines including their
  disks. Watch your balance, and set `idle_stop_minutes` if you want the plugin
  to stop idle machines (stop only, never destroy).
- **A second task gets `409 sandbox_busy`.** One cloud computer runs one agent
  task at a time; it does not queue. Wait, or use another machine.
- **`dsh-rayrun-computer` is not installed.** Two plugins are needed today: the
  bot layer and its separate dependency. Install the cloud-computer plugin from
  its checkout into the same DSH profile and restart DSH; without it, the cloud
  tools the bot layer relies on are missing.
- **`npm i dsh-rayrun-bots` fails.** Expected: neither package is published on
  npm yet.

## Read next

- [Architecture](architecture.md) — the layered picture and its tradeoffs.
- [Security](security.md) — what is protected, and what is not.
- [FAQ](faq.md) — short answers, including "why is this repo mostly docs?".
- [Roadmap](roadmap.md) — v0.1 / v0.2 / v1.0 exit criteria.
- [README](../README.md) — the product page.
