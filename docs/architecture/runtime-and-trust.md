# Runtime and trust architecture

This page is the canonical current-state reference for the author–critic runtime, workflow states, active-duration accounting, application adapters, provider controls, and local export boundaries. It describes how shared application contracts preserve approvals, identity, recovery, and user-visible trust guarantees.

Use [Architecture overview](overview.md) for the system map. See [Candidate evidence](candidate-evidence.md) for the local source and profile contracts, and [Drafting and review](drafting-and-review.md) for the evaluator, artifact, and rendering-quality boundaries. The [privacy and evaluation policy](../security/privacy-and-evaluation.md) and [threat model](../security/threat-model.md) document the broader trust controls.

## Author–critic loop

Every live author request carries the same 8,192-token output cap in its
model-facing budget and transport configuration. The prompt asks for compact,
schema-only JSON while preserving supported facts, required sections, chronology,
and citations. Initial drafts, ordinary revisions, and adjudicated revisions all
retain this guidance, including retries whose latest failure concerns factuality.
The critic has its own independent output contract.

The existing provider usage checks still enforce the cap. Claude reports
[cumulative usage across a call](https://code.claude.com/docs/en/agent-sdk/cost-tracking),
so a token-budget failure alone does not establish the size of the final JSON.
Prompt guidance is not a guarantee of compliance; live effectiveness requires a
separate observation.

1. Create a workspace with a job description, local evidence directory,
   instructions, truthfulness policy, and readiness rubric.
2. Ingest and normalize selected sources into a canonical evidence base.
3. Ask the author for a draft with evidence references on important claims.
4. Give the independent critic the same canonical inputs, draft, and rubric;
   it returns structured findings rather than an untracked rewrite.
5. Ask the author to revise each finding or record a user-visible rejection.
6. Repeat within configured round and cost/time budgets.
7. Run deterministic checks, surface unresolved disagreements, and require
   explicit approval before export.

The default pairing is one Anthropic model and one OpenAI model, with roles
configurable and swappable. Same-company pairings must be visible and warned
about. Provider identity and model version are part of run history.

## Workflow state machine

Each transition emits an auditable event and retains relevant inputs, outputs,
evidence links, and user decisions.

| State               | Meaning                                                            | Allowed next states                                                                                                                           |
| ------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `collecting`        | Workspace inputs are being assembled.                              | `ingesting`, `paused`, `stopped`                                                                                                              |
| `ingesting`         | Selected local material is being normalized.                       | `drafting`, `collecting`, `paused`, `stopped`                                                                                                 |
| `drafting`          | The configured author is creating a draft.                         | `reviewing`, `paused`, `stopped`, `budget-exhausted`                                                                                          |
| `reviewing`         | The independent critic is producing structured findings.           | `revising`, `awaiting-approval`, `paused`, `stopped`, `budget-exhausted`                                                                      |
| `revising`          | The author is addressing accepted findings.                        | `reviewing`, `awaiting-approval`, `paused`, `stopped`, `budget-exhausted`                                                                     |
| `provider-error`    | A provider request failed and safe recovery metadata is available. | Corresponding active step on explicit retry (at most three attempts), `awaiting-approval` when an artifact can return to review, or `stopped` |
| `awaiting-approval` | Checks are complete and the user must decide.                      | `approved`, `revising`, `paused`, `stopped`                                                                                                   |
| `approved`          | The user approved the current artifact.                            | `exported`, `revising`                                                                                                                        |
| `exported`          | An approved artifact was rendered locally.                         | —                                                                                                                                             |
| `paused`            | The user temporarily suspended the run.                            | `collecting`, `drafting`, `reviewing`, `revising`, `awaiting-approval`, `stopped`                                                             |
| `stopped`           | The user ended the run.                                            | —                                                                                                                                             |
| `budget-exhausted`  | A round, cost, or time budget ended the loop.                      | `awaiting-approval`, `revising`, `stopped`                                                                                                    |

The loop enters `awaiting-approval` when readiness criteria are met, quality is
stable across configured rounds, the user reviews early, or a budget ends. It
must not claim readiness with unresolved high-severity factuality issues,
unaddressed critical requirements without an explicit gap, or newly introduced
unsupported claims. `provider-error` stays distinct across application and
desktop boundaries. Retry does not silently broaden the acknowledged
transmission scope.

### Active provider-duration accounting

When `maxDurationMs` is configured, each `RunSnapshot` persists an optional
`durationAccounting` record with accumulated active milliseconds and an
`activeSince` timestamp (or `null`). New runs start active at `startedAt`.
Drafting, reviewing, and revising accrue time; awaiting human approval,
explicit pause, provider-error retry waits, budget exhaustion, and terminal
states do not. Leaving active work settles the segment, and retry/resume or a
revision request starts a new segment. Provider calls remain inside the active
segment, so their elapsed time is counted without timers or cancellation.

Snapshots written before this record existed use conservative wall-clock time
from `startedAt` until a safe transition persists the migrated accounting.
Malformed accounting fails closed at the duration budget boundary, and clock
regressions never reduce accumulated active time. This accounting changes only
duration measurement; round, cost, retry, and cancellation semantics remain
unchanged.

## Trust and privacy controls

The system keeps evidence links, structured findings, approved artifact
versions, revisions, decisions, provider/model identity, usage, and checksums
recoverable without storing hidden chain-of-thought. Raw prompts and raw
provider responses are not operational-log or audit payloads. Provider calls
require an explicit data policy, and local retention settings are visible per
workspace. Human approval is mandatory; job discovery, application submission,
and uncontrolled external research are outside the MVP.

See [the threat model](../security/threat-model.md) and [privacy and evaluation
policy](../security/privacy-and-evaluation.md) for current trust boundaries, redaction
rules, retention defaults, and deterministic evaluation gates.

### Application adapter boundary

The CLI and packaged desktop host are adapters over the shared application
driver. The driver stores a workspace manifest beside application SQLite
history, ingests selected local sources, constructs context snapshots, and
drives orchestration.

Across CKB commands, the adapters differ only at the user-interaction edge:

- **CLI:** accepts intentional runtime-only file and directory paths.
- **Desktop:** owns native pickers in the host and projects only path-free,
  bounded results to the renderer.
- **Shared application boundary:** applies the same approvals, lifecycle guards,
  network policy, deterministic ordering, and complete-or-partial result
  contracts to both adapters.

Opportunity commands follow the same split. The CLI reads source manifests and
edit patches from intentional runtime-only JSON files. The desktop renderer can
provide approved URLs, pasted text, and typed candidate instructions, but asks
the host to resolve every local file through a native picker. Both adapters use
the same immutable application operations; provider extraction is enabled only
by an explicit per-create approval.

Store setup, selection, inspection, intake, refresh, rebind, retirement, and
directory maintenance all follow this split. Read-only inspection calls are
fresh reads rather than a cross-command snapshot. Mutation results expose only
the opaque identities, statuses, timestamps, counts, and bounded partial
progress required by the caller. The detailed CKB contracts are documented in
[Portable Candidate Knowledge Base](candidate-evidence.md#portable-candidate-knowledge-base) and are
canonical in [ADR 0007][adr-0007].

Archiving a CKB and other destructive or externally visible operations require
explicit confirmation. Adapter commands do not silently rewrite workspace
selection or broaden an approved source, URL, or provider scope.

### Provider and export boundary

Live provider execution is opt-in and the provider boundary enforces the
request data policy before the SDK call. Approved artifacts render locally to
Markdown, controlled DOCX, or controlled PDF; immutable export records retain
artifact/template versions, timestamp, format, MIME type, and checksum.

Additional artifact schemas, multilingual templates, portfolio ingestion, and a
local endpoint adapter reuse these boundaries at component level. They are not
integrated or outcome-validated merely because contracts and tests exist; the
[roadmap](../roadmap.md) records each evidence level.

The `pilot` CLI command uses synthetic local fixtures to exercise ingestion,
authoring, independent criticism, one bounded revision, approval, export,
typed local history, and audit events. Its report contains only safe counts and
identifiers. It validates workflow mechanics, not the quality hypothesis on
real applications.

[adr-0007]: ../adr/0007-portable-candidate-knowledge-store.md
