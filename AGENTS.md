# Working instructions

## Roadmap alignment

Before proposing or implementing roadmap-stage work, read `docs/roadmap.md`,
align the work with its current stage, and update the roadmap when scope or
priorities change.

## MVP execution mode

DraftLoop is a small side-project MVP. Use Maestro for routine feature and
bug-fix work with one verified Luna implementation worker. Do not add a scout
or separate review worker unless a specific unresolved question blocks
implementation. The Sol root owns requirements, one consolidated diff review,
and publication.

Use one issue, one implementation task, and one PR. During implementation,
inspect only the files needed for the issue, run focused checks, and perform
the full repository gate once before opening the PR. Do not add standalone
architecture, generalized framework, documentation, or tracker work unless it
directly blocks the MVP outcome.

## Sprint execution budget

Broad outcome issues are rollups, not executable sprint work. Before coding,
an admitted execution issue must have one observable outcome, one primary
architecture boundary, one focused test surface, and a credible one-PR exit.
If it combines concerns such as migration, lifecycle, runtime integration, UI,
and representative evaluation, create ordered child issues first.

Routine MVP work uses one verified Luna implementation worker and no separate
scout or reviewer unless a specific unresolved question blocks implementation.
Keep Sol coordination to requirements, one consolidated review of the
completed diff, and publication. Fail closed before implementation if the
worker route cannot be verified. Do not continuously poll hosted checks.

An execution issue has a 20-minute active implementation-and-review budget,
excluding time spent waiting for local tests or hosted CI. At the limit, stop
and split remaining work into a new bounded issue before continuing. Never
silently turn one issue into a multi-hour task. Preserve quality by reducing
scope, not by skipping required checks or merging incomplete work.

## Hotspot containment

The architecture hotspot check freezes growth in the existing monolithic
domain, schema, storage, knowledge-base, and local-runtime files. New feature
logic and focused tests belong in feature-specific modules; hotspot files may
contain only compatibility exports or thin wiring that does not increase their
line-count baseline. Whenever an extraction reduces a hotspot, lower its
recorded limit in the same change so the reduction cannot regress.

## Documentation synchronization

- Keep code synchronized with `README.md`, architecture documents and diagrams,
  examples, CLI help, and roadmap references.
- Update affected documentation in the same PR, or state why no update is needed.
- Write for the intended human reader and the document's purpose. Lead with the
  useful information, give each paragraph or list item one coherent point, and
  use headings, short paragraphs, and scannable lists where they improve
  comprehension. Source line wrapping is not paragraph structure.
- Keep only current, relevant detail in each document. Summarize and link to the
  canonical source instead of copying implementation history across documents,
  and restructure prose blocks longer than about 120 words.
- Remove stale, redundant, or misplaced content whenever affected
  documentation is updated.

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

## Change delivery

Every change reaches `main` through a pull request. Work on a branch and never
fast-forward, rebase, or push directly to `main`. An agent may merge through the
PR only when the user explicitly asks and all required checks pass. A green
local gate is a precondition for opening the PR, not a substitute for review or
for the checks that run on it.

Resolve conflicts on the branch rather than on `main`, and say in the PR body
which side of any conflict was taken and why.

## Release guardrail

Before initiating any release action locally, including dispatching the
`Release` GitHub workflow, run `pnpm release:preflight` from the exact revision
being released and require it to pass. Do not bypass this command or substitute
an older live-provider result. The command runs deterministic validation first
and then the synthetic live-provider E2E with the explicit local mixed-auth
defaults. It must never run in CI/CD, and provider credentials or subscription
sessions must never be added to hosted automation.

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
