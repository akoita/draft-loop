# Working instructions

## Architecture boundaries

- `packages/domain` owns framework-free product concepts and workflow states.
- `packages/schemas` owns Zod schemas for persisted and exchanged data.
- `packages/orchestrator` coordinates the author–critic loop through ports; it
  must not contain provider-specific SDK calls.
- `packages/providers` owns model-provider adapters and explicit provider
  identity. The default author/critic pair must be Anthropic and OpenAI.
- `packages/ingestion`, `evidence`, `validation`, `artifacts`, `rendering`,
  `storage`, and `evaluations` each own the narrow concern named by the
  package. Keep dependencies flowing toward domain contracts.
- `apps/cli` is an adapter over package APIs, not a second domain layer.
- `apps/desktop` is a UI shell and must call the same application contracts as the CLI.

## Commands and quality gates

Use Node 24.5.0 and pnpm 10.18.3. From the repository root:

```text
pnpm install --frozen-lockfile
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm validate
```

Before sharing a change, formatting, linting, typechecking, and tests must pass.
Keep tests close to the package boundary they protect.

## Data, privacy, and model rules

- Keep candidate material and run history local by default. Do not upload or
  retain source material at a provider without an explicit user-controlled
  policy.
- Preserve source references for substantive claims, expose provider and model
  identities, and never invent achievements, dates, employers, or metrics.
- Provider diversity is a product constraint: Anthropic and OpenAI are the
  default cross-company pair. Warn when author and critic use the same company,
  and record model versions in run history.
- Do not expose or request hidden chain-of-thought. Store concise structured
  decisions, critique findings, evidence links, and user-visible rationale.

## External side effects

The application may prepare artifacts but must not submit jobs, send messages,
publish documents, modify external repositories, or call uncontrolled web
research without explicit user action and a visible approval boundary.
