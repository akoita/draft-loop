# Architecture

DraftLoop is a local-first multi-model drafting and review workspace. The first
artifact is a job-specific CV, but the contracts are shaped around a reusable
workflow: canonical requirements and evidence produce an artifact, an
independent critic evaluates it, and a human approves the result.

## Boundaries

```mermaid
flowchart TB
    User([Candidate])

    subgraph Adapters["User-facing adapters"]
        direction LR
        CLI["CLI"]

        subgraph Desktop["Desktop · Electron trust boundary"]
            direction LR
            Renderer["React renderer<br/>bounded state projections"]
            Bridge["Preload NativeBridge<br/>frozen, allowlisted IPC"]
            Host["Electron main host<br/>native capabilities"]
            Renderer -->|"typed commands"| Bridge
            Bridge -->|"single IPC channel"| Host
        end
    end

    subgraph Application["Shared application boundary"]
        App["Application contracts<br/>commands · queries · use cases"]
    end

    subgraph Core["Provider-independent product core"]
        direction LR
        Orchestrator["Orchestrator<br/>author–critic loop · budgets · recovery"]
        Domain["Domain + schemas<br/>workflow state · boundary validation"]
        Knowledge["Ingestion + evidence<br/>normalized sources · provenance"]
        Quality["Validation + evaluations<br/>deterministic checks · rubric findings"]
        Artifacts["Artifacts + rendering<br/>approved structured output"]
        Orchestrator --> Domain
        Knowledge --> Domain
        Orchestrator --> Quality
        Orchestrator --> Artifacts
    end

    subgraph Infrastructure["Local and provider adapters"]
        direction LR
        WorkspaceStore[("Application workspace store<br/>SQLite · FTS/BM25 · run history")]
        CKBStore[("Portable CKB store<br/>managed raw blobs · source/version metadata")]
        Providers["Provider adapters<br/>data-policy enforcement"]
        Credentials["Credential store<br/>main-process owned"]
    end

    subgraph External["Explicit external boundaries"]
        direction LR
        Models["Anthropic + OpenAI<br/>or local compatible endpoint"]
        URL["User-approved URL fetch"]
        LocalFile["Application-approved<br/>single local file"]
        Export["Local Markdown · DOCX · PDF"]
    end

    User --> CLI
    User --> Renderer
    CLI --> App
    Host --> App
    App --> Orchestrator
    App --> Knowledge
    App --> WorkspaceStore
    Domain --> WorkspaceStore
    Knowledge --> WorkspaceStore
    App -->|"validated single-file managed intake"| CKBStore
    CKBStore -.->|"selection and retrieval pending"| Knowledge
    Orchestrator --> Providers
    Host --> Credentials
    Credentials -.->|"key lookup; never projected back"| Providers
    Providers -->|"approved transmission only"| Models
    Host -->|"validated request"| URL
    URL --> Knowledge
    LocalFile -->|"validated managed intake"| App
    Host -->|"approved artifact only"| Export

    classDef ui fill:#e8f1ff,stroke:#2563eb,color:#172554;
    classDef boundary fill:#eef2ff,stroke:#4f46e5,color:#1e1b4b;
    classDef core fill:#ecfdf5,stroke:#059669,color:#064e3b;
    classDef infra fill:#fff7ed,stroke:#ea580c,color:#7c2d12;
    classDef external fill:#f8fafc,stroke:#64748b,color:#0f172a;
    class CLI,Renderer ui;
    class Bridge,Host,App boundary;
    class Orchestrator,Domain,Knowledge,Quality,Artifacts core;
    class WorkspaceStore,CKBStore,Providers,Credentials infra;
    class Models,URL,LocalFile,Export external;
```

Solid arrows show application data or control flow. The dotted credential edge
is lookup-only: stored keys are never projected back into the renderer. External
network and export edges require the visible approvals described below. The
solid CKB edge is the explicit managed-intake command: approval covers one local
regular file, extraction succeeds before persistence, and the application
copies verified raw bytes into the portable store. The dotted CKB edge marks the
still-unintegrated workflow: application selection, retrieval, and provider use
have not crossed that boundary yet.

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
- The portable Candidate Knowledge Base store is a second local SQLite boundary,
  separate from every application workspace and its run history. Its persisted
  logical UUID identifies the store when its user-selected filesystem location
  changes. The current component stores CKB metadata, stable CKB-scoped source
  identity with file/URL kind and a sensitive local label, ordered immutable
  versions with SHA-256, media type, byte size, and timestamp, and managed raw
  bytes for one explicitly approved file. Intake accepts only a regular file of
  at most 20 MiB in the five ingestion-supported media types and persists
  nothing unless extraction succeeds. Raw bytes use an opaque, ID-derived local
  name with restrictive best-effort permissions; exact host paths and original
  filenames are not persisted as provenance or physical names, although a
  sensitive label may default to the basename. It does not drive retrieval or
  appear in CLI or desktop workflows. See
  [ADR 0007](adr/0007-portable-candidate-knowledge-store.md).
- Managed intake publishes verified bytes without replacement before committing
  their version-6 database marker. Committed markers always require matching
  regular-file bytes. Ordinary failures clean up; crashes or concurrency can
  leave unreferenced opaque files until explicit reconciliation is implemented.
- Managed blobs and SQLite metadata are plaintext. A source whose label resembles
  `AGENTS.md` or other configuration remains inert candidate data and never
  changes application instructions, policy, or permissions.
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
  explicit operations for application workspaces. They do not yet export,
  restore, or delete the separate CKB store, and a SQLite-only copy is not a
  complete CKB backup because it omits managed raw bytes. Their existence does
  not imply encrypted storage or validated disaster recovery on every platform.
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

| State               | Meaning                                                                                                               | Allowed next states                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `collecting`        | Workspace inputs are being assembled.                                                                                 | `ingesting`, `paused`, `stopped`                                                                                                                             |
| `ingesting`         | Selected local material is being normalized.                                                                          | `drafting`, `collecting`, `paused`, `stopped`                                                                                                                |
| `drafting`          | The configured author is creating a draft.                                                                            | `reviewing`, `paused`, `stopped`, `budget-exhausted`                                                                                                         |
| `reviewing`         | The independent critic is producing structured findings.                                                              | `revising`, `awaiting-approval`, `paused`, `stopped`, `budget-exhausted`                                                                                     |
| `revising`          | The author is addressing accepted findings.                                                                           | `reviewing`, `awaiting-approval`, `paused`, `stopped`, `budget-exhausted`                                                                                    |
| `provider-error`    | A provider request failed and safe provider, model, step, request-id, and attempt metadata is available for recovery. | The corresponding active step on explicit retry (at most three orchestration attempts), `awaiting-approval` when an artifact can return to review, `stopped` |
| `awaiting-approval` | Checks are complete and the user must decide.                                                                         | `approved`, `revising`, `paused`, `stopped`                                                                                                                  |
| `approved`          | The user approved the current artifact.                                                                               | `exported`, `revising`                                                                                                                                       |
| `exported`          | An approved artifact was rendered locally.                                                                            | —                                                                                                                                                            |
| `paused`            | The user temporarily suspended the run.                                                                               | `collecting`, `drafting`, `reviewing`, `revising`, `awaiting-approval`, `stopped`                                                                            |
| `stopped`           | The user ended the run.                                                                                               | —                                                                                                                                                            |
| `budget-exhausted`  | A round, cost, or time budget ended the loop.                                                                         | `awaiting-approval`, `revising`, `stopped`                                                                                                                   |

The loop should enter `awaiting-approval` when the readiness criteria are met,
quality is stable across configured consecutive rounds, or the user chooses to
review early. It must also enter that state after a budget is exhausted so the
user can inspect the best available artifact. It must not claim readiness when
high-severity factuality issues remain, critical job requirements are
unaddressed without an explicit gap, or a new unsupported claim was introduced.
`provider-error` remains distinct through the application and desktop boundaries.
The user may retry only a retryable failure below the orchestration limit, return
an existing artifact to review without deleting failure history, or stop. Each
provider-transmitting action must pass the current policy acknowledgement; a
retry does not silently broaden the acknowledged transmission scope.

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
beside an application-specific SQLite history file, ingests selected local
sources, constructs a context snapshot, and drives the orchestration engine.
That workspace and run history remain distinct from the portable CKB store.
The application contract can approve and copy one supported local regular file
into the store, but neither adapter yet provides the broader CKB create, open,
select, export, restore, or delete workflow. Directory and URL intake, refresh,
freshness, duplicate/index state, application selection, and retrieval cutover
are also pending; the current retrieval path still reads workspace-scoped
evidence. Offline fixture agents make the lifecycle testable without network
access. The desktop renderer uses the same
adapter-neutral review port through a capability-limited bridge; browser mode
has no filesystem or persistent
credential capabilities and retains only a deterministic fixture fallback.
Live provider execution is opt-in and the provider boundary enforces the request
data policy before the SDK call. Approved artifacts are rendered locally to
Markdown, controlled DOCX, or controlled PDF. Each renderer consumes the same
ordered structured artifact; the application records artifact version, template
version, timestamp, format, MIME type, and checksum in the immutable export
record.

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
