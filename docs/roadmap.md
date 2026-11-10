# Roadmap

*Status: 2026-11-10. Pre-alpha bootstrap. The milestones below come from the
product research that shaped this repository; they are direction, not promises.
Nothing on the v0.1 list is built in this repository yet — the cloud-computer
half is a separate package and the bot half does not exist. Dates are omitted on
purpose.*

## Where we are (M0 — bootstrap)

The repository exists, its rules and docs are written, and the product page
describes both the target and the current honest status. No publishable code
lives here yet.

Exit criteria:

- README, docs, CLAUDE.md and the community files exist and every link resolves;
- the honest status section says what works, what does not, and what is
  blocked on the Rayrun platform;
- the existing cloud-computer package stays installable from its own repository.

## v0.1 — the closed loop

Goal: one person, one cloud computer, one or more named bots, a fail-closed
approval card, and a visible bill. Everything shipped on the DSH plugin +
`dsh web` path; no desktop app.

Scope:

- **Packages land in this monorepo.** `packages/dsh-rayrun-computer` (the
  existing cloud-computer layer, package name and API unchanged) and
  `packages/dsh-rayrun-bots` (the new product layer).
- **Bot roster and bot↔session mapping.** A bot has a name, instructions,
  skills, a memory directory and a persistent session; the mapping survives a
  DSH restart instead of living in host memory.
- **Persistent DSH host on the machine.** Replace "one `headless` run per
  prompt" with a supervised host, so a bot can keep working after the laptop
  closes. The session-resume contract with Rayrun is the first spike.
- **Fail-closed approvals.** DSH approval seam → host half → browser card →
  decision written back. Timeout, unknown or closed panel means deny.
- **Routines, minimal.** A scheduled prompt that wakes a bot; no marketplace of
  triggers.
- **Cost bar.** Machine hours and balance visible; idle stop remains a plugin
  option (stop only, never destroy).
- **Packaging and CI.** npm package(s), version compatibility with DSH, tests,
  and a release path.

Exit criteria (all of the following):

1. A new user can go from README to a running bot in about three minutes,
   without reading source code.
2. After the user closes their laptop, a bot still completes one background
   task.
3. A gated action stops for approval and resumes only after the user approves
   it in the browser.
4. The same bot's second conversation continues from where the first stopped.
5. Balance and machine hours for the session are visible.
6. Missing token or a failing cloud call produces a clear error, never a fake
   success.

The earlier research target also mentioned 20 seed users, a first-bot success
rate above 80% and weekly retention above 40%; treat that as internal
validation, not a public promise. A focused estimate for v0.1 from a working
cloud-computer base is 4–6 weeks of work — optimistic and not a commitment.

## v0.2 — remote approvals

Goal: the user can answer a bot from a phone without opening the DSH page.

Scope:

- an optional IM channel using the user's own bot token (Telegram or Feishu) —
  no relay server run by this project;
- approvals and "needs attention" messages delivered to that channel;
- the same fail-closed semantics as the browser path.

Exit criteria:

- a gated action can be approved or denied from the user's own IM bot;
- the message path carries no project-hosted component and no user token to a
  project server;
- the browser path keeps working if IM is not configured.

## v1.0 — optional desktop shell and stability

Goal: only if evidence says a standalone app is needed, wrap `dsh web` in a thin
desktop shell; never rewrite the chat UI. The research view is that the plugin
plus `dsh web` is the v0.1/v0.2 form and a desktop app is a later bet, worth
1–2 weeks of wrapping rather than a new client.

Also in scope for a stable v1.0, as capacity allows:

- a documented version compatibility matrix (DSH × cloud image × packages);
- release and install polish (package manager installs, provenance, an update
  story);
- public, dated status docs that match the shipped code.

Exit criteria:

- the shell adds only packaging and OS integration; the UI is DSH's;
- a user can uninstall cleanly and revoke access at the provider;
- the docs' status claims are checked against the release, not aspirational.

## Not planned

These are explicitly out of scope. Some are permanent, some need a new decision
before they could ever enter a milestone:

- multi-tenant SaaS, hosted accounts, or any project-run control plane;
- team roles/RBAC, audit export, SSO/SCIM, enterprise compliance packages;
- a bot or skill marketplace;
- a native mobile app (IM answers the "from my phone" need for now);
- a credential vault that signs into third-party sites or fills forms for the
  model;
- multi-region hosting, high availability, or an SLA from this project;
- billing, metering or reselling of Rayrun compute or model tokens;
- a provider abstraction that lets the backend be swapped for E2B-style
  services, unless that becomes an explicit decision. Today the plugin is
  Rayrun-specific, and pretending otherwise would mislead users.

## Blocked on the Rayrun platform

Some v0.1 items depend on the platform, not on this repository:

- safe inbound networking with auth (today the token ingress is unusable and
  only `public` works);
- idle auto-stop or wake-on-request (today only an absolute lifetime cap);
- a spend cap or budget alerts;
- the session-resume contract (whether a session id can be passed to the cloud
  agent, unverified);
- runtime egress updates and generic secret injection beyond model slots.

[architecture.md](architecture.md) explains each one; [faq.md](faq.md) has the
user-facing version.

## How scope is decided

The guardrail is the three-minute first bot: if a feature makes the first-run
path longer or less honest, it waits. Safety invariants (fail-closed approvals,
no secrets leaving the user's side, no auto-destroy, no telemetry by default)
outrank milestones — a milestone does not justify weakening them.
