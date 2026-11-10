# Security

*Status: 2026-11-10. The cloud-computer package is real and its guarantees below
are marked with evidence. The bot half is not built, so its security properties
are design intent, not verified behavior. Items being checked are marked
**TBD**.*

This product brings your own credentials: your Rayrun account token, your
DeepSeek API key, and your cloud computer. This page says what the design
protects, how, and — just as important — what it does not protect. To report a
vulnerability, use [SECURITY.md](../SECURITY.md) at the repository root; do not
open a public issue.

## Design goals

1. **Credentials stay on the user's side.** No project-owned server, relay or
   control plane exists, so there is nowhere for a token to be pooled.
2. **The Rayrun token never reaches a page.** It lives in the Harness vault on
   the host side and is used only by the host half of the plugin.
3. **The DeepSeek key is injected, never read.** Rayrun stores it and injects
   it into the agent process on the machine; the plugin and its tools do not
   read it, and `exec` shells inside the machine cannot see it.
4. **Approvals fail closed.** An external side effect waits for a human yes;
   timeout or unknown state means no.
5. **No telemetry by default.** The project does not collect or upload usage
   data.
6. **No hidden egress.** A new cloud machine starts with outbound networking
   off; hosts are listed explicitly for a reason.

## What is protected today

| Property | State |
| --- | --- |
| Rayrun token lives in the Harness credential vault, host side only | implemented and tested in the computer package |
| The page never receives the token; it calls a same-origin, origin-checked RPC route | implemented; cross-origin POSTs are refused, response bodies never carry the token |
| Passwords are held in memory only, never written to disk or logs | implemented in the computer package |
| DeepSeek key is injected by Rayrun into the agent process only; `exec` shells cannot read it | verified on the Rayrun side; the key is not read by the plugin |
| `destroy` is irreversible — the machine and its workspace are deleted together | Rayrun API behavior, stated in the package docs |
| A new machine has no outbound network until allowlisted | Rayrun default, stated in the package docs |
| No telemetry from this project | policy for this repository; see "Telemetry and outbound calls" below |

## Telemetry and outbound calls

This repository sends nothing. The bot half must keep it that way: telemetry,
if any ever exists, has to be opt-in, documented, and must never include
prompts, keys or workspace contents (this is an invariant in
[CLAUDE.md](../CLAUDE.md)).

Besides the Rayrun API calls it exists to make, the one outbound call the
cloud-computer package makes on its own is an update check against an npm
registry; it sends the package name and reads the latest version. That call
must stay documented, and the new packages must preserve that narrow shape or
drop it.

## Threat model

**Credentials on the host.** The token is the account's API token. Anyone who
can read it can create and destroy machines and spend the account's balance.
Mitigations: vault storage on the host (the research target is an
OS-keychain-backed credential store where available; the exact backing of the
Harness vault is TBD), no token in client code or RPC responses, no token in
logs or the repository. Residual risk: a compromised host, a malicious plugin
in the same DSH profile, or a bug in an RPC handler. Keep the DSH install and
its plugins trustworthy.

**The model is untrusted.** The agent runs model output. Prompt injection via
files, web pages, email or tool output is expected, not exceptional. The
mitigation is the approval layer, not a sandbox: the cloud image runs as root
without bubblewrap, and the worker profile runs with `danger-full-access` as a
workaround. Treat a bot as having full access to its own computer, and do not
treat two bots as isolation boundaries from each other.

**The cloud computer is shared.** One machine per person is shared by that
person's bots, including files, browser state and credentials. This is a product
decision (cheaper, more like a person's desk), not a security guarantee. If one
bot is compromised it can reach what the others left on the machine.

**Public inbound.** The desktop port on a Rayrun machine can be published
publicly; the token tier of the ingress API is unusable today. Do not use a
public desktop URL as the product panel, and do not assume it is private. The
bot layer must route its own traffic through an authenticated gateway with
short-lived tokens once that exists (TBD).

**Supply chain.** A DSH bundle's host code runs inside the DSH process, with the
user's privileges; install from sources you trust. The project's goals are no
runtime dependencies and no build step; if a dependency or installer is ever
added it gets reviewed like code, and lockfile/provenance practice for it is
TBD.

**Cloud and model vendor terms.** Rayrun operates the machine; DeepSeek serves
the model. Their terms, data handling and availability apply to the data that
reaches them. This project cannot promise DPA, SOC 2, regional residency or a
delete-on-request guarantee on their behalf, and does not.

## What is not protected

- **Browser logins and saved sessions on the cloud machine.** Persisting a
  signed-in browser across restarts is not implemented and is not in v0.1; the
  design deliberately does not build a credential vault that fills forms for
  the model.
- **The model key's visibility to the cloud provider.** It is verified that the
  agent's `exec` environment cannot read the key; whether Rayrun staff or the
  platform itself could read a stored credential is **not verified**. Do not
  write "Rayrun cannot see your key".
- **The approval path until it exists.** Today the cloud worker profile runs
  with `approval: never` on the bot path, so a cloud bot is unsupervised. Only
  run one with credentials and machines you are prepared to lose.
- **Untrusted model output.** A model can be wrong, manipulated, or malicious;
  approvals reduce the blast radius of actions, they do not make the model
  trustworthy.
- **Multi-bot isolation.** There is none. Bots share a computer.
- **Destructive mistakes.** `destroy` deletes the workspace; nothing recovers
  it. Stopping or pausing keeps the disk.

## Practices for users and contributors

- Never put a Rayrun token, API key or password in a repository file, fixture,
  issue, pull request or chat message.
- Keep the Rayrun token in the Harness vault; prefer a dedicated Rayrun
  account or token you can revoke.
- Set `egress_allow` narrowly; a new machine defaults to no network.
- Prefer stop over destroy unless the machine is meant to disappear.
- Watch the Rayrun balance: an exhausted account can force-destroy machines
  including their disks, which is a data-loss risk, not only a cost risk.
- At the repository level: no runtime dependencies, no build step, and review
  every dependency or installer that is added.

## Related

- [SECURITY.md](../SECURITY.md) — reporting and scope.
- [Architecture](architecture.md) — where each boundary sits.
- [FAQ](faq.md) — short answers about accounts, models and hosting.
