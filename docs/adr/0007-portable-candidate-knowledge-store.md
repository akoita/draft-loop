# ADR 0007: Keep candidate knowledge in a portable local store

- Status: Accepted
- Date: 2026-08-21
- Decision owners: DraftLoop maintainers

## Context

DraftLoop's application workspace contains evidence and retrieval data for one
job application. That is the right lifecycle for opportunity context, run
history, review decisions, and exports, but it is not durable candidate memory.
Copying that workspace between applications would make source identity,
freshness, deletion, and retrieval scope ambiguous.

The product therefore needs two local persistence boundaries:

1. an application workspace for one opportunity and its run history; and
2. a Candidate Knowledge Base (CKB) for reusable candidate material,
   independently of any application.

The CKB component establishes durable identity, immutable source/version
metadata, managed raw bytes, and narrowly approved local operations. It is
component-level work: CKB selection, retrieval, lifecycle integration, and
provider use are not yet connected to application runs.

## Decision

### Identity and boundaries

The CKB is a separate local SQLite store at a user-selected path. Its record
contains a schema version, logical UUID, and creation timestamp. The UUID—not
the filesystem path—is the durable store identity, so a user can relocate the
store without changing its identity. Open, copy, conflict, and restore rules
remain future policy; a UUID alone does not decide which copy is current.

The workspace remains separate. Its manifest, opportunity inputs, run
snapshots, review decisions, artifacts, exports, and SQLite history do not move
into the CKB. A workspace will eventually record an explicit CKB selection and
source-version scope, but the current implementation never reads a CKB
implicitly.

### Source and version model

A source has a stable logical ID scoped to one CKB, a `file` or `url` kind, and
a local display label. Each immutable, ordered version records:

- SHA-256 checksum, media type, byte size, creation time, and parent version;
- exact managed bytes under an opaque ID-derived name; and
- source identity that remains stable when a version or basename changes.

Checksums are integrity metadata and a possible duplicate signal, not source
identity. A read-only duplicate projection groups latest versions within one
CKB only when checksum, media type, and byte size all match. It returns
deterministically ordered source/version IDs and no checksum, path, label, URL,
content, or derived group identifier. The projection is recomputed and never
merges, removes, or prefers evidence.

Retirement is a separate immutable lifecycle fact. An explicit operation adds
the bounded reason `user-requested` for one active source. Retirement is
idempotent, blocks later version, rebind, and refresh-observation writes, and
preserves metadata, bytes, bindings, observations, and journal evidence. It is
not physical deletion, index cleanup, or reactivation; no reactivation operation
is defined by this decision.

### Approved local file and URL intake

Adding one local file is the approval boundary for that file. Intake accepts a
regular file of at most 20 MiB in exactly five supported media types: plain
text, Markdown, HTML, PDF, and DOCX. Extraction, content-quality, stable-file,
and managed-copy checks must succeed before any raw bytes or metadata are
persisted. A changed manual append creates the next immutable parent-linked
version; bytes identical to the current version are a no-op that does not
advance version time or imply freshness. A manual append path exists only for
that operation and never changes an existing origin binding.

Adding one URL is the approval boundary for that network fetch. It reuses the
existing controlled HTTPS ingestion boundary: no credentials or fragments,
public-address resolution, manual redirects, bounded timeout and response size,
supported text content, extraction-size, and usable-text checks. A successful
operation stores the exact fetched response bytes, not only normalized text.
The approved original URL, validated final redirect, fetch time, and bounded
URL kind are immutable sensitive provenance for that version. They are excluded
from generic manifests, descriptors, journals, inventory, diagnostics, errors,
and provider requests. Re-adding a URL creates a separate source; the duplicate
projection remains only a signal.

URL refresh is a separate explicit approval for one later fetch of the stored
original URL. It rejects an archived, mismatched, non-URL, or retired source
before network access and repeats the intake checks. Changed response bytes
become a parent-linked version with new redirect provenance. Identical bytes,
including redirect-only drift, are a current no-op and do not add provenance or
advance a refresh-success time. A valid approved fetch or extraction failure
records only a URL-free `inaccessible` observation. These records describe an
explicit attempt, not background or time-based freshness.

### Origins and refresh

A successful managed file create remembers the canonical path from its verified
capture in a sensitive local-only origin-binding table. Existing sources from
before that binding have no origin. The binding is copied with the database but
is not portable continuity: it may become stale when the store or origin moves
or disappears, is never provider-facing, and is never included in generic
projections. Manual append paths never replace it.

An explicit read-only origin check returns the source identity, observation time,
and one of `unbound`, `current`, `changed`, `missing`, or `inaccessible`. It
returns no path, checksum, media type, size, label, or content and persists no
observation. `current` means only that the bytes matched the latest version at
that point in time.

An explicit refresh follows the remembered path, repeats no-follow stable-file,
supported-media, extraction, and managed-copy checks, and appends only changed
bytes. Current, unbound, missing, inaccessible, and substituted-symlink origins
create no version. Refresh never changes the binding. It persists a path-free
observation tied to the exact version examined; a later version advance derives
`stale` until another explicit refresh. This is last-observation evidence, not a
watcher or freshness TTL.

An explicit rebind accepts one newly selected path only for the duration of the
operation. It repeats no-follow ingestion and stable capture, then replaces the
sensitive binding only when media type, checksum, and size exactly match the
latest managed version. It publishes no blob or version, creates no managed
write journal event, retains no superseded path history, and returns only source
identity, `current`/`rebound` status, and binding time. Different bytes must
first be appended explicitly.

### Directories and member lifecycle

Directory intake is a bounded selector over ordinary managed file sources; it
does not create a directory source kind. The selected root must be a real
non-symlink directory outside the CKB store. The complete traversal is
preflighted before writes, in lexical normalized-relative-path order, with:

| Limit or rule  | Contract                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traversal      | Maximum depth 32 and 1,024 scanned entries                                                                                                         |
| Accepted input | At most 256 files and 256 MiB aggregate bytes; each file retains the 20 MiB limit and five-media-type intake gate                                  |
| Skips          | Dot-prefixed entries/subtrees, unsupported files, special entries, and child symlinks are skipped and counted; symlinks are never followed         |
| Persistence    | Each accepted file becomes an independent managed `file` source; a complete import then records one sensitive canonical root and immutable members |
| Membership     | Each member stores only a SHA-256 hash of its normalized relative path, never plaintext relative paths                                             |

Partial and legacy runtime-only imports have no directory membership evidence.
The root and exact file origins remain sensitive local state. Membership is a
historical mapping captured at binding or explicit append time; later source
versioning, explicit origin rebind, and retirement do not rewrite it.

The explicit operations are intentionally separate:

| Operation               | Contract and result                                                                                                                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh preview         | One bounded revalidation reports path-free `current`, `changed`, `missing`, `retired`, or `origin-conflict` member states plus unmatched-file count; it writes nothing.                                                                                                                                                          |
| Add members             | A complete scan of an existing binding appends unmatched accepted files in lexical order. Each candidate commits its source, version, origin binding, managed bytes, journal event, and immutable member atomically; a later failure returns path-free partial IDs.                                                              |
| Observation             | One complete scan records path-free current/changed/same-member-missing observations with one timestamp. It allocates no IDs and writes no bytes, versions, membership, bindings, retirements, or journal events.                                                                                                                |
| Applied refresh         | Existing active same-member changed files are processed in source-ID order through the managed append path. Current observations are recorded for successful changed/current/missing members; a later failure returns a path-free partial result. New files, conflicts, and retired members remain report-only.                  |
| Member retirement       | A fresh bounded scan may approve one active same-member `missing` source. The existing `user-requested` retirement marker is written with latest-version, origin-revision, and chronology guards; `removed` is logical only and an already retired member returns `already-removed`.                                             |
| Root rebind             | A read-only eligibility scan requires exact historical membership and latest-byte agreement for every member. The application command reuses that scan, performs final stable verification, and atomically updates all origins plus the next root revision, returning path-free `rebound` counts or `current` for the same root. |
| Moved-candidate preview | The scan compares exact media type, checksum, and size between eligible same-member missing sources and unmatched files. Only unique one-to-one source IDs are returned; ambiguous matches are omitted and no state changes.                                                                                                     |
| One-source member move  | The explicit #134 command reuses exactly one bounded scan for one selected source, accepts no target path, and forwards either the scanned current member for idempotency or one unique exact-integrity missing-member match through the verified member handle.                                                                 |

The one-source move returns a frozen, path-free result containing directory/source
identity, the shared check time, and `moved` or `current` status. It appends one
member revision or performs a guarded no-op without changing source identity,
version, observation, retirement, blob, journal, or baseline membership
evidence. The match is runtime-only; paths and integrity tuples are not
returned. Append-only root and member revisions preserve historical roots and
membership hashes while current views expose the latest verified state.

Complete reconciliation, applied rename inference, broader member lifecycle,
automatic move inference, physical deletion, adapter controls, indexing, and
background refresh remain deferred under #135/#136. The bounded explicit move
does not imply automatic discovery or full reconciliation.

### Managed publication and journal

Managed bytes are staged and verified before no-replace publication. The opaque
file is published first and the database marker second; a committed marker is
valid only while the referenced regular file matches checksum and size. Ordinary
failures clean up staging or newly published bytes. A crash or concurrent loser
may leave an unreferenced opaque entry, but its shape or matching bytes do not
authenticate DraftLoop ownership.

The prospective append-only journal records an opaque intent before staging,
resolved target before publication, publication, atomic managed-marker/database
commit, and completion after staging cleanup. It contains no origin paths,
filenames, labels, checksums, source content, provider data, diagnostics,
cleanup tokens, approvals, or externally visible IDs. Legacy and unjournaled
entries remain unknown. Same-current-byte appends record a terminal non-owning
no-op; a metadata-only version may be materialized through normal managed-copy
checks, but an unowned file is never adopted because its bytes or shape match.

The journal is evidence for a future cleanup policy, not cleanup authority. This
decision does not delete, adopt, quarantine, repair, reconcile, or automatically
scan entries, coordinate writers with locks/leases, or provide approval UI.
Future cleanup requires writer coordination and explicit visible approval.

### Compact schema-evolution summary

The current invariants are represented by the following schema boundaries. This
summary explains the durable shape; it is not a migration diary.

| Schema | Durable boundary                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| v6     | Managed-object markers bind immutable source versions to verified opaque bytes.                                                   |
| v7     | Prospective managed-write journal records ownership evidence for new writes.                                                      |
| v8–v9  | File-only origin bindings are inserted with managed creates and replaced only by a guarded exact-byte rebind.                     |
| v10    | Path-free refresh observations bind an outcome to an exact source/version; `stale` is derived after a later version.              |
| v11    | Immutable CKB-scoped logical retirement uses only `user-requested` and does not erase evidence.                                   |
| v12    | Managed URL versions and immutable URL provenance share the opaque-byte contract while bindings remain file-only.                 |
| v13    | Complete directory imports add sensitive root bindings and immutable hashed member rows without backfilling runtime-only imports. |
| v14    | Append-only directory-root revisions reserve historical roots and provide a guarded current-root view.                            |
| v15    | Append-only per-member revisions preserve baseline membership and make one-source verified moves independently auditable.         |

Changing an immutable v13 row or adding a no-backfill overlay was rejected: it
would erase baseline evidence or leave legacy members without a trustworthy
revision. The v14/v15 append-only boundaries preserve source identity, root
history, member history, and guarded no-op semantics.

## Privacy and security invariants

The store is local and plaintext. Restrictive filesystem permissions are
best-effort, not encryption, and do not protect against another process running
as the same user. The user controls the selected location and copies made
outside DraftLoop.

Filesystem paths are host configuration, not portable product data. The selected
store path, exact file origins, and directory root remain outside the portable
descriptor, manifests, journals, inventory, diagnostics, application
projections, and provider requests. A UI may show a local path to the user, but
it must not treat that path as candidate evidence or transmit it to a model.

Source labels, URLs, and checksums can correlate known content, so they are not
content-free diagnostic or provider data. URL provenance exists only in the
sensitive local per-version table. Managed source bytes are inert candidate
data: a source named `AGENTS.md`, `.env`, or another configuration-like file
never changes application instructions, provider policy, permissions, or
executable configuration. Original filenames are not used in the managed
layout.

An inventory query is explicit, bounded, and count-only after normal referenced
blob validation. It may count verified managed files, scanned entries,
staging-shaped and other opaque entries, extra entries under expected managed
directories, symlinks, special entries, and completion/limit status. It never
returns names, paths, IDs, labels, checksums, or bytes; it follows no unknown
symlinks, recurses into unknown directories, reads unknown file bytes, or
mutates state. Structural shape and prospective journal evidence do not prove
ownership and do not authorize adoption or cleanup.

## Deferred integration

This decision deliberately leaves the following outside the product workflow:

- normalized facts and lexical, vector, or hybrid CKB indexes;
- application and run CKB selection, source-version scope, and provider
  transmission approval;
- CLI and desktop CKB creation, opening, selection, and lifecycle controls;
- complete directory removal/rename reconciliation, automatic move inference,
  broader member-retirement policy, background refresh, and time-based
  readiness;
- automatic duplicate preference or merging, source reactivation, and physical
  deletion;
- missing/corrupt blob repair, writer locks or leases, cleanup approval, and
  reconciliation of unknown entries;
- CKB deletion semantics and complete portable export, backup, restore,
  conflict handling, or migration rollback; and
- URL redirect history, conditional requests, and URL-specific failure policy.

Until those contracts are integrated and validated, workspace-scoped evidence
and retrieval remain authoritative for application runs. The presence of a CKB
record must not make a run read from it implicitly.

## Alternatives considered

- **Keep reusable knowledge in every workspace.** Rejected because copies
  diverge, deletion and freshness become ambiguous, and isolated selection is
  difficult to express reliably.
- **Use an application-wide path as identity.** Rejected because paths are
  machine-specific, expose local structure, and change when a store moves.
- **Put run history in the portable store.** Rejected because opportunity and
  provider history have different privacy, retention, and backup lifecycles.
- **Keep the store metadata-only until full lifecycle exists.** Rejected because
  approved immutable file and URL snapshots can establish byte provenance
  without claiming refresh, retrieval, deletion, or backup readiness.
- **Use cloud storage or remote vectors now.** Rejected because accounts,
  authentication, remote retention, and provider exposure would expand the
  local-first boundary before the local workflow is validated.

## Consequences

- A CKB has stable logical identity independent of its local path, while
  workspace history and candidate memory retain separate lifecycles.
- Approved file and URL bytes can be retained immutably and changed bytes can
  be appended without changing source identity. Origins and refresh remain
  explicit and local; no watcher is implied.
- Bounded directory intake can create independent sources and preserve hashed
  historical membership. Explicit root rebind and one-source member move
  provide verified recovery without inferring renames or removals.
- Prospective journal events provide evidence for new managed writes without
  claiming legacy or unjournaled entries. Unknown opaque files cannot be
  cleaned up safely yet.
- Deleting a workspace does not delete the CKB, and deleting an original host
  file does not delete its managed copy. A SQLite-only copy is not a complete
  CKB backup.
- Retrieval and provider use continue to read workspace-scoped evidence until
  selection, isolation, lifecycle, and privacy contracts are integrated.

## Follow-up

- Define explicit application-to-CKB selection and fail-closed retrieval
  isolation before CKB data enters a run.
- Define deletion coverage for raw, normalized, indexed, cached, historical,
  exported, and backed-up data.
- Define writer coordination and visible approval before reconciliation can act
  on prospective journal evidence; unjournaled entries remain unknown.
- Add CLI and desktop approval surfaces only after those contracts have focused
  tests and provider-preflight integration.
- Revisit the architecture and threat model before enabling retrieval cutover,
  lifecycle reconciliation, export/restore, or provider use.
