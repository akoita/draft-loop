# Architecture

DraftLoop is a local-first multi-model drafting and review workspace. The first
artifact is a job-specific CV, but the contracts are shaped around a reusable
workflow: canonical requirements and evidence produce an artifact, an
independent critic evaluates it, and a human approves the result.

## Boundaries

```text
apps/cli
   |
orchestrator ---- providers ---- Anthropic / OpenAI SDKs
   |       \
   |        evaluations / validation
   |
schemas ---- domain ---- evidence ---- ingestion
   |           |
storage ---- artifacts ---- rendering
```

- Domain concepts do not depend on provider SDKs, storage engines, or UI
  frameworks.
- Schemas validate data crossing package and persistence boundaries.
- Ingestion turns user-selected local sources into normalized material.
- Evidence preserves source identifiers and locations for substantive claims.
- The orchestrator owns round sequencing, budgets, pause/stop behavior, and
  user-visible run events; provider adapters own SDK translation only.
- Validation is deterministic where possible. Evaluations represent rubric
  scores and structured critique; neither is treated as proof of truth.
- Storage is local by default. Rendering consumes approved artifacts and does
  not submit them anywhere.
- Context snapshots cross the persistence boundary through
  `serializeContextSnapshot` and `parseContextSnapshot`; the Zod schema checks
  version, requirements, evidence checksums, rubric values, and model identity
  before a snapshot is reloaded.

## Author–critic loop

1. Create a workspace with a job description, local evidence directory,
   instructions, truthfulness policy, and readiness rubric.
2. Ingest and normalize selected source files into a canonical evidence base.
3. Ask the author to create a draft and attach evidence references to important
   claims.
4. Give the independent critic the same canonical inputs, the draft, and the
   rubric. The critic returns structured findings with categories and severity,
   not an untracked rewrite.
5. Ask the author to revise each finding or record a user-visible reason for
   rejecting it.
6. Repeat within the configured round and cost/time budgets.
7. Run deterministic checks, surface unresolved disagreements, and require
   explicit user approval before export.

The default provider pairing is cross-company: one Anthropic model and one
OpenAI model, with roles configurable and swappable. Provider identity and
model version are part of the run history. Same-company pairings may be
available as an explicit choice but must be visible and warned about.

## Workflow state machine

The state machine describes the lifecycle of a workspace run. A transition must
emit an auditable event and retain the relevant inputs, outputs, evidence links,
and user decision.

| State | Meaning | Allowed next states |
| --- | --- | --- |
| `collecting` | Workspace inputs are being assembled. | `ingesting`, `paused`, `stopped` |
| `ingesting` | Selected local material is being normalized. | `drafting`, `collecting`, `paused`, `stopped` |
| `drafting` | The configured author is creating a draft. | `reviewing`, `paused`, `stopped`, `budget-exhausted` |
| `reviewing` | The independent critic is producing structured findings. | `revising`, `awaiting-approval`, `paused`, `stopped`, `budget-exhausted` |
| `revising` | The author is addressing accepted findings. | `reviewing`, `awaiting-approval`, `paused`, `stopped`, `budget-exhausted` |
| `awaiting-approval` | Checks are complete and the user must decide. | `approved`, `revising`, `paused`, `stopped` |
| `approved` | The user approved the current artifact. | `exported`, `revising` |
| `exported` | An approved artifact was rendered locally. | — |
| `paused` | The user temporarily suspended the run. | `collecting`, `drafting`, `reviewing`, `revising`, `awaiting-approval`, `stopped` |
| `stopped` | The user ended the run. | — |
| `budget-exhausted` | A round, cost, or time budget ended the loop. | `awaiting-approval`, `revising`, `stopped` |

The loop should enter `awaiting-approval` when the readiness criteria are met,
quality is stable across configured consecutive rounds, or the user chooses to
review early. It must also enter that state after a budget is exhausted so the
user can inspect the best available artifact. It must not claim readiness when
high-severity factuality issues remain, critical job requirements are
unaddressed without an explicit gap, or a new unsupported claim was introduced.

## Trust and privacy controls

The system keeps evidence links, disagreements, revisions, prompts, responses,
and decisions recoverable without storing hidden chain-of-thought. Agent output
is presented as structured, inspectable work product. Provider calls require an
explicit data policy, and local retention settings must be visible per
workspace. Human approval is mandatory; job discovery, application submission,
and uncontrolled external research are outside the MVP.

See [the threat model](threat-model.md) and [privacy and evaluation
policy](privacy-and-evaluation.md) for the current trust boundaries, redaction
rules, retention defaults, and deterministic evaluation gate.

The phase-0 CLI is an adapter over these contracts. It stores a small workspace
manifest beside a local SQLite history file, ingests selected local sources,
constructs a context snapshot, and drives the same orchestration engine used by
future UI adapters. Offline fixture agents make the lifecycle testable without
network access; live provider execution is opt-in after the data-policy
preflight. Approved artifacts are rendered locally to Markdown, controlled
DOCX, or controlled PDF. Each renderer consumes the same ordered structured
artifact; the CLI records artifact version, template version, timestamp,
format, MIME type, and checksum in the immutable export record.

The `pilot` CLI command uses synthetic local fixtures to validate the phase-0
mechanics end to end: ingestion, authoring, independent criticism, one bounded
revision, approval, export, typed local history, and audit events. Its report
contains only safe counts and identifiers. It is a workflow validation, not
evidence that the quality hypothesis has been proven on real applications.
