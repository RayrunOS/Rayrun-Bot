# Grok Bot inspiration for Rayrun Bot

*Status: 2026-11-12. What we borrow from Grok Bot's product framing — a resident
personal AI agent that runs a team of named bots on a shared cloud computer — and
what we deliberately leave out. Sources: the 2026-11-09 docs snapshot
(`research/_sources/grokbot-docs/`), the product description in this thread, and
our own [architecture](architecture.md), [MVP plan](mvp-plan.md) and
[bot persona](bot-persona.md).*

## 1. The three pillars, restated

1. **Doing, not chatting.** The user assigns work — clean an inbox, plan a
   campaign — and the bot executes in the cloud and reports back. No supervision.
2. **A roster of bots on one computer.** Several named bots with different jobs
   share a single cloud Linux machine, so they can use the user's logged-in apps
   and sites (including legacy systems with no API) by driving a browser or
   desktop. A shared workspace and handoffs let work flow between them.
3. **Independent memory.** Each bot keeps its own conversations and learned
   context, so it gets better at its job over time.

Rayrun Bot already sits on the same three ideas: named bots, one computer per
person shared by those bots, per-bot sessions, memory directories and files. The
inspiration is in the *glue* — how the roster behaves as a team, and how the
result comes back to the user.

## 2. What we already share

| Grok Bot idea | Where we have it |
| --- | --- |
| Named bot with a job and a light persona | [bot-persona.md](bot-persona.md); `bot.json` name/label/instructions |
| One shared cloud computer per user | [architecture.md](architecture.md) §4.1; Rayrun one machine per user |
| Per-bot conversation and memory | `/workspace/.rayrun/bots/<id>/{memory,sessions}` in [mvp-plan.md](mvp-plan.md) §4.2 |
| Autonomous run after the laptop closes | persistent bot host; run continues without the local UI |
| Human-in-the-loop for outside effects | approval cards, deny/allow once, expired background cards |
| Attention states and report-back | needs attention / unread / working in the roster |

What is missing is the team layer and the browser-persistence layer. Those are
the two places the inspiration actually changes our plan.

## 3. Borrow list, ranked

| Idea | When | Why |
| --- | --- | --- |
| Role labels and colleague naming (already done) | v0.1 | makes a roster feel like a team without building anything else |
| Task receipts: result + artifacts + cost + "what needs you" | v0.1 | the "report back" half of doing; cheap to compute from the transcript |
| Stop now / redirect mid-task | v0.1 | a colleague must take a changed instruction; chat already has the channel |
| Per-bot memory directory + default instructions | v0.1 (schema), v0.2 (behavior) | the seam for independent memory without building a memory product |
| Bot-to-bot handoff via the shared workspace | v0.2 | the team behavior that is actually implementable on our platform |
| Primary bot as coordinator | v0.2 | one bot that checks in and routes work; a Grok Bot pattern |
| Memory review: correct/forget, shared facts | v0.2 | memory that cannot be inspected is a liability |
| Persistent browser profile and sign-ins | blocked on Rayrun | unlocks legacy systems; platform must promise it |
| Multi-bot parallel execution | blocked on Rayrun | one agent task per machine (`409 sandbox_busy`) today |
| Shared bots, teams and templates | later | multi-tenant features; out of the open-source BYO scope |
| Marketplace, mobile, voice, group chats | no | product surface we are not building |

## 4. Design: the team layer (v0.2 candidate)

Grok Bot's bots can pass work to each other. The cheapest version for us uses
what the machine already has — a shared `/workspace` and a shared DSH runtime:

- **Handoff file.** A bot that needs another role writes
  `/workspace/.rayrun/handoffs/<from>-<to>-<id>.md` with `task`, `context`,
  `artifacts`, `done_when`, and `reply_to`. The receiving bot reads it on its next
  turn. No new service, no network, no bot-to-bot RPC.
- **Handoff card.** The transcript renders a small card: "Weekly Watch handed
  *draft review* to Docs Refresh" with the done criteria and a link to the
  artifact. Clicking opens the receiving bot.
- **Receipt.** When the work returns, the original bot posts a receipt: outcome,
  artifacts, elapsed time, spend, and what needs the user. This is the "report
  back" surface the user actually reads.
- **Coordinator.** A `primary` flag on one bot (v0.2) lets it check in on the
  others and summarise the team's day. It is a convenience, not a requirement.
- **Loop guard.** Handoffs carry a hop count and a deadline; more than 3 hops or
  a missed deadline ends the chain and asks the user. No infinite bot chatter.

Not in v0.1: the roster stays single-task. The machine runs one agent task at a
time, so two bots "in parallel" would serialize anyway; promising teamwork we
cannot deliver would break the honesty rule.

## 5. Design: the shared computer as a legacy-system bridge

The point of the shared computer is not only files: it is that the bots can use
the same logged-in browser and desktop a person would. That is what makes
"clean my inbox" or "pull the report from that old portal" possible without an
API. Our v0.1 already has the machine, the desktop and screenshots; it does not
have persistent sign-ins.

- **v0.1**: a bot can drive the browser/desktop inside a session; the user can
  take over for SSO, CAPTCHA or a bank step. Sign-ins that do not persist are
  documented as a limitation, not hidden.
- **v0.2 (blocked on Rayrun)**: persistent browser profile and login state across
  sessions and restarts. [platform-asks.md](platform-asks.md) already asks for
  safe inbound networking; add browser-profile persistence to the same
  conversation.
- **Security**: credentials never go through chat. A login is either a Rayrun
  credential slot or a manual step on the computer; approvals protect anything
  that leaves the machine.

## 6. Design: independent memory without a memory product

"Each bot gets better over time" is attractive and easy to over-build. Our v0.1
keeps it small:

- Every bot has `/workspace/.rayrun/bots/<id>/memory/` and a session transcript.
  The instructions may tell it to keep notes there; nothing is summarized
  automatically.
- **Memory is not a source of truth.** Like Grok Bot's own docs say, memory is
  context, not evidence. The bot must re-read the workspace or the source of
  truth before acting on a dated fact.
- **v0.2**: a nightly summary into `memory/summary.md`, a "what does this bot
  remember" panel with correct/forget, and a very small set of shared facts
  (name, time zone) that all bots can see.
- Memory writes never bypass approvals; forgetting is immediate and local.

## 7. Design: report-back is the product

The difference between "a chat that ran a tool" and "a colleague who did the
work" is the receipt. v0.1 already produces everything a receipt needs:

| Receipt field | Source |
| --- | --- |
| Result | final message + exited task state |
| Artifacts | files created in the bot's workspace/Library |
| Cost | machine-hours and the bot's share of spend |
| What needs you | pending approval or question |
| When | timestamps from the queue log |

The UI shows this as the conversation's last block and as an unread marker on
the roster; no separate dashboard.

## 8. What we deliberately do not copy

- **Subscription/seat model.** User pays Rayrun and DeepSeek directly.
- **Hosted control plane and multi-tenant orgs.** The repo is BYO open source.
- **Marketplace, templates, shared bots.** Later, if ever; they need an account
  system and moderation we do not have.
- **Parallel-bot claims.** Until the platform supports more than one agent task
  per machine, the product speaks about a queue, not a team running in parallel.
- **Group chats and bot-to-bot chatter.** Handoffs are files with a done
  criterion, not a social feed.

## 9. Roadmap placement

| Milestone | Team-layer work |
| --- | --- |
| v0.1 | role labels, receipts, stop/redirect, per-bot memory dir, single-task queue |
| v0.2 | handoff files + handoff cards, primary bot check-in, memory review, browser persistence when Rayrun ships it |
| v1.0 | shared bots/teams only if an account model appears; otherwise stay single-user |

The MVP plan's out-of-scope list stays as it is: no team coordination in v0.1.
