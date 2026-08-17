# Contributing

Thanks for helping build DraftLoop. Keep changes small, auditable, and aligned
with the package boundaries described in [AGENTS.md](AGENTS.md).

## Development

Use Node 24.5.0 and pnpm 10.18.3, then run:

```sh
pnpm install
pnpm validate
```

Add or update focused tests with behavior changes. Public contracts should use
explicit types and validated schemas. Do not add generated artifacts, local
databases, credentials, or candidate documents to commits.

## Working on the author-critic flow

There are two ways to exercise the provider loop, and they are not
interchangeable.

**Fixture mode is the development loop.** A workspace created in `demo` mode
runs the whole workflow against local fixtures with no network call and no
provider spend; the desktop host reports the endpoint as
`local fixture (no network)`. `pnpm desktop:smoke` drives that path end to end.
Iterate here.

**The live-provider gate is a release step, not a development step.**
`pnpm test:e2e:live` sends the synthetic material to real Anthropic and OpenAI
endpoints and bills real usage on every run. Run it deliberately, before a
release, as described in [docs/releasing.md](docs/releasing.md).

Reaching for the live gate during ordinary iteration is the quickest way to
exhaust a provider budget, and an exhausted budget blocks the release
validation the gate exists to serve. The gate prints the models it is about to
bill before launching, so check that line before letting a run proceed.

## Pull requests

Explain the user-visible or architectural effect, identify privacy and provider
implications, and include the validation commands you ran. Changes that alter
workflow states, persistence, provider selection, or export behavior should
also update the relevant architecture documentation.
