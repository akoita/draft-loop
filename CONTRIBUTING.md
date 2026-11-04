# Contributing

Thanks for helping build DraftLoop. Keep changes small, auditable, and aligned
with the package boundaries described in [AGENTS.md](AGENTS.md).

## Development

Use Node 24.22.1 and pnpm 10.18.3, then run:

```sh
pnpm install --frozen-lockfile
pnpm validate
```

Add or update focused tests with behavior changes. Public contracts should use
explicit types and validated schemas. Do not add generated artifacts, local
databases, credentials, or candidate documents to commits.

## Working on the author-critic flow

Exercise the loop offline. It is the development loop, and it spends nothing:

- **CLI:** `draft-loop init --fixture` creates a workspace that runs the whole
  workflow against deterministic offline agents.
- **Server:** `pnpm server:test` starts the
  [local server stack](docs/operations/local-server-stack.md), whose worker uses
  offline fixtures, and runs the server suites and the smoke.

Real providers bill every call. Run a paid check only with the owner's approval
for its exact plan, as described in
[docs/operations/releasing.md](docs/operations/releasing.md#live-provider-checks-manual).
No paid check runs in CI.

## What CI runs on a pull request

CI runs only what a change can reach. The Change scope job decides, using
[`scripts/ci-scope.mjs`](scripts/ci-scope.mjs):

| Change | What runs |
| --- | --- |
| Docs only (`docs/`, root Markdown files, issue and PR templates) | formatting and Markdown lint |
| A workspace package under `apps/` or `packages/` | static checks, then tests for that package and every package that depends on it |
| `deploy/`, Compose files or a Dockerfile | static checks, tooling tests and the Self-hosted stack |
| The toolchain, `ci.yml`, or a path the script does not know | everything |

Static checks (formatting, lint and typecheck) always cover the whole
repository. Every push to `main` runs everything, with the tests split
across three runners. The required check
`validate` is a gate job that reports on every pull request, so a skipped job
never blocks a merge.

When CI skipped a package you expected it to test, check its `package.json`
declares the workspace dependency. Then add the case to
[`scripts/ci-scope.test.mjs`](scripts/ci-scope.test.mjs).

## Pull requests

Explain the user-visible or architectural effect, identify privacy and provider
implications, and include the validation commands you ran. Changes that alter
workflow states, persistence, provider selection, or export behavior should
also update the relevant architecture documentation.
