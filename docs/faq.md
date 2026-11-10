# FAQ

*Status: 2026-11-11. Pre-alpha. Two separate projects: the cloud-computer plugin
at [RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)
works on its own; the bot half of this repository does not exist yet and will
reuse that plugin as an external dependency. Short answers here; details in
[architecture](architecture.md), [security](security.md) and
[roadmap](roadmap.md).*

## Is this a SaaS?

No. It is an open-source plugin for DeepSeek Harness, under MIT. There is no
project-hosted service, account, relay or control plane: you bring your own
Rayrun account and your own DeepSeek API key. The code runs on your machine and
on your cloud computer.

## If the software is free, who do I pay?

You pay Rayrun for compute and DeepSeek for tokens. Rayrun bills cloud
computers by the second (about ¥57.6/month for 2 vCPU / 2 GiB kept always-on at
the time of writing); model usage is on your DeepSeek account. This project
neither collects payment nor resells compute or tokens.

## Which model does it use?

DeepSeek, through your own DeepSeek API key. The key is stored as a Rayrun
credential and injected into the agent process inside your cloud computer, so
the model calls come from that machine, not from this project.

## Can I use another model provider?

Not designed or tested. This product only wires the DeepSeek credential path.
DSH itself can talk to other model providers, but that path is outside v0.1 and
must be verified before it can be claimed.

## Can I point it at another cloud backend, like E2B?

No. The integration is Rayrun-specific: the tools call the Rayrun API directly.
A provider abstraction is an open decision and is not planned for v0.1; adding
one later would be a redesign of the plugin's cloud layer, not a config flag.

## Is my Rayrun token safe?

It should be: the token lives in the DeepSeek Harness credential vault on the
host side, the page never receives it, and a page→host call is a same-origin,
origin-checked RPC. Passwords are memory-only. Residual risks — a compromised
host, a malicious plugin in the same profile — are in [security.md](security.md).

## Is my DeepSeek key safe?

The key is stored as a Rayrun credential and injected into the agent process
only; `exec` shells in the machine cannot read it, and the plugin does not read
it. "Never in logs" is a design claim still being verified — see the status
note in the [README](../README.md) and [security.md](security.md). Whether the
cloud provider itself could read a stored credential is **not verified**; do
not assume it cannot.

## Do I need to install two plugins?

Yes, today: Rayrun Bot plus the separate
[RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)
project. Rayrun Bot reuses that plugin as an external dependency and does not
modify, fork or vendor it. The Rayrun Bot bundle is intended to declare it as a
dependency so one install brings both, but whether a DSH bundle dependency loads
both host and client halves is the W0 spike S6 and is **not verified**. Until
then — and until both are on npm — install both plugins from their checkouts
into the same DSH profile and restart DSH.

## Why is this repository mostly docs?

Because this repository is the project for the bot half, and the bot half is not
written yet. It is not a monorepo for the cloud-computer plugin: that package is
a separate project at
[RayrunOS/dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer)
and stays one. The bootstrap commit here is README, docs, templates and agent
rules; code arrives with v0.1.

## What can I do today, then?

Install the separate cloud-computer plugin from a checkout into DeepSeek Harness
and use its seven tools: create/stop/pause/destroy a machine, run commands, move
files, drive the desktop, delegate tasks, sync a workspace, project a worker
layer. It is a dependency of Rayrun Bot, not part of this repository. The
[quickstart](quickstart.md) has the exact commands and a "what is missing" table.

## How is this different from Grok Bot?

Grok Bot is a hosted product: xAI/Cursor runs the machine, the model is part of
the subscription, and the client is a dedicated app distributed by them. This
project is the opposite
of hosted — open code, your Rayrun account, your DeepSeek key, and DSH as the
client. It borrows the product shape (named bots sharing one persistent
computer, approvals when a bot needs you) but is not a clone and has no
marketplace, mobile app or managed onboarding.

## How is this different from dsh-superagent or OpenMausBot?

`dsh-superagent` is DeepSeek's research prototype for one GitHub repository: it
runs locally, has no cloud computer and is explicitly reference-only.
OpenMausBot is a broader Apache-2.0 self-hosted product whose cloud desktop is
an external service; it is a useful UX reference but not a Rayrun/BYO
integration. This project's bet is narrower: DSH as the brain, Rayrun as the
computer, credentials the user already owns. See
[../README.md](../README.md) for the acknowledged inspirations.

## What happens if I forget to stop the computer?

You keep paying by the second. Rayrun has no platform-side idle auto-stop
today; the computer package has an optional `idle_stop_minutes` that stops (not
destroys) an idle machine, but its timer lives in host memory and is lost on
restart. `max_lifetime_seconds` stops a machine without restarting it. If your
balance runs out, the platform can force-destroy your organization's machines
including disks — so watch the balance as a data-loss risk, not just a cost.

## Are approvals working?

Not on the cloud path. The design contract is fail-closed (timeout or unknown
means no), and the approval UI inside DSH exists, but the cloud worker profile
currently runs with `approval: never` because there is nobody to ask on a
headless machine. That is the biggest gap and the first thing v0.1 must fix; a
cloud bot is unsupervised until it is.

## Can I self-host?

There is nothing to self-host on our side — no server. Your DSH runs locally.
Rayrun's CLI can point at a self-hosted Rayrun deployment, but that is Rayrun's
product, not this project's, and it is not verified for this use case (TBD).

## Is it on npm? Can I install it as a plugin?

Neither package is on npm. The bot package — `dsh-rayrun-bots`, the intended
install name — is not installable yet. The cloud-computer package from the
separate `RayrunOS/dsh-rayrun-computer` project is not on npm either; install it
from a checkout with `dsh plugin --profile web add <absolute path>` and restart
DSH. Both stay checkout-based until they are published.

## Is my data uploaded anywhere?

Not to us: there is no project server. Your workspace is pushed to your own
Rayrun cloud computer, prompts go from that machine to DeepSeek, and Rayrun and
DeepSeek's terms apply to what reaches them. Nothing in this repository sends
telemetry.

## What is the roadmap?

Short version: v0.1 is the bot plugin plus the cloud-computer dependency, on
`dsh web`, with one computer, a bot roster, fail-closed approvals and a cost bar;
v0.2 adds an IM channel with your own bot token; v1.0 may add a thin desktop
shell. Exit criteria and the not-planned list are in [roadmap.md](roadmap.md).
