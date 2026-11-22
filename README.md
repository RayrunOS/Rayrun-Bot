# Rayrun Bot

English | [简体中文](README.zh-CN.md)

**Bots with a name, a body and a home.**

Rayrun Bot is the bot layer for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The product gives each bot a name, instructions, memory and a schedule — and a place to live: your own [Rayrun](https://rayrunos.com/) cloud computer, a Linux machine you can watch and take over. Bots are designed to think with your own DeepSeek API key. Nothing is hosted by us: the compute runs on your Rayrun account, the model bill is yours, and the approval prompt is the contract.

> Rayrun Bot is pre-alpha. What works today, what does not, and the combinations actually verified live in [docs/12-status.md](docs/12-status.md). This page is the product story, not the source of record.

## Why bots, not chats

A chat session ends when the tab closes. A bot keeps its name, its job brief, its memory and its workspace. You assign work, close the laptop, and come back to a colleague that reports what it did, what it needs, and what it deliberately did not do.

The product is built around four parts, and only one of them needs to be online.

- **The desk — DeepSeek Harness on your machine.** This is where you talk to bots, approve actions and change settings. The design keeps work running when you close the laptop; the desk is where you come back to, not where the bots live.
- **The body — your Rayrun cloud computer.** One Linux machine per person, shared by that person's bots: its own vCPU and memory, a persistent `/workspace`, an X11 desktop, and the ability to run commands, move files and drive a browser. You pay Rayrun directly, by the second.
- **The brain — your DeepSeek key.** The design injects the API key you stored as a Rayrun credential into the agent process inside the machine, so model calls come from that machine. The key does not go into the workspace or the chat.
- **Memory — DSH state on the machine.** A bot is designed as a persistent DSH object: its instructions, skills, scratchpad and session live in a profile directory and survive restarts. The bot↔session mapping is what lets it resume instead of restart.

```
you ── chat / approve ──▶ DSH (your desk)                browser tab or desktop app
                           │  bot layer: tools · same-origin RPC · approvals
                           ▼
                      Rayrun API · https://api.rayrunos.com/v1
                           ▼
       your Rayrun cloud computer   (one per person, shared by your bots)
         ├─ DSH host on the machine: one session per bot
         ├─ /workspace · browser profile · X11 desktop
         └─ model calls ──▶ DeepSeek API (your key, injected per process)
```

## The surface we are building

The Bots surface is designed as three columns inside DSH: the roster on the left, a markdown conversation in the middle, and the current bot's details on the right. Approval requests are designed to appear inline, where the action stopped — not in a separate inbox. The setup flow is designed as four steps: the dependency, Rayrun, the computer and the first bot.

![The Bots conversation, as designed](docs/mockups/conversation.png)

*Design preview. The visual design and clickable mockups are in [docs/design/ui-design.md](docs/design/ui-design.md) and [docs/mockups/index.html](docs/mockups/index.html); for what is wired up, read the [status page](docs/12-status.md).*

## Design choices

- **One computer per person, not per bot.** It is cheaper and simpler, and bots share files, browser sessions and credentials the way a person's tools do. The tradeoff: a bot is not a security boundary — do not use two bots as sandboxes against each other.
- **Bring your own accounts.** No control plane of ours holds your keys or meters your usage. Rayrun is your infrastructure vendor, DeepSeek is your model vendor, and this repository is the glue.
- **Local-first where it protects you.** Your workspace, profile and credentials stay on your side; execution can leave the machine, decisions and secrets do not.
- **Approvals are fail-closed.** Unknown, expired or unanswered means no. A bot may work freely inside its own computer, but anything with an outside effect waits for you.
- **Boring on purpose.** Plain ESM, no runtime dependencies, no build step; the DSH on your desk is the same DSH that runs in the cloud.

## Who it is for

Rayrun Bot is for people who want a personal AI colleague that does real work on a real computer they control — clearing an inbox, watching a channel, pulling a report from a legacy portal — without handing their accounts to a hosted service.

It is not a hosted SaaS, a bot marketplace or a multi-tenant platform. There is no project-run account, relay or control plane: your Rayrun account pays for the computer, your DeepSeek key pays for the model, and the approval prompt is the contract.

## Read next

| | |
| --- | --- |
| [Status](docs/12-status.md) | What works today, what is missing, and the verified combinations. |
| [Running what exists today](docs/09-deployment.md) | Install the dependency, load the plugin from a checkout, configure it. |
| [Product direction](docs/00-product-direction.md) | Who it is for, the v0.1 scope and the product decisions. |
| [System architecture](docs/01-system-architecture.md) | Layers, boundaries and the trust model. |
| [Approvals](docs/05-approvals.md) | What needs a yes, who executes it, and why the cloud path is on hold. |
| [Security](docs/07-security.md) | What is protected, what is not, and how to report a vulnerability. |
| [FAQ](docs/faq.md) | Pricing, credentials, models, self-hosting and the honest limits. |
| [Contributing](CONTRIBUTING.md) | How to propose a change and the local checks. |
| [Documentation index](docs/README.md) | The full doc map and the ADR register. |

## Acknowledgements

- [Rayrun](https://rayrunos.com/) for the cloud computers and the separate [dsh-rayrun-computer](https://github.com/RayrunOS/dsh-rayrun-computer) plugin this project builds on.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for the agent runtime this plugs into.
- Grok Bot, dsh-superagent and OpenMausBot, which showed what this shape should be — and where it breaks.

## License

MIT. Your Rayrun account, your cloud computer and your DeepSeek key stay yours; the license covers the code in this repository.
