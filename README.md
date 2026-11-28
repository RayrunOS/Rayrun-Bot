<div align="center">

<img src="packages/dsh-rayrun-bots/icon.svg" width="76" alt="Rayrun Bot icon">

# Rayrun Bot

**Bots with a name, a body, and a home.**

Rayrun Bot is the bot layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).
Each bot has a name, a job brief, memory, and a schedule, and it lives on your own
[Rayrun](https://rayrunos.com/) cloud computer: a Linux machine you can watch and
take over. It thinks with your DeepSeek key. The computer is billed to your Rayrun
account, and the model bill is yours.

There is no project-run account, relay, or control plane. You install this
repository into DeepSeek Harness.

English | [简体中文](README.zh-CN.md)

</div>

> **Pre-alpha.** v0.1 is not delivered, the three-minute first-run path has not
> been timed end to end, and this is not a production bot layer or a product for
> a general audience. What works, what is missing, and which combinations were
> actually checked is [docs/12-status.md](docs/12-status.md). If this page and
> that doc disagree, the status doc wins. Summary below is as of 2026-11-25.

<p align="center">
  <img src="docs/mockups/conversation.png" width="920" alt="Design preview of the Bots conversation">
</p>
<p align="center"><sub>Design preview, not a screenshot of today's build. Wired behavior is in <a href="docs/12-status.md">docs/12-status.md</a>.</sub></p>

## Who it is for

People who already run DeepSeek Harness and want a named bot on a Rayrun computer
they pay for, using their own DeepSeek key, with an approval stop on starting,
stopping, pausing, and resuming that computer.

It is for someone who can read the status doc and tolerate gaps. It is not a
hosted assistant, a bot marketplace, or a multi-tenant platform.

## Install

You need [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) first.
This package declares `engines.dsh` `>=0.2.0-rc.2 <0.3.0`. The command below was
checked with DSH `0.2.2-rc.5`. Checked combinations are in
[docs/version-matrix.md](docs/version-matrix.md).

Install both plugins from the official npm registry, in one command, with the
versions pinned:

```bash
npm_config_registry=https://registry.npmjs.org \
  dsh plugin --profile web add \
  dsh-rayrun-computer@1.3.1 dsh-rayrun-bots@0.1.1-alpha.3
```

Restart DSH after that. The Bots page loads when the page starts.

Then, in Bots:

1. Connect Rayrun. The token stays in the Harness vault on the host. The page does not receive it.
2. Adopt a computer you already have, or create one. Creating a computer is billed by Rayrun. The page can stop a machine. Only a confirmed computer update destroys the old computer, after the replacement is ready.
3. If the computer does not already have a DeepSeek credential, the setup step can store your key as a Rayrun credential. The key is injected into the agent process. It does not go into the workspace or the chat.
4. Create a bot and send a message. The default roster starts empty; a `?preview=1` page shows sample bots as an in-memory demo. Samples never run on a computer.

`dsh-rayrun-bots@0.1.1-alpha.3` is the npm `alpha` dist-tag. `latest` is still
`0.1.0-alpha.0`. There is no stable release. An untagged
`npm install dsh-rayrun-bots`, or `dsh plugin add` without these versions, does
not select `0.1.1-alpha.3`. Installing the bots package alone does not turn on
the computer plugin: both packages have to be in the same `dsh plugin add`.
Pin `dsh-rayrun-computer` at `1.3.1`. Version `1.2.2` first returned machine
credential binding names; `1.2.1` and older do not. `1.3.0` adds
`credentials.save`, and `1.3.1` is the current `latest`. A mirror can lag
behind the official registry, which is why the command sets the registry.

On 2026-11-25 the install path was checked with the earlier `1.2.1` pin: both
plugins loaded, and one turn sent to an existing stopped hosted machine came
back. That check used the on-machine host and a maintainer machine. The current
`1.3.1` pin and the `1.2.2+` default path have not yet been re-run end to end.
The machine from that check is not a setup requirement, and the check is not a
promise for every account or image.

The on-machine host is the default execution path on `dsh-rayrun-computer` 1.2.2+.
It needs an image new enough for Rayrun runtimes (`dsh-bot@1`); the Update
computer button moves an older machine. Operator notes are in
[docs/09-deployment.md](docs/09-deployment.md).

## What you can do today

Still pre-alpha. This is the short version; evidence is in
[docs/12-status.md](docs/12-status.md).

- Load both plugins and open a Bots page: roster, conversation, details, new bot, setup, and settings, in Chinese and English.
- Keep bots you create: name, instructions, session, and transcript survive a page reload.
- Send a turn to a Rayrun computer you already have. A stopped or paused machine may be started for that turn, which spends machine time. Closing the page does not have to drop the turn.
- Open the computer's desktop, and stop the machine. Stop does not destroy it; only a confirmed computer update removes the old computer, after the replacement is ready.
- Approve or deny start, stop, pause, and resume. Allow once runs that action from your local host. Deny, expiry, or an unknown result does not run it.
- Create, pause, and remove an interval routine. A routine is an ordinary turn. Turning one on can wake a machine and spend money on later runs. Cron and event triggers are not built.
- Run one persistent host on the computer, shared by your bots. It is the default on dependency 1.2+, so a routine can run while local DSH is stopped. The hosted check used a machine image new enough for Rayrun runtimes (`dsh-bot@1`); older official images can reject the runtime with `guestd_outdated` until the computer is updated.

## What it does not do

- It does not deliver v0.1, and the three-minute first-run path has not been timed end to end. A clean-install browser turn and the start/stop/pause/resume approval cards have been checked on a maintainer machine; that is not a promise for every account.
- It does not publish a stable release. `latest` remains the older alpha.
- It does not host the bot for you, meter you, or hold your accounts. There is no project relay in the middle.
- It does not approve actions other than machine start, stop, pause, and resume. Credential actions on the computer are not covered. The cloud computer is the agent's security container; the agent runs with full access inside it by design (ADR-020). It is not an approval sandbox, and a bot is not a security boundary: your bots share one computer.
- It does not offer IM channels, a per-bot spend report, or cron and event triggers.

## How the pieces fit

```
you ── chat / approve ──▶ DSH (your desk)
                           │  bot layer
                           ▼
                      Rayrun API
                           ▼
       your Rayrun cloud computer   (one per person, shared by your bots)
         ├─ workspace, browser, desktop
         └─ model calls ──▶ DeepSeek (your key, injected into the agent process)
```

You pay Rayrun for the computer and DeepSeek for the model. This project does
not sit on either bill. The license for the code is MIT.

One computer per person is the design: cheaper, and the bots share files the way
one person's tools do. The tradeoff is the one in the list above. A bot may work
inside that computer; the machine actions that are built stop for approval, and
a timeout is a no.

## Read next

| | |
| --- | --- |
| [Status](docs/12-status.md) | What works, what is missing, and the checked combinations. This page defers to it. |
| [Install and run](docs/09-deployment.md) | Operator notes, including the on-machine host. |
| [Version matrix](docs/version-matrix.md) | DSH, computer plugin, and bot package combinations that were actually checked. |
| [Security](docs/07-security.md) | What is protected, and what is not. |
| [FAQ](docs/faq.md) | Pricing, credentials, models, and limits. |
| [Product direction](docs/00-product-direction.md) | Who it is aimed at, and the v0.1 scope. v0.1 is not delivered. |
| [Contributing](CONTRIBUTING.md) | How to propose a change. |
| [Documentation index](docs/README.md) | The rest of the docs. |

## License

MIT. Your Rayrun account, your cloud computer, and your DeepSeek key stay yours.
The license covers the code in this repository.
