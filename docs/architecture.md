# Architecture

DraftLoop is a local-first, multi-model drafting and review workspace. The
first artifact is a job-specific CV, but the contracts are shaped around a
reusable workflow: canonical requirements and evidence produce an artifact,
an independent critic evaluates it, and a human approves the result.

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
        CKBStore[("Portable CKB store<br/>raw blobs · metadata · local origins · journal")]
        Providers["Provider adapters<br/>data-policy enforcement"]
        Credentials["Credential store<br/>main-process owned"]
    end

    subgraph External["Explicit external boundaries"]
        direction LR
        Models["Anthropic + OpenAI<br/>or local compatible endpoint"]
        URL["User-approved URL fetch"]
        LocalFile["Application-approved<br/>single local file or bounded directory"]
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
    App -->|"explicit CKB commands"| CKBStore
    CKBStore -.->|"selection snapshot bound; retrieval pending"| Knowledge
    Orchestrator --> Providers
    Host --> Credentials
    Credentials -.->|"key lookup; never projected back"| Providers
    Providers -->|"approved transmission only"| Models
    Host -->|"validated request"| URL
    URL --> Knowledge
    LocalFile -->|"explicit approved add or bounded intake"| App
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
is lookup-only: stored keys are never projected to the renderer. Network and
export edges require visible approval. The solid CKB edge covers the explicit
file, URL, and bounded-directory commands described below. The dotted edge
marks the path-free selection evidence now bound to new run contexts; CKB
content retrieval remains unintegrated.

The renderer receives bounded projections for workspace and run state. Native
dialogs, workspace paths, SQLite handles, credential persistence, provider SDK
construction, URL fetching, and export writes remain in the main process. The
renderer can submit an API key only through the allowlisted credential command;
the host validates it and owns encryption, status, removal, and environment
fallback. Browser mode has no native filesystem or persistent credential
capabilities and keeps a deterministic fixture fallback. See [ADR
0004](adr/0004-desktop-credential-boundary.md).

## Package and data ownership

| Boundary                                         | Owns                                                                                               | Does not own                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/domain` and `packages/schemas`         | Framework-free concepts, workflow states, and Zod validation at persistence/exchange boundaries    | Provider SDKs, storage engines, or UI frameworks                     |
| `packages/ingestion` and `packages/evidence`     | Approved local/URL intake, extraction, normalized material, provenance, and source references      | Application selection or provider transport                          |
| `packages/orchestrator`                          | Author–critic sequencing, budgets, pause/stop, recovery, and user-visible run events through ports | Provider-specific SDK calls                                          |
| `packages/validation` and `packages/evaluations` | Deterministic checks, rubric findings, and structured critique records                             | Proof of truth independent of candidate evidence and human decisions |
| `packages/artifacts` and `packages/rendering`    | Approved structured output and local Markdown/DOCX/PDF rendering                                   | Submission or publishing                                             |
| `packages/storage`                               | Workspace history and portable CKB persistence, including managed bytes and local-only state       | CKB selection, retrieval policy, or UI                               |
| `packages/providers`                             | Provider identity, SDK translation, policy enforcement, and model calls                            | Domain workflow decisions                                            |
| `packages/application`, CLI, and desktop host    | Adapter-neutral use cases and shared user-facing contracts                                         | A second domain layer or provider SDKs in the UI                     |

Retrieval is workspace-scoped behind a provider-independent port. SQLite
FTS/BM25 is the integrated lexical baseline and supplies selected chunks to live
author and critic requests. Local vector and hybrid implementations remain
evaluation components until deletion, retention, isolation, provenance, and
quality are validated for the product path.

## Portable Candidate Knowledge Base

### Workspace versus portable CKB

An application workspace contains opportunity context, run snapshots, review
decisions, artifacts, exports, and application-specific SQLite history. A
portable CKB is a separate local SQLite store for reusable candidate material.
The CKB has a logical UUID independent of its selected filesystem path. A
workspace does not implicitly read CKB content. Its local manifest may bind
explicitly named CKBs by runtime store root and pinned logical store/CKB IDs.

Before each new run, the shared application boundary reopens those stores,
checks their logical identities and lifecycle readiness, and embeds a freshly
canonicalized, path-free selection snapshot in the immutable run context.
Existing runs continue to use the snapshot they originally recorded. Before a
provider-capable start, resume, or revision transition, the application reopens
the current local binding and compares its complete canonical entries with that
record. Missing, replaced, unready, or changed evidence fails with a path-free
review-required error before provider execution or run-state mutation.

The portable store is local and plaintext. Restrictive filesystem permissions
are best-effort and are not encryption or protection from another process run
by the same user. A SQLite-only copy is not a complete CKB backup because raw
managed bytes live beneath the store's opaque `sources/` layout.

### Source and version model

A source has a stable CKB-scoped logical ID, a `file` or `url` kind, and a local
label. An immutable ordered version records SHA-256, media type, byte size,
creation time, and parent lineage. Checksums are integrity metadata and a
duplicate signal, not source identity. A read-only duplicate projection emits
only deterministic source/version IDs; it does not merge, prefer, or remove
evidence.

Approved local files are regular files no larger than 20 MiB in the five
supported media types: plain text, Markdown, HTML, PDF, and DOCX. Extraction,
stable-file, and managed-copy checks must succeed before persistence. The store
copies exact bytes under an opaque ID-derived name. A changed append creates
the next parent-linked version; identical current bytes are a no-op and do not
advance time or imply freshness.

Approved URL intake reuses the HTTPS-only boundary, including public-address
resolution, manual redirects, response and extraction limits, and usable-text
checks. It stores exact response bytes and sensitive per-version provenance for
the approved original URL, validated final redirect, fetch time, and bounded
URL kind. URL refresh is explicit, reuses only the stored original URL, and
records changed bytes as a new version. Redirect-only drift is a no-op; failures
after approved preflight record only a URL-free inaccessible observation.

### Origins, refresh, and lifecycle

A successful managed file create may remember its canonical verified origin path
in a sensitive local-only binding table. Manual append paths are runtime-only;
they never replace the binding. An explicit status check returns only
`unbound`, `current`, `changed`, `missing`, or `inaccessible`, without the path
or observed file metadata. Explicit refresh can append changed bytes from the
remembered origin and records a path-free observation tied to the examined
version. Explicit rebind replaces only the sensitive path after an exact
media-type, checksum, and size match with the latest version. None of these
operations runs in the background or exposes an origin to a provider.

Retirement is an immutable logical `user-requested` marker. It blocks later
version, rebind, and refresh-observation writes while preserving source/version
metadata, managed bytes, bindings, observations, and journal evidence. It is
not physical deletion, index cleanup, or reactivation.

Lifecycle readiness is a CKB-scoped read projection over one consistent SQLite
snapshot. Each source exposes its latest version identity, `ready` or `blocked`
state, bounded reasons, and a structured revision containing only safe IDs,
timestamps, booleans, and numeric current-directory revisions. The revision
changes when eligibility-relevant persisted evidence changes. Labels, paths,
URLs, relative-path hashes, content checksums, media types, sizes, and bytes are
excluded. Fresh intake is eligible without a refresh observation; adverse or
stale observations block without creating a TTL or live-filesystem claim.

### Selection snapshot contract

An explicit application selection produces an immutable schema-versioned
snapshot containing the portable store ID, CKB ID, exact selected source and
version IDs, and each source's safe structured lifecycle revision. A single CKB
needs no additional combination approval; selecting more than one requires an
explicit approval before any store is opened. Archived, empty, or blocked CKBs
fail closed.

Entries and sources are canonicalized in lexical order. The snapshot excludes
store roots, display labels, paths, filenames, URLs, hashes, checksums, media
types, byte sizes, and content. It can be embedded in an immutable context
snapshot without breaking older context records that predate the optional
field. The local workspace binding retains runtime roots only so future runs can
revalidate the pinned identities; descriptors, context snapshots, run history,
diagnostics, and provider requests expose only the path-free record. The record
does not authorize provider transmission or establish retrieval-index
freshness.

### Directory and member lifecycle

Directory intake is a bounded selector over ordinary managed file sources, not
a directory source kind. The selected root must be a real non-symlink directory
outside the CKB store. Traversal is deterministic by lexical relative path and
preflights extraction before writes. Limits are depth 32, 1,024 scanned entries,
256 accepted files, 256 MiB aggregate accepted bytes, and the 20 MiB per-file
limit. Dot-prefixed entries/subtrees, unsupported files, special entries, and
child symlinks are skipped and counted. A complete import records a sensitive
root binding and immutable SHA-256 hashes of normalized relative member paths.

The current bounded operations are summarized here; their full contract and
privacy invariants are canonical in [ADR 0007][adr-0007].

| Operation                     | Scope and result                                                                                                                                           | Writes                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Inventory and refresh preview | Count-only store inventory; path-free member states (`current`, `changed`, `missing`, `retired`, `origin-conflict`) and unmatched-file count               | None                                                                                                            |
| Add members                   | Confirm and append unmatched accepted files as independent sources in lexical order through shared CLI/desktop controls                                    | Each candidate's source, version, origin binding, managed bytes, journal event, and immutable member atomically |
| Observation / applied refresh | Record path-free observations, or append changed bytes for existing active same-member files in source-ID order                                            | Observation batch is atomic; applied refresh may return path-free partial progress after a later member failure |
| Member retirement             | Approve one active same-member `missing` member with root/member/version/origin guards                                                                    | Existing immutable `user-requested` retirement marker only; bytes and membership remain                         |
| Root rebind                   | Reuse one complete scan, verify every historical member, and update all origins                                                                            | Guarded append-only root revision with path-free `rebound` counts, or path-free `current` no-op                 |
| Moved-candidate preview       | Compare exact media type, checksum, and size for same-member missing sources and unmatched files                                                           | None; ambiguous matches are omitted                                                                             |
| One-source member move        | Reuse exactly one bounded scan for one selected source; accept a unique exact-integrity missing-member match or the scanned current member for idempotency | Verified append-only member revision, or guarded no-op; result is frozen, path-free `moved`/`current`           |
| Missing-member reconciliation | Partition one complete scan into path-free current, changed, moved-candidate, missing, already-retired, conflicted, and unmatched/new state; apply only explicitly selected retirements in source-ID order | Each retirement marker is atomic; all-success returns `applied`/`current`, while a later failure returns frozen path-free partial IDs |

The explicit move command accepts no target path. It forwards a runtime-only
match through the verified member handle and does not change source identity,
version, observation, retirement, blob, journal, or baseline membership
evidence. Root rebind and one-source member move are exposed through shared
CLI and desktop adapters; moved-candidate preview is read-only, while move
requires confirmation and returns only opaque identity, time, and status.
Neither infers renames automatically or reconciles all removals.

Automatic move inference, physical deletion,
indexing, and background refresh remain deferred under their owning roadmap
issues.
Historical membership is not rewritten by later source versions, explicit
origin rebinds, retirement, or readiness projection.

### Managed publication and journal

Managed publication verifies bytes before committing metadata. The database
marker and opaque file must agree on checksum and size; publication is
no-replace, file first, database second. Crashes or concurrent losers may leave
unreferenced opaque entries, but shape or matching bytes do not authenticate
DraftLoop ownership.

The append-only journal records opaque intent, target resolution, publication,
managed-marker/database commit, and completion for new managed writes. Versioned
ownership, expected integrity, immutable staging-file identity, and
writer-generation fields remain sensitive local state. Recovery first records a
durable claim with its newer generation, which fences stale journal and commit
transactions before artifact inspection and remains retryable after cleanup
failure. These fields authorize only deterministic restart recovery of that exact
operation and never cross application or provider boundaries. Legacy,
unjournaled, mismatched, and unrecognized entries remain unknown and untouched.

All current CKB mutation commands use one store-wide exclusive writer lease.
Its private SQLite coordinator is separate from the replaceable CKB data
database and records only scope, opaque ownership, a safe operation code,
timestamps, and a monotonically increasing fencing generation. Heartbeat,
atomic stale takeover, nested fencing checks, and owner-generation-guarded
release prevent concurrent commands from interleaving. Conflict diagnostics
identify only the active operation and scope; they never include roots, paths,
source identity, or content. Reads remain unleased. Store opening uses the same
lease to roll back verified incomplete publication or finish verified committed
cleanup, with idempotent path-free reports.

The CKB retention contract enumerates raw sources, normalized facts, indexes,
run snapshots, exports, and backups. All six default to retention until explicit
deletion. Append-only policy revisions may set bounded day-based expiry, while
append-only legal-hold and manual-preservation events override expiry. Plans are
keyed by policy revision, override revision, and an explicit evaluation time.
They expose only bounded counts and effective states. Current ownership proof
can mark committed managed raw-source versions eligible; unmanaged, unknown,
and not-yet-materialized classes remain preserved. Planning never deletes data.

Portable backup export holds the same store-wide lease while it builds a
versioned directory package outside the source store. The package contains a
strict logical manifest plus checksum-addressed managed source objects; it
fails closed when ownership inventory is incomplete or a required managed
version cannot be verified. Machine-local origins, directory roots, writer
coordination, recovery journals, application/provider credentials, and
unrelated workspace data are not exported. A manifest checksum and per-object
hashes detect corruption or modification but do not authenticate who created a
package. Export requires an explicit destination approval and publishes with no
replacement only after the package passes its own inspector.

Portable restore repeats complete package inspection before any destination
write, imports into a fully staged v20 store, validates the restored graph and
managed bytes, and then publishes to an approved new directory without replacing
an existing entry. The only supported collision decision is
`fail-if-destination-exists`; restore never merges stores, renames logical
identities, or claims continuity with the exporting host. Restored URL evidence
keeps only its safe fetched-at and kind fields. Original URLs and all file and
directory bindings remain absent. Confirmed deletion remains owned by #166.

The package deliberately represents every restored source as unbound. It does
not preserve directory-root/member relationships or host-binding history, and
a valid legacy store containing unmanaged source versions cannot be described
as a complete package, so export refuses it rather than silently omitting
provenance.

The schema currently preserves append-only source/version, origin, observation,
retirement, URL, restored path-free URL provenance, directory-root, and
directory-member history. [ADR 0007][adr-0007] records the compact v6–v20
schema-evolution summary and the invariants that
motivated each boundary.

### CKB integration gap

The CKB does not yet provide normalized facts, lexical/vector/hybrid indexes,
retrieval-index drift enforcement, provider transmission scope, complete
CLI/desktop lifecycle controls, missing-blob repair, physical deletion, or cleanup.
Until those contracts are
integrated and validated, the workspace-scoped evidence and retrieval path
remains authoritative for application runs.

## Evidence-grounded evaluator–optimizer

DraftLoop applies the evaluator–optimizer pattern to a factual, evidence-backed
workflow. The author is the optimizer's generator, the independent critic is
the evaluator, and each revision is a bounded optimization step against a
visible rubric. The product uses author–critic language in the UI because it is
clearer to candidates.

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

The rubric covers factuality, evidence support, requirement coverage, and
quality. Deterministic validators handle checks that do not need a model.
Findings are structured, actionable, severity-rated, and linked to claims,
sections, or source locators where possible. A critic can identify a problem
but cannot establish truth by itself; user evidence and human decisions remain
authoritative.

The default author and critic use different companies, with provider and model
versions recorded in run history. The orchestrator stops at configured round,
cost, or time limits, when quality is stable, or when the user reviews early.
It never loops indefinitely to optimize a subjective score. See [ADR
0003](adr/0003-evidence-grounded-evaluator-optimizer.md).

## Author–critic loop

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

## Trust and privacy controls

The system keeps evidence links, structured findings, approved artifact
versions, revisions, decisions, provider/model identity, usage, and checksums
recoverable without storing hidden chain-of-thought. Raw prompts and raw
provider responses are not operational-log or audit payloads. Provider calls
require an explicit data policy, and local retention settings are visible per
workspace. Human approval is mandatory; job discovery, application submission,
and uncontrolled external research are outside the MVP.

See [the threat model](threat-model.md) and [privacy and evaluation
policy](privacy-and-evaluation.md) for current trust boundaries, redaction
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

Store setup, selection, inspection, intake, refresh, rebind, retirement, and
directory maintenance all follow this split. Read-only inspection calls are
fresh reads rather than a cross-command snapshot. Mutation results expose only
the opaque identities, statuses, timestamps, counts, and bounded partial
progress required by the caller. The detailed CKB contracts are documented in
[Portable Candidate Knowledge Base](#portable-candidate-knowledge-base) and are
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
[roadmap](roadmap.md) records each evidence level.

The `pilot` CLI command uses synthetic local fixtures to exercise ingestion,
authoring, independent criticism, one bounded revision, approval, export,
typed local history, and audit events. Its report contains only safe counts and
identifiers. It validates workflow mechanics, not the quality hypothesis on
real applications.

[adr-0007]: adr/0007-portable-candidate-knowledge-store.md
