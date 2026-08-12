# DraftLoop

[![CI](https://github.com/akoita/draft-loop/actions/workflows/ci.yml/badge.svg)](https://github.com/akoita/draft-loop/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-24.5.0-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-10.18.3-F69220?logo=pnpm&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7.0.2-3178C6?logo=typescript&logoColor=white)
![Anthropic](https://img.shields.io/badge/provider-Anthropic-D97757)
![OpenAI](https://img.shields.io/badge/provider-OpenAI-412991)

DraftLoop is a local-first, agentic CV-crafting workspace. It combines a job
description and a local evidence directory with a cross-provider author–critic
loop, so a tailored CV can be revised against an explicit readiness rubric
before the candidate approves it.

The agents are useful participants, not authorities: source evidence stays
traceable, provider exposure is explicit, and export requires human approval.

## What exists today

The repository currently provides the product foundation for the author–critic
workflow:

- canonical workspace, requirements, evidence, rubric, and model configuration
  contracts;
- Zod schemas for persisted and exchanged context;
- Anthropic and OpenAI adapters with strict structured-output requests;
- provider-diversity checks, data-exposure policy enforcement, normalized
  provider errors, usage/cost metadata, and deterministic tests;
- local privacy guardrails, credential redaction, content-free operational
  events, a repository-grounded threat model, and a first/revised/manual
  evaluation comparison gate;
- a phase-0 CLI workflow that connects local ingestion, SQLite history,
  orchestration lifecycle, approval decisions, and local Markdown/DOCX/PDF
  export;
- a desktop UI shell and package boundaries for the next implementation stages.

The desktop review experience and richer provider/presentation workflows remain
to be built on these contracts.

## Stack

| Area | Technologies |
| --- | --- |
| Language and runtime | TypeScript, Node.js 24.5.0, pnpm 10.18.3 |
| Workspace | pnpm monorepo with framework-free domain packages |
| Model providers | Anthropic SDK, OpenAI SDK, cross-provider author–critic pairing |
| Contracts and validation | Zod, strict TypeScript, JSON Schema structured outputs |
| CLI and desktop shell | Commander, React 19, Vite |
| Persistence and output | Drizzle ORM, SQLite boundary, Markdown/PDF/DOCX rendering contracts |
| Quality | Biome, ESLint, Markdownlint, Vitest, GitHub Actions |

## Architecture

The monorepo separates product contracts from adapters:

- `domain` defines framework-free concepts and workflow states.
- `schemas` validates exchanged and persisted structures.
- `orchestrator` coordinates rounds without knowing provider SDK details.
- `providers` contains Anthropic/OpenAI adapter boundaries and provider
  diversity checks.
- `ingestion` and `evidence` normalize local sources and connect claims to
  evidence.
- `validation`, `evaluations`, and `artifacts` check and represent drafts.
- `security` owns privacy classifications, retention defaults, redaction, and
  allowlisted operational events.
- `rendering` and `storage` handle output and local persistence boundaries.
- `apps/cli` is the first user-facing adapter.
- `apps/desktop` is the React desktop UI shell.

See [docs/architecture.md](docs/architecture.md) for the workflow state
machine, trust boundaries, and stopping conditions.

Security and data handling are documented in [the threat model](docs/threat-model.md)
and [privacy and evaluation policy](docs/privacy-and-evaluation.md).

## Quick start

Requirements: Node 24.5.0 and pnpm 10.18.3.

```sh
pnpm install --frozen-lockfile
pnpm validate
```

To run the current CLI shell:

```sh
pnpm start
```

The phase-0 CLI workflow is available with a local workspace manifest:

```sh
pnpm --filter @draft-loop/cli start -- init ./workspace \
  --job-description ./job.md --sources ./evidence --fixture
pnpm --filter @draft-loop/cli start -- start ./workspace
pnpm --filter @draft-loop/cli start -- status ./workspace
pnpm --filter @draft-loop/cli start -- approve ./workspace
pnpm --filter @draft-loop/cli start -- export ./workspace
pnpm --filter @draft-loop/cli start -- export ./workspace --format pdf
pnpm --filter @draft-loop/cli start -- export ./workspace --format docx
```

Fixture mode is deterministic and offline. Live provider execution requires
both provider credentials and the explicit `--allow-provider-data` approval;
the CLI prints the provider pairing and budget before starting. Progress output
contains states, steps, counts, and codes, not prompts or source content.

Keep candidate data out of the repository. Before using real application
material, review the provider transmission and retention policy for the
workspace.

Approved artifacts are rendered locally. Every export records the artifact
version, template version, timestamp, format, and SHA-256 checksum in local
history.

## Validation

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
```

For development, `pnpm format` applies the Biome formatter. See
[CONTRIBUTING.md](CONTRIBUTING.md) for change and pull request guidance.

## Project status

DraftLoop is an early-stage private project. The initial use case is a
job-specific CV, but the contracts are intentionally shaped for other
evidence-backed drafting and review workflows.

Human approval remains mandatory. DraftLoop does not submit applications,
publish documents, or perform uncontrolled web research on a user's behalf.
