# Architecture

DraftLoop is a local-first multi-model drafting and review workspace. The first
artifact is a job-specific CV, but the contracts are shaped around a reusable
workflow: canonical requirements and evidence produce an artifact, an
independent critic evaluates it, and a human approves the result.

## Boundaries

```text
apps/cli       apps/desktop
   |
application ---- orchestrator ---- providers ---- Anthropic / OpenAI SDKs
   |       \                  \
   |        evaluations / validation   local OpenAI-compatible endpoint
   |
schemas ---- domain ---- evidence ---- ingestion
   |           |                    \
storage/retrieval ---- artifacts ---- rendering   approved URL fetch
```

The packaged desktop path adds a native boundary around the same application
contract:

```text
React renderer -> preload NativeBridge -> Electron main host
                                      -> application -> SQLite/orchestrator
```

The renderer receives bounded projections for workspace and run state. Native
dialogs, workspace paths, SQLite handles, credential persistence, provider SDK
construction, URL fetching, and export writes remain in the main process. The
renderer can submit an API key only through the allowlisted credential command;
the main process validates the command and owns encryption, status, removal,
and environment fallback. Browser mode intentionally has no native filesystem
or persistent credential capabilities and keeps a deterministic fixture
fallback. See [ADR 0004](adr/0004-desktop-credential-boundary.md).

- Domain concepts do not depend on provider SDKs, storage engines, or UI
  frameworks.
- Schemas validate data crossing package and persistence boundaries.
- Ingestion turns user-selected local sources into normalized material.
- URL ingestion is a bounded network capability: the user approves the fetch,
  the host validates the URL and response limits, and the resulting source
  retains its original/final URL and provenance.
- Evidence preserves source identifiers and locations for substantive claims.
- Retrieval is workspace-scoped behind a provider-independent port. SQLite
  FTS/BM25 is the integrated lexical baseline and supplies selected chunks to
  live author and critic requests; local vector and hybrid implementations are
  evaluation components until deletion, retention, isolation, and quality are
  validated for the product path.
- The orchestrator owns round sequencing, budgets, pause/stop behavior, and
  user-visible run events; provider adapters own SDK translation only.
- The application package owns adapter-neutral use cases and command/query
  contracts. CLI and desktop adapters use the same local driver without
  importing one another or exposing provider SDKs to the UI.
- Validation is deterministic where possible. Evaluations represent rubric
  scores and structured critique; neither is treated as proof of truth.
- Storage is local by default. Rendering consumes approved artifacts and does
  not submit them anywhere.
- Backup/restore, retention purge, and content-free diagnostic export are
  explicit local operations. Their existence does not imply encrypted storage
  or validated disaster recovery on every platform.
- Context snapshots cross the persistence boundary through
  `serializeContextSnapshot` and `parseContextSnapshot`; the Zod schema checks
  version, requirements, evidence checksums, rubric values, and model identity
  before a snapshot is reloaded.

## Evidence-grounded evaluator–optimizer

DraftLoop applies the evaluator–optimizer pattern to a factual, evidence-backed
workflow. The author is the optimizer's generator, the independent critic is
the evaluator, and each revision is a bounded optimization step against a
visible rubric. The product uses the author–critic language in the UI because
it is easier for candidates to understand; the evaluator–optimizer description
names the underlying control pattern.

```text
canonical inputs + rubric
          |
          v
     author draft ---------> structured artifact + evidence links
          ^                                      |
          |                                      v
   bounded revision <----- independent evaluator + deterministic checks
          |
          v
  stable / budget exhausted / user review early
          |
          v
       human approval -> local export
```

The loop is deliberately not a generic “make the prose better” cycle:

- The rubric covers factuality, evidence support, requirement coverage, and
  quality. Deterministic validators handle checks that do not need a model.
- Evaluator findings are structured, actionable, severity-rated, and linked to
  claims, sections, or source locators where applicable.
- The evaluator may identify a problem, but it cannot establish truth by
  itself. User evidence and explicit human decisions remain authoritative.
- A different provider is used by default for author and evaluator, with both
  provider and model identities recorded in run history.
- The orchestrator stops after configured round, cost, or time limits, when
  quality is stable, or when the user chooses to review early. It never loops
  indefinitely to optimize a subjective score.

This makes the pattern especially suitable for CV drafting: the output is
verifiable against a target job and candidate-owned sources, while unsupported
claims remain visible instead of being polished into false confidence.

See [ADR 0003](adr/0003-evidence-grounded-evaluator-optimizer.md) for the
decision and trade-offs.

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
| `provider-error` | A provider request failed and the normalized error is available for recovery. | The corresponding active step on explicit retry, `paused`, `stopped` |
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
`provider-error` exists in the orchestration state and retries the recorded step;
the desktop bridge must expose that state and its recovery action before
provider-error recovery is considered integrated.

## Trust and privacy controls

The system keeps evidence links, structured findings, approved artifact
versions, revisions, decisions, provider/model identity, usage, and checksums
recoverable without storing hidden chain-of-thought. Raw prompts and raw
provider responses are not operational-log or audit payloads; only structured,
user-visible work product required by the workflow is retained under the local
data policy. Provider calls require an explicit data policy, and local retention
settings must be visible per workspace. Human approval is mandatory; job
discovery, application submission, and uncontrolled external research are
outside the MVP.

See [the threat model](threat-model.md) and [privacy and evaluation
policy](privacy-and-evaluation.md) for the current trust boundaries, redaction
rules, retention defaults, and deterministic evaluation gate.

The CLI and packaged desktop host are adapters over these contracts. They use
the same local application driver, which stores a small workspace manifest
beside a local SQLite history file, ingests selected local sources, constructs a
context snapshot, and drives the orchestration engine. Offline fixture agents
make the lifecycle testable without network access. The desktop renderer uses
the same adapter-neutral review port through a capability-limited bridge;
browser mode has no filesystem or persistent credential capabilities and
retains only a deterministic fixture fallback. Live provider execution is
opt-in and the provider boundary enforces the request data policy before the SDK
call. Completing and validating the full desktop preflight remains current
roadmap work. Approved artifacts are rendered locally to Markdown, controlled
DOCX, or controlled PDF. Each renderer consumes the same ordered structured
artifact; the application records artifact version, template version,
timestamp, format, MIME type, and checksum in the immutable export record.

Additional artifact schemas, multilingual templates, portfolio ingestion, and
the local endpoint adapter reuse these boundaries at component level. They are
not considered integrated or outcome-validated merely because their contracts
and tests exist; the [roadmap](roadmap.md) records the evidence level for each
stage.

The `pilot` CLI command uses synthetic local fixtures to validate the phase-0
mechanics end to end: ingestion, authoring, independent criticism, one bounded
revision, approval, export, typed local history, and audit events. Its report
contains only safe counts and identifiers. It is a workflow validation, not
evidence that the quality hypothesis has been proven on real applications.
