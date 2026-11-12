# Contributing

Thanks for looking. Rayrun Bot is in pre-alpha: the repository is being
bootstrapped and nothing in it is published to npm yet. Please be kind to scope —
much of the design is still moving, and a small, correct change is easier to
land than a large speculative one.

## Propose before you build

- Bugs and small fixes: open an issue, or send a pull request directly.
- Features, new bots, or new packages: open an issue first so we can agree on
  the shape before you write code. Describe the user problem, not just the
  mechanism.
- Security problems: do not open a public issue — follow [SECURITY.md](SECURITY.md).

## Pull requests

- Keep diffs small and surgical. One concern per pull request.
- Write commit messages in English, using conventional prefixes: `feat:`,
  `fix:`, `chore:`, `docs:` (and `test:` or `refactor:` when it helps).
- Add tests for behavior changes once `packages/*` exist. Until then, a clear
  reproduction or a small manual check is enough.
- Never commit tokens, API keys, `.env` files, or cloud credentials. Use
  placeholders in examples.
- Update the docs in the same pull request when behavior changes, and make sure
  any link you add resolves in the tree.
- Link the issue you are closing (`Closes #123`) when there is one.

## Local checks

There is no build step. Each package carries plain-Node checks under its own
`test/` directory; run the repository checks from the root:

- `git diff --check` for whitespace errors.
- `node --check` on every JavaScript file you change.
- `node packages/dsh-rayrun-bots/test/manifest-check.mjs`
- `node packages/dsh-rayrun-bots/test/locale-audit.mjs`
- `node packages/dsh-rayrun-bots/test/rpc-contract.mjs`

The same checks run in CI (`.github/workflows/checks.yml`) on push and pull
requests. Live integration tests need real Rayrun credentials and never run in
CI. Do not assume a check that is not documented here.

## Code of conduct

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
