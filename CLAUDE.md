# CLAUDE.md

Behavioral guidelines for coding agents working in this repo. The four universal principles come first, adapted from Andrej Karpathy's January 2026 observations on LLM coding pitfalls (via the MIT-licensed `multica-ai/andrej-karpathy-skills` artifact). Project-specific rules follow and always win where they are more specific.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios — except at trust boundaries (see §6).
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

<!-- Project-specific rules. Where these are more specific than the universal
     principles above, these win. -->

## 5. Project map

Repository: **Rayrun Bot** (`RayrunOS/Rayrun-Bot`). DSH plugin package names keep the `dsh-` prefix for DSH discovery.

- `README.md` — product page (English, source of truth); `README.zh-CN.md` — mirror, updated in the same commit.
- `docs/` — quick start, architecture, security, FAQ, roadmap, MVP plan, client plan, UI design, local file design, platform asks. README stays short; detail goes here.
- `packages/dsh-rayrun-bots/` — the whole product layer: bot roster, bot↔session mapping, persistent host, approvals, routines, client panel, and the adapter to the cloud-computer plugin. Does not exist yet; that is what this repo is building.
- `dsh-rayrun-computer` — **a separate project** (`RayrunOS/dsh-rayrun-computer`, MIT), not a directory in this repo. It provides the cloud computers and the `rayrun_*` tools; Rayrun Bot consumes it as a dependency. Never modify, fork or vendor it here.
- `package.json` — private workspace root. No dependencies, no build step.

Read `README.md` and the relevant `docs/` page before changing anything; read the code you are editing, not your memory of it.

## 6. Invariants — never break these

1. **Approval-first, fail closed.** No action with an external side effect (spending money, sending or publishing as the user, destroying a computer, touching another machine or credential) may execute before an approval is requested and granted. Timeout, error, or unknown state means deny, never proceed.
2. **User secrets never leave the user's machine.** The Rayrun token lives in the Harness vault, host side, and must never reach a client module, an RPC response, or a log. The DeepSeek key goes through Rayrun credential injection only — never into the workspace, the repo, fixtures, prompts, or chat. Passwords live in memory only.
3. **The user pays, the user owns.** Every bot runs on the user's own Rayrun account and key. No code path may route compute, data, or billing through a project-owned account, proxy, or relay.
4. **Execution may leave the machine; authority and credentials do not.** Bots run on the user's own cloud computer and their sessions may live there, but approvals, the local profile and the Rayrun token stay on the user's side. Never move a decision or a secret to the cloud to make a feature simpler.
5. **No silent scope widening.** Do not add an approval bypass, a default-allow rule, a new permission, or new network egress unless the task explicitly asks for it.
6. **Package identity stays consistent.** Package name, client module id, and bundle row `name` must stay identical for each package; `lib/*.js` must stay in the package's `files` list; client halves must stay self-contained and load only modules DSH itself provides.
7. **Never auto-destroy.** Rayrun's `destroy` deletes the machine and its workspace irreversibly. Idle policy may stop or pause; destroying requires an explicit human request.
8. **Same-origin RPC.** New page→host actions keep the same-origin, origin-checked RPC property. Do not hand the page a token to bypass it.
9. **Honesty in docs.** Never describe a planned feature as implemented. The dated status statements in `README.md` and `docs/` are factual; if you build something, update them, and if you find a claim that is no longer true, fix it.
10. **No telemetry by default.** Nothing is collected or uploaded. Any future telemetry must be opt-in, documented, and never include prompts, keys, or workspace contents.
11. **The cloud is root without bubblewrap.** The worker profile intentionally runs `danger-full-access` as a workaround, not as isolation. Never present it as a sandbox guarantee or weaken the warning about it in `docs/security.md`.
12. **The cloud-computer plugin is a dependency, not our code.** `dsh-rayrun-computer` lives in its own repository and is never edited, forked or vendored from here. Integration goes through its published tools/RPC surface and a version contract; a change that needs its behavior is an issue/PR in that repository, or an adapter in ours.

## 7. Change workflow

1. Read this file, `README.md`, and the package's own README before editing.
2. Find the closest existing pattern (grep first) and extend it; don't create a parallel helper for something the repo already has.
3. Make the smallest possible diff; no unrelated formatting.
4. User-visible change → update `README.md` AND `README.zh-CN.md` in the same change, and the relevant `docs/` page.
5. Run the checks in §8; never declare done on "it should work".
6. Commit in English with a conventional prefix: `feat:`, `fix:`, `chore:`, `docs:`. One logical change per commit.
7. Never commit `.env`, tokens, keys, local profile paths, or pulled cloud artifacts (`.dsh/incoming/`).
8. **Never push to the remote without an explicit instruction for that push.** Local commits are fine when asked; `git push` (or anything that writes to `origin`) requires the user to ask for it in that request. A past "sync to GitHub" instruction does not authorize later pushes.

## 8. Checks and definition of done

There is no build step and no test suite in this repo yet — packages have not landed. Do not invent commands. Until they do:

```bash
git diff --check                       # whitespace errors
node --check path/to/changed-file.js   # syntax, once packages exist
```

When the packages land, each carries its own `node test/*.mjs` scripts (the plain-Node pattern from `dsh-rayrun-computer`), and new behavior comes with a test. Live integration tests need real Rayrun credentials and are never run in CI.

"Done" means all of the following:

- The success criteria from the request are met, with evidence (command output, screenshot, test result), not "should work".
- Checks above pass for every changed file.
- Markdown links resolve, and no doc claims a feature that does not exist.
- No secret, credential, or token material appears in code, logs, fixtures, or the diff.
- No new dependency, no unrelated diff, no unrelated refactor.
- `README.md` / `README.zh-CN.md` / `CLAUDE.md` are still accurate.

For approval-layer or secret-handling changes, the manual smoke test is: load the plugin into a local DSH profile, start one bot, trigger one gated action, and watch it stop for approval. While that path does not exist yet, the change must keep the rule true on paper and call out the gap.

## 9. Conventions

- Plain ESM JavaScript, Node 24+ (the DSH runtime bundles Node). No build step, no runtime dependencies, no bundler.
- Client code may import only modules DSH provides (`react`, etc.). Browser globals are fine; Node built-ins are not.
- Errors: never swallow errors around approvals, credentials, or cloud lifecycle; surface an actionable message and let the caller fail.
- Runtime language: the product is English-first. Code, comments, docs, and commits are English; the README has a Chinese mirror.
- Tests follow the existing `node test/<name>.mjs` style — no test framework. Negative tests for approval refusal, timeouts, and secret leakage are mandatory once that code exists.
- Never weaken or delete a safety test to make a change pass; fix the behavior or explain why the test was wrong.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, clarifying questions come before implementation rather than after mistakes, and no approval or secret invariant is ever weakened to make a test pass.
