# Rayrun platform asks

*Status: 2026-11-11. What RayrunOS needs to add or confirm for Rayrun Bot, and
what blocks which milestone. This is a handoff list for the platform team. The
MVP is deliberately designed to ship without most of it; each ask lists the
workaround we use in the meantime and the shape of the API we would want.*

We are a BYO open-source client: we do not need SaaS, multi-tenant control
planes, SSO/SCIM, marketplace or billing features. We need the substrate to be
explicit and safe for a 24/7 bot product.

## Blocks the v0.1 MVP

### 1. Session and long-lived runtime contract (P0, needs confirmation)

Today: one agent task per machine (`409 sandbox_busy`, no queue), and the docs do
not say whether a session id can be created or continued across prompts. A
machine's processes are not documented to survive stop/start, and there is no
startup hook.

Need: a documented contract for
(a) creating and continuing a session by id across prompts;
(b) running a supervised long-lived process inside the machine — start command,
restart policy, and what happens on stop/start/reboot;
(c) a startup hook or platform supervisor so our bot host comes back after a
machine restart.

Why: Bot↔session mapping and "laptop closed, the bot keeps working" are the
core of the product.

Workaround without it: per-turn headless runs plus transcript replay (slower,
more expensive) and a local watchdog that restarts the host through `exec`.

Requested shape: `session_id` accepted and returned by the prompt API; a
services/entrypoint API (`command`, `restart: on-failure`, started on boot), or
documented systemd support; a machine-started event.

### 2. Balance grace and spend guardrails (P0)

Today: balance exhaustion force-destroys every sandbox in the organization,
including disks; only `max_lifetime_seconds` exists, and it stops without
restarting; there is no spend cap.

Need: suspend instead of destroy on zero balance, a low-balance
event/notification, and a documented way to cap spend per sandbox or account.

Why: a 24/7 bot losing its workspace is data loss and a support disaster, not
merely a billing event.

Workaround: local balance polling, warnings, and idle stop. We cannot prevent a
force-destroy.

Requested shape: `balance.low` / `sandbox.suspended` events; a grace period
before destroy; a per-machine budget field.

### 3. File control-channel semantics (P1)

Today: we use workspace files as the approval/control mailbox and poll them
every 3 s.

Need: atomic write/rename semantics, revision/ETag on download, list pagination
and documented rate limits; or the message channel below.

Why: reading a half-written approval file is a correctness bug, and polling has
a request budget.

Workaround: unique file names, write-then-rename, and a checksum inside the
payload.

### 4. Outbound control channel (P1, recommended)

Need: a local-authenticated subscribe channel (SSE or WebSocket) that the cloud
process can publish to, with no inbound networking, ordered delivery,
at-least-once semantics and rate limits.

Why: it replaces file polling for approvals and status, cuts latency, and keeps
the no-public-ingress rule intact.

Workaround: the file mailbox above.

## Needed for v0.2 / beta

- **Safe inbound networking.** Per-instance hostname and certificate,
  token/gateway auth, WebSocket and SSE passthrough. Today the token tier of the
  ingress API is unusable (403) so only `public` works; we never expose it as the
  product panel. This blocks remote UI, phone approvals and desktop takeover from
  another device. Workaround: local polling and IM.
- **Scoped credentials.** API tokens or a device flow limited to sandbox CRUD
  and prompt, named, expirable, revocable, and without billing or org rights.
  Today we hold an account token in the Harness vault. Workaround: keep it in
  the vault only and recommend a dedicated account.
- **Generic secret injection** beyond the model slots, so users can deliver their
  own GitHub, IM or SaaS tokens to the machine, unreadable by `exec`.
- **Machine lifecycle events.** Webhook or SSE for started/stopped/failed and
  low balance, so local or IM clients react without polling.
- **Per-sandbox usage.** Time-series usage (`vm_hours`, egress) per sandbox, so
  the cost bar can attribute spend per bot. Today we show balance and total
  hours only.
- **Prompt queue.** Platform-side queueing instead of `409 sandbox_busy`, so
  several bots on one machine serialize gracefully.
- **Golden image and DSH version.** An official image with a current DSH (the
  image ships `0.2.0-rc.2`; the local baseline is `0.2.2-rc.1`) and a documented
  version matrix; optionally image build and pinning.

## Later / enterprise — not needed for the OSS MVP

SSO/SAML/SCIM, org RBAC, audit export/SIEM, DPA and data residency,
marketplace/agent APIs, multi-region and SLA. Revisit only if an enterprise
edition appears.

## API hygiene

- Version the API, publish the OpenAPI document as the source of truth, and keep
  a changelog and deprecation policy. Today the endpoint count differs between
  pages (67 vs 93).
- An error-code dictionary, documented rate limits, and `Retry-After`.
- Confirm or mark beta: runtime `PUT /egress`, arbitrary-port ingress, PTY
  `/terminals`, and image builds were all documented but not usable in the
  2026-11-01 test.

## Priority summary

| Ask | Needed by | Blocks ship today? |
| --- | --- | --- |
| 1. session + long-lived runtime contract | v0.1 | confirmation required |
| 2. balance grace / guardrails | v0.1 | risk accepted with warnings |
| 3. file channel semantics | v0.1 | no (workaround) |
| 4. outbound control channel | v0.1 quality | no (polling) |
| safe inbound | v0.2 | no |
| scoped credentials | v0.2 | no |
| secrets, lifecycle events, usage, queue, image | beta | no |
| enterprise items | later | no |
