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

## Pull requests

Explain the user-visible or architectural effect, identify privacy and provider
implications, and include the validation commands you ran. Changes that alter
workflow states, persistence, provider selection, or export behavior should
also update the relevant architecture documentation.
