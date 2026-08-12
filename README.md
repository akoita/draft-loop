# DraftLoop

DraftLoop is a local-first, agentic CV-crafting workspace. It combines a
candidate's job description and evidence directory with an author–critic loop
so a tailored CV can be revised against an explicit readiness rubric before the
candidate approves it.

The initial workflow is deliberately narrow: ingest local source material,
create an evidence-backed draft, obtain an independent critique from a model
operated by another provider, revise for a bounded number of rounds, and export
only after human approval. The agents are useful participants, not authorities.

## Local-first architecture

The monorepo separates product contracts from adapters:

- `domain` defines framework-free concepts and workflow states.
- `schemas` validates exchanged and persisted structures.
- `orchestrator` coordinates rounds without knowing provider SDK details.
- `providers` contains Anthropic/OpenAI adapter boundaries and provider
  diversity checks.
- `ingestion` and `evidence` normalize local sources and connect claims to
  evidence.
- `validation`, `evaluations`, and `artifacts` check and represent drafts.
- `rendering` and `storage` handle output and local persistence boundaries.
- `apps/cli` is the first user-facing adapter.
- `apps/desktop` is the future React desktop UI shell.

See [docs/architecture.md](docs/architecture.md) for the workflow state
machine and stopping conditions.

## Quick start

Requirements: Node 24.5.0 and pnpm 10.18.3.

```sh
pnpm install
pnpm validate
```

This repository is a scaffold. The package entrypoints establish contracts for
the product; provider calls, ingestion implementations, and artifact rendering
are intentionally not implemented yet.

## Validation

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

For development, `pnpm format` applies the Biome formatter. Keep candidate data
out of the repository and review any provider or retention policy before using
real application material.
