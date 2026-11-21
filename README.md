# Rayrun Bot

English | [简体中文](README.zh-CN.md)

Rayrun Bot gives the bots in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) a name, a body and a home. A bot is not a chat session: it has a name, instructions, memory and a schedule, and it lives on your own [Rayrun](https://rayrunos.com/) cloud computer — a Linux machine you can watch and take over — while thinking with your own DeepSeek API key. Nothing is hosted by us: the compute is on your Rayrun account, the model bill is yours, and the approval prompt is the contract. This repository is where that product is built.

> **Status (November 2026).** Pre-alpha. The cloud-computer plugin this project builds on is a separate project at [RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer); Rayrun Bot adds the bot layer on top of it, and that layer is what this repository is building. `packages/dsh-rayrun-bots` loads as a bundle. Its client half opens directly into the Bots surface, renders the v0.1 shell (chat list, conversation, details, new bot, setup, settings) in Chinese and English (Chinese primary; the UI follows the DSH language), with a persisted local bot roster while the conversation, approvals and settings remain an in-memory preview, and calls the host's same-origin health action; the setup Rayrun step also calls the cloud-computer plugin's same-origin RPC with a pasted token, the setup computer step adopts or creates the first cloud computer through the same RPC, and the computer card's Open / Take over does the same to start or resume the machine and open its desktop, while Stop stops it after confirmation and never destroys it; the details panel's computer and usage blocks, plus the Settings usage row, read real machine status, balance and machine-hours. The dependency-level connect, create and desktop success paths, plus the page-level setup and Open paths, were verified on 2026-11-21 with local test keys; the page-level computer-creation button still needs a pass with no existing machine. The host half also persists the bot roster (`bots.list/get/create/update/delete` under `$DSH_HOME/state/rayrun-bot/`), validated and written atomically; the chat list reads it when it has entries, and creating a bot writes through to it. Host and client roster wiring are covered by plain-Node contract tests, and the page-level create/reload path was verified on 2026-11-21 in a local DSH page. Remote approvals are on hold until Rayrun provides host/agent permission isolation and a host-only approval endpoint (ADR-001, decided 2026-11-21); there is no release yet.

## How it works

This is the design v0.1 is being built against; what actually exists today is listed under [Status](#status).

A bot has four parts, and only one of them needs to be online.

- **The desk — DeepSeek Harness, on your machine.** You talk to bots, approve actions and change settings here. Two bundles run in the same DSH profile: the separate cloud-computer plugin supplies the `rayrun_*` tools and the same-origin RPC surface, and Rayrun Bot's host half adds the bot layer on top; the client halves add pages to the DSH web UI. Once the bot layer ships, closing your laptop will not stop the bots: the desk is where you come back to, not where they live.
- **The body — your Rayrun cloud computer.** One Linux machine per person, shared by that person's bots: its own vCPU and memory, a persistent `/workspace`, an X11 desktop on `:99`, and the ability to run commands, move files and drive a browser. A 2 vCPU / 2 GiB machine kept always-on cost about ¥57.6/month at the time of writing; Rayrun bills by the second, and you pay Rayrun, not us.
- **The brain — your DeepSeek key.** The agent process inside the machine calls DeepSeek with the API key you stored as a Rayrun credential. The key is injected into that process, not into the workspace: `exec` shells cannot read it, and it doesn't live in this repository or appear in chat messages. Log hygiene is still being verified — see [docs/07-security.md](docs/07-security.md).
- **Memory — DSH state on the machine.** A bot is a persistent DSH object: its instructions, skills, scratchpad and session live in a profile directory and survive restarts. The bot↔session mapping — resume where it stopped, then come back and report — is the core of what this repo adds.

```
you ── chat / approve ──▶ DSH (your desk)                browser tab or desktop app
                           │  plugin host half: tools · same-origin RPC · approvals
                           ▼
                      Rayrun API · https://api.rayrunos.com/v1
                           ▼
       your Rayrun cloud computer   (one per person, shared by your bots)
         ├─ DSH host on the machine: one session per bot
         ├─ /workspace · browser profile · X11 desktop
         └─ model calls ──▶ DeepSeek API (your key, injected per process)
```

A few design choices that follow from that picture:

- **One computer per person, not per bot.** It's cheaper and simpler, and bots share files, browser sessions and credentials the way a person's tools do. The tradeoff: a bot is not a security boundary — do not use two bots as sandboxes against each other.
- **Bring your own accounts.** No control plane of ours holds your keys or meters your usage. Rayrun is your infrastructure vendor, DeepSeek is your model vendor, and this repo is the glue.
- **Local-first where it protects you.** The workspace sync pushes a git bundle plus a dirty patch and re-checks the SHA-256 on both sides; a pull lands in `.dsh/incoming/` and is never applied behind your back.
- **Approvals are fail-closed.** Unknown, expired or unanswered means no. This is a rule we are still implementing — see [Approvals](#approvals).
- **Boring on purpose.** Plain ESM, no runtime dependencies, no build step; the DSH that runs on your desk is the same DSH that runs in the cloud.

## Quick start

**Requirements**

- DeepSeek Harness — the desktop app or `dsh web`. The cloud-computer plugin was verified on `0.2.1-rc.5`; re-verification against `0.2.2-rc.1` is in progress.
- The separate cloud-computer plugin (`dsh-rayrun-computer`, MIT) — required at runtime; install it from a checkout until it is on npm.
- A Rayrun account from [rayrunos.com](https://rayrunos.com/).
- A DeepSeek API key.

### What you can run today

The cloud-computer plugin this project depends on is a separate, working package. Install it first; the bot layer is not installable yet.

```bash
git clone https://github.com/RayrunOS/dsh-rayrun-computer.git
cd dsh-rayrun-computer
dsh plugin --profile web add "$(pwd)"
# restart DSH — the client half only loads when the page starts
```

On Windows, run the same commands in PowerShell with `"$PWD"` as the path.

1. Open **Cloud Computer → Connection settings** and sign in with your Rayrun account, or paste an API token. A token is created for you and stored in the Harness vault.
2. **New computer** → choose an image, give it at least 2 GB of memory, turn on the remote desktop → **Create and open**. It takes about 15 seconds.
3. Ask the agent to list your machines — it should return the one you just created. The negative check is worth doing once: before you sign in, the same request must answer `token_required`, never pretend the work happened.

The v0.1 path this repo is building toward is tracked in [Status](#status) and [docs/plans/roadmap.md](docs/plans/roadmap.md). Rayrun Bot is meant to declare this plugin as a dependency, so one install should bring both; that path is still a spike (S6), not a promise.

## The bots

No bot ships yet; the first ones will be plain DSH profile directories, not code. A bot owns:

| Part | What it is |
| --- | --- |
| Name and instructions | A short markdown brief: what this bot is for, how it should report, what it must never do. |
| Skills | DSH skills the bot can load, in the same format as the rest of DSH. |
| Memory | A per-bot directory on the machine for notes, artifacts and the session log. |
| Computer | The Rayrun computer it runs on — one per person, shared by that person's bots. |
| Session | A persistent DSH session id, so a bot resumes rather than restarts. |
| Routines | Scheduled or event-triggered work (planned; see [Status](#status)). |

The definition format is not final. Treat everything above as the design direction, not a schema.

## Configuration

The computer package reads its settings from the bundle row in your DSH profile's `cordis.patch.yml`. The keys that exist today:

| Key | Default | Meaning |
| --- | --- | --- |
| `sandboxName` | `dsh-workspace` | Reuse a cloud computer by name instead of creating one. |
| `idle_stop_minutes` | `0` | Stop (never destroy) an idle computer after N minutes; `0` disables it. |
| `egress_allow` | `[]` | Hosts a new machine may reach. Empty means no outbound network. |
| `credentials` | `[]` | Model credentials to inject into the agent process. |
| `baseUrl` | `https://api.rayrunos.com/v1` | Rayrun API endpoint. |

Bot-level settings do not exist yet; when they do, they will live in the same profile file. Never put a Rayrun token or a model key in a config file that is committed.

## Approvals

The contract we are building to: a bot may work freely inside its own computer, but anything with an outside effect waits for you.

- **Needs a yes:** spending beyond a budget, sending a message or publishing as you, destroying a computer, touching another machine or credential.
- **Does not need a yes:** reading and writing its workspace, running commands inside its computer, calling the model.
- **Default is deny.** A timeout, an unknown answer or a closed panel means no. Approvals never answer themselves.
- **Revoking is immediate:** stop the bot, stop the computer, or revoke the API token in the Rayrun console.

**This is not implemented yet on the cloud path.** Today the machine's worker profile runs with `approval: never`, because a headless cloud computer has nobody to ask. A file mailbox inside the agent's writable workspace could be self-approved by a compromised bot, so ADR-001 (2026-11-21) decided to wait for Rayrun to provide host/agent permission isolation and a host-only approval endpoint. Until that lands, approval execution is not implemented and a cloud bot is unsupervised: only run one with credentials you are prepared to lose.

## Repository layout

```
Rayrun Bot/
├── README.md, README.zh-CN.md   # this file and its Chinese mirror
├── CLAUDE.md                    # rules for coding agents working in this repo
├── LICENSE                      # MIT
├── SECURITY.md                  # how to report a vulnerability, privately
├── CONTRIBUTING.md              # pull-request rules (CODE_OF_CONDUCT.md alongside)
├── .github/                     # issue/PR templates, checks CI, and the deploy script
├── package.json                 # private workspace root
├── docs/                        # 00–09 docs, adr/, plans/, design/, research/, mockups/
├── tools/update-poc/            # update kernel prototype; not shipped in the plugin
├── tools/rayrun-deploy/         # CI deploy helper and contract test; not shipped
└── packages/
    └── dsh-rayrun-bots/         # health route + v0.1 client shell, locale, tests
```

The cloud-computer plugin (`dsh-rayrun-computer`) is not in this tree: it is a **separate project**, consumed as a dependency. Two plugins in the same DSH profile, one product. The repository and product are called **Rayrun Bot**; the packages keep the `dsh-` prefix that the DSH ecosystem uses. The README is the product page; `docs/` holds the detail. Deeper reads: [documentation index](docs/README.md), [product direction](docs/00-product-direction.md), [system architecture](docs/01-system-architecture.md), [bot model](docs/02-bot-model.md), [client design](docs/03-client-design.md), [cloud bot runtime](docs/04-cloud-host.md), [approvals](docs/05-approvals.md), [local state](docs/06-local-state.md), [security](docs/07-security.md), [integration](docs/08-integration.md), [deployment](docs/09-deployment.md), [plans](docs/plans/mvp-plan.md), [ADRs](docs/adr/architecture-decisions.md), [FAQ](docs/faq.md). Both READMEs are updated in the same commit — English is the source of truth.

## Development

No build step, no runtime dependencies: the plugin halves are plain ESM, and the client half loads only modules DSH already provides.

```bash
# load a package from a checkout into a DSH profile
dsh plugin --profile web add /absolute/path/to/package
# restart DSH afterwards; the page loads the new client half on start
```

- Checks: `node --check` on `packages/dsh-rayrun-bots/index.js` and `client.js`, then `node packages/dsh-rayrun-bots/test/manifest-check.mjs`, `locale-audit.mjs`, `rpc-contract.mjs`, `client-contract.mjs`, and `node tools/rayrun-deploy/test/contract.mjs`.
- CI: those checks run on Node 24 and 26, the pushed diff must pass `git diff --check`, and a separate job installs the package into a throwaway DSH profile and composes its config against DSH `0.2.1-rc.5` and `0.2.2-rc.5` (`.github/workflows/checks.yml`). That job does not test the cloud-computer plugin, start the web app, or make Rayrun calls. An opt-in `deploy` job runs on a main-branch push (or manual dispatch) when `RAYRUN_TOKEN` and `RAYRUN_SANDBOX_ID` are configured and `packages/dsh-rayrun-bots/**` changed: it packs the plugin, installs it into the sandbox's DSH web profile, restarts `dsh web` on the public 6080 ingress, and writes the tokenized URL to `/workspace/dsh-web-url.txt` (mode 600). The URL and token are never printed; fetch the URL with `node tools/rayrun-deploy/fetch-url.mjs`. A stopped sandbox is started (billable).
- Live integration tests still need real Rayrun credentials and never run in CI. The deploy job is the only CI path that uses a real Rayrun token; it is a maintainer deployment, not a test, and never runs on pull requests or forks.
- Read [`CLAUDE.md`](CLAUDE.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing anything. Commit messages are in English with `feat:`, `fix:`, `chore:` or `docs:` prefixes.

## Status

*As of 2026-11-21.*

| | |
| --- | --- |
| **Works today** (separate project, our dependency) | Seven `rayrun_*` tools, noVNC desktop, per-session cloud/local routing, hash-verified workspace sync, task delegation, worker projection, optional idle stop. Verified on DeepSeek Harness `0.2.1-rc.5`. |
| **This repository** | README, docs, issue and PR templates, agent rules, the dependency boundary, and `dsh-rayrun-bots`: a health route, a persisted local bot roster (`bots.*` RPC with atomic `bot.json` writes), and the v0.1 client shell (five screens, roster-backed chat list, in-memory conversation preview, same-origin host status, setup Rayrun token bridge, setup computer creation, and Open / Take over through the cloud-computer plugin RPC), with plain-Node checks, a checks-first CI workflow (Node 24/26 plus a DSH profile-install smoke), and an opt-in main-only Rayrun deploy job. No cloud bot runtime and no publishable release yet. |
| **Not built yet** | Page-level computer-creation verification, bot↔session mapping, a persistent DSH host on the machine, remote approvals that gate a worker (blocked on Rayrun host/agent isolation; ADR-001), routines that actually run, per-bot spend attribution, IM channel, the two-plugin install path (dependency declaration and version check), npm packages and the release/publish CI path. |
| **Platform gaps** | Host/agent permission isolation and a host-only approval endpoint (ADR-001), safe inbound networking (today the token ingress is unusable and only `public` works), idle auto-stop, a spend cap, dynamic resource adjustment, the session-resume contract. The full list is in [docs/08-integration.md](docs/08-integration.md) §3 and [docs/01-system-architecture.md](docs/01-system-architecture.md). |

**v0.1 path** — install from npm → sign in → create a bot → approve its first gated action. Exit criteria are in [docs/plans/roadmap.md](docs/plans/roadmap.md).

## Acknowledgements

- [Rayrun](https://rayrunos.com/) for the cloud computers and the separate [dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer) plugin this project builds on.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for the agent runtime this plugs into.
- Grok Bot, dsh-superagent and OpenMausBot, which showed what this shape should be — and where it breaks.

## License

MIT. Your Rayrun account, your cloud computer and your DeepSeek key stay yours; the license covers the code in this repository.
