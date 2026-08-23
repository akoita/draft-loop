# ADR 0007: Keep candidate knowledge in a portable local store

- Status: Accepted
- Date: 2026-08-21
- Decision owners: DraftLoop maintainers

## Context

DraftLoop currently keeps candidate evidence and retrieval data inside an
application workspace. That boundary is useful for one job application, but it
does not provide durable candidate memory that can be selected across multiple
applications. Treating a workspace path as candidate identity would also make a
move or copy look like a different knowledge base and would couple reusable
career material to run history that has a different lifecycle.

The application therefore needs two local persistence boundaries:

1. an application workspace, containing opportunity context, run history,
   review decisions, and exports for one application; and
2. a candidate knowledge store, containing reusable CKB data independently of
   any application.

The portable-store component establishes the second boundary's identity and
SQLite lifecycle metadata. Its managed-file slices copy an explicitly approved
local file into the store, bind those immutable bytes to a stable CKB-scoped
source version, and expose storage's existing managed-version append through an
explicit application operation. A further application query provides bounded,
count-only structural inventory of the managed `sources/` namespace, and a
read-only origin check provides an ephemeral status without projecting the
remembered path. A separate explicit refresh can append changed bytes from that
binding without exposing or replacing it. An explicit rebind can replace only
that sensitive local path after a newly selected regular file passes the same
ingestion and stable-capture checks and exactly matches the latest managed
version. Managed creates, appends, and changed-byte refreshes have prospective
write provenance in an internal append-only journal. Rebind writes only the
guarded local binding and creates no managed-write event. A separate immutable
marker can logically retire a source without deleting any of that evidence.
An approved URL intake operation uses the existing bounded HTTPS fetch boundary,
then publishes the exact fetched response bytes under the same opaque layout and
atomically records immutable per-version URL provenance.
The first bounded recursive directory-intake component now reuses the local-file
boundary. It preflights a real directory in deterministic lexical order, skips
and counts dot-prefixed, unsupported, special, and child-symlink entries, and
creates each accepted file as an independent managed file source. A complete
import also persists a sensitive local-only canonical root binding and immutable
membership rows containing only SHA-256 hashes of normalized relative paths; it
does not create a directory source kind. Partial imports and legacy runtime-only
imports have no directory binding or membership evidence. An explicit
add-members operation can append unmatched accepted files from an existing
binding as new managed file sources and immutable members in deterministic path
order; existing member states remain report-only and a later candidate failure
returns a path-free partial result. Applied refresh is limited to existing
active same-member changed files; complete removal reconciliation, rename, and
broader member-retirement policy remain deferred. The membership is a stable historical
mapping captured at binding or explicit append time: later source version
appends, explicit origin rebinding, or source retirement do not rewrite its
rows, and actual incremental scan reconciliation remains deferred.
A bounded explicit refresh preview now revalidates that persisted root, repeats
the directory preflight, and reports only path-free member states plus an
aggregate count of unmatched accepted files. It is read-only; the separate
explicit add-members operation owns append-only persistence for those unmatched
files. Rename/removal decisions, automatic retirement/deletion, and background
refresh remain deferred. A separate
read-only directory-root-rebind eligibility preview accepts a candidate real
non-symlink root, rescans it once, and requires exact historical relative-path
membership plus latest-byte agreement. It returns only a path-free
readiness/count result and performs no writes. An explicit application command
now reuses that single scan and performs stable per-member final verification
before the guarded storage transaction; it returns only frozen path-free
`current` or `rebound` status and counts, with no partial result.
A separate read-only moved-candidate preview reuses one complete refresh scan
and compares only exact media-type, checksum, and size tuples between eligible
same-member missing sources and unmatched accepted files. It emits only unique
one-to-one advisory source IDs in deterministic order; ambiguous tuples emit
nothing, and its unchanged aggregate `newSourceCount` still includes every
unmatched accepted file. It is not proof or approval of a move; applied rename,
membership revision, root rebind, and complete reconciliation remain deferred.
These operations do not connect CKB selection or retrieval to an application
workflow.

## Decision

DraftLoop represents a candidate knowledge store as a separate local SQLite
store at a path selected by the user. The persisted store record has a schema
version, a logical UUID, and a creation timestamp. The UUID, not the filesystem
path, is the durable identity. A user can therefore relocate the store without
changing its identity, subject to later open and conflict checks.

Application workspaces remain separate. Their manifests, opportunity inputs,
run snapshots, review decisions, artifacts, exports, and SQLite history are not
moved into the CKB store. A workspace will eventually record an explicit CKB
selection, but the current slice does not implement that relationship.

A source has a stable logical ID scoped to one CKB, a file or URL kind, and a
local user-visible label. Each immutable, ordered source version records a
SHA-256 checksum, media type, byte size, and creation timestamp. A checksum is
version integrity metadata and a possible duplicate signal, not source identity.
An explicit read-only application projection groups two or more sources within
one CKB only when their latest versions share checksum, media type, and byte
size. It returns deterministically ordered source/version IDs but no checksum,
label, path, URL, content, or derived group identifier. The relationship is
recomputed on every query, so a later version can create or remove a group. It
is neither persisted history nor authority to merge, remove, or prefer a source.

Source retirement is a separate lifecycle fact. An explicit application
operation records one immutable, CKB-scoped marker with the bounded reason
`user-requested`; absence of a marker means active. Retirement is idempotent
for the same marker and blocks later version appends, origin rebinding, and
refresh-observation writes. Existing source/version metadata, managed bytes,
origin binding, and refresh observation remain readable and unchanged. The
marker is neither physical deletion nor index-cleanup authority, and it does
not collapse lifecycle into refresh freshness. This slice deliberately provides
no reactivation operation: selection/index invalidation, retention, backup, and
restore policy must be defined before restoration can claim readiness again.

The application command to add one URL is the approval boundary for that one
network fetch. It requires `approved: true` and reuses ingestion's HTTPS-only,
no-credential/no-fragment, public-address resolution, manual redirect,
timeout, response-size, supported text-content, extraction-size, and usable-text
checks. Successful intake generates a stable source identity only after fetch
and extraction succeed. It copies the exact fetched response bytes—not only the
normalized text—so the immutable version checksum and byte size continue to
describe the stored material. Re-adding the same URL creates a separate source;
the existing exact-integrity duplicate projection remains only a signal.

The approved original URL, validated final redirect URL, fetch time, and bounded
URL kind are immutable sensitive local provenance for that exact source version.
They do not enter generic manifests, descriptors, journals, inventory,
diagnostics, errors, or provider requests. Redirects therefore remain historical
provenance and never silently rebind source identity.

A separate explicit URL-refresh command is the approval boundary for one later
fetch of the immutable stored original URL. It accepts no replacement URL and
rejects an archived or mismatched CKB, a non-URL or retired source, and malformed
latest provenance before the network boundary. Fetch, redirect, response-size,
content-type, extraction, and usable-text checks remain identical to intake.
Changed response bytes become the next immutable parent-linked version with the
new validated final URL and fetch time; storage rechecks lifecycle state and
commits exact bytes, the managed marker, per-version URL provenance, and journal
state atomically. Identical integrity metadata is a current no-op, including a
redirect-only change, so it creates no version or provenance row and does not
advance last-successful-refresh state. Redirect observation history is a
separate deferred policy rather than metadata-only source versioning.

After a valid approved preflight, a fetch or extraction failure persists only a
path- and URL-free `inaccessible` observation against the examined version.
Approval and preflight failures fetch nothing and write no observation. These
records are evidence of one explicit attempt, not background or time-based
freshness. A retirement race after preflight may perform the approved fetch but
must fail closed before any version or observation write.

The application command to add one local file is the approval boundary for that
one file. Intake accepts only a regular file of at most 20 MiB in the five
ingestion-supported media types: plain text, Markdown, HTML, PDF, and DOCX. The
existing extraction and content-quality checks must succeed before any raw bytes
or metadata are persisted.

The application also exposes one explicit local directory-intake command. Its
selected root must be a real non-symlink directory outside the CKB store. The
ingestion component preflights the complete bounded recursive traversal and
extraction before the application opens the store for writes: maximum depth is
32, scanned entries are limited to 1024, accepted files to 256, aggregate
accepted bytes to 256 MiB, and each accepted file retains the existing 20 MiB
limit. Traversal is deterministic by lexical relative path, containment is
checked against the canonical root, and child symlinks, special entries,
dot-prefixed entries/subtrees, and unsupported files are skipped and counted.
Every accepted file then becomes a new independent `file` source with its
existing origin binding and managed journal guarantees. After all file writes
succeed, the application atomically records one opaque directory binding and
one immutable hashed member per source in the same local SQLite transaction.
The selected root and exact file origins remain sensitive local state; generic
manifests, diagnostics, journals, inventory, and provider projections expose
neither. Repeating a bound root is rejected; explicit add-members provides
stable source reuse for approved directory additions one candidate at a time,
while removals, rename, and complete incremental reconciliation remain
deferred. The persisted membership remains a
historical mapping captured at binding or explicit append time even when an
existing member later gains a version, has its origin explicitly rebound, or is
retired.
A separate explicit bounded refresh preview can classify these historical
members as `current`, `changed`, `missing`, `retired`, or `origin-conflict` and
count unmatched accepted files without exposing paths or writing state. The
preview itself does not apply any refresh, persist new members, infer renames,
or change lifecycle state.
A separate read-only directory-root-rebind eligibility preview rescans one
candidate root, requires an exact path-hash/member and latest-byte match for
every historical member, and returns only path-free readiness and scan counts.
The explicit application command reuses that scan and atomically commits a
guarded all-member origin/revision update, or returns a guarded current-root
no-op; complete reconciliation remains deferred.
A separate moved-candidate projection reuses that scan exactly once and returns
only path-free, deeply frozen advisory source IDs for unique exact-integrity
one-to-one matches among same-member missing sources and unmatched files.
Basename, ordering, text, and path similarity are never identity evidence;
ambiguous matches are omitted, while `newSourceCount` remains the total scan
count used by add-members. It does not change any lifecycle or membership state.
A separate explicit bounded directory observation operation reuses that one
complete scan and records only path-free `current`, `changed`, or `missing`
observations whose source origin still has the same historical membership and
origin-binding revision. Retired, conflicted, and newly discovered files remain
reported but are skipped. The eligible batch is validated and committed in one
SQLite transaction with one shared checked-at timestamp; no IDs, bytes,
versions, membership, origin bindings, retirements, or journal events are
written. This records scan evidence, not an applied changed-byte refresh.
Another explicit bounded directory-refresh operation can apply only changed
bytes for active same-member files, in source-ID order, through the existing
stable managed-file append path. It records a current observation for each
successful append and for current or same-member-missing files, while retired,
origin-conflict, and unmatched files remain report-only. A later member failure
returns a path-free partial result after already committed members; no new
member, rename/removal, root-rebind, automatic-retirement, or background policy
is inferred by that refresh operation. The add-members operation is separate and
does not append versions for existing members or create refresh observations for
new members.
An explicit add-members operation can approve one complete bounded scan of an
already bound root and append each unmatched accepted file as a new managed file
source. Each source, version, canonical origin binding, managed blob, journal
commit, and immutable directory member is committed atomically per candidate;
the operation stops on the first later failure and returns only path-free
partial IDs. It does not create observations for new members or infer renames,
removals, rebinding, or retirement. An explicit approved directory-member
retirement operation performs one fresh bounded scan and accepts only an active
same-member `missing` member. It atomically records the existing
`user-requested` retirement marker with latest-version, origin-revision, and
chronology guards. Its path-free `removed` result means logical retirement, not
physical deletion; an already retired member returns `already-removed` without
a write. Bytes, versions, origin bindings, observations, journal state, and
immutable membership remain, while complete reconciliation, cleanup, and broader
lifecycle policy remain deferred.
SQLite migration v13 stores the opaque directory binding and immutable hashed
members in separate local-only tables with same-CKB foreign-key scope; there is
no backfill of earlier runtime-only imports.

The sixteenth #110 storage slice adds migration v14 as an append-only root-
revision foundation. Existing v13 bindings are backfilled as revision 1;
future bindings receive revision 1 through an insert trigger, and the current
root is exposed only through a max-revision view. Revisions reserve every
historical root in a CKB and retain their canonical root and timestamp in the
sensitive local store. The storage/handle rebind transaction verifies every
member and atomically updates current origin bindings plus revision N+1, while
same-root requests are guarded no-ops. v13 binding/member rows remain
immutable. A mutable v13 root or a no-backfill overlay was rejected because it
would erase historical roots, make moved-root conflicts ambiguous, or leave
legacy bindings without a trustworthy revision baseline. The application rebind
command now performs the explicit scan-and-commit boundary with generic
no-partial failures; rename/removal reconciliation and broader lifecycle policy
remain deferred. This is a component implementation only and does not advance
v0.7.

An explicit application operation can approve one local regular file as a
manual new version of an existing file source. Every append repeats the same
supported-media, successful-extraction, 20 MiB, stable-file, and managed-copy
checks as initial intake. If the approved bytes differ from the current version,
the store creates ordered immutable version N+1, linked to version N by its
parent version ID. If the approved bytes are identical to the current version,
the operation returns the existing source manifest as a no-op: it creates no
version and must not advance a timestamp or be interpreted as freshness or a
last-refresh observation. This operation is an explicit/manual version append
or update, not automatic refresh.

The selected path for a manual append exists only for the duration of that
operation. It never changes an existing origin binding, including when the
selected path or basename differs or the bytes are an identical no-op. A
successful managed create records the canonical physical path returned by its
verified capture in a separate sensitive, local-only SQLite origin-binding
table, together with its binding timestamp. This state is copied with the
SQLite database but is not portable continuity: it can become stale when the
store moves machines or the origin moves or disappears. It is never
provider-facing. An explicit read-only
application operation may check one source binding. It reports source identity,
observation time, and exactly one of unbound, current, changed, missing, or
inaccessible. It returns no path, checksum, media type, byte size, label, or
content and writes no source version, binding, freshness, or last-refresh state.
Current is a point-in-time comparison with the latest stored version, not a
durable freshness claim. A separate explicit application operation may refresh
from the remembered binding. It first applies the same no-follow, regular-file,
20 MiB, supported-media, extraction, and latest-version comparison. Only a
changed origin proceeds to storage's stable capture and managed-copy append;
success creates the next immutable parent-linked version. Current, unbound,
missing, inaccessible, and substituted-symlink origins create no version.
Refresh returns source identity, observation time, action status, and the new
version ID only when created; it returns no path or observed file metadata or
content and does not update the binding. It persists a path-free observation
against the exact latest source version examined. A successful changed-byte
append records the new version as current together with its successful refresh
time; other outcomes record current, unbound, missing, or inaccessible without
claiming a successful refresh. This is evidence of the last explicit attempt,
not a freshness TTL or proof that the origin remains unchanged. When another
operation advances the source version, reads derive `stale` until a later
explicit refresh records a new observation. The operation must be invoked
through a visible local user action and never runs as background monitoring. A
separate explicit rebind
operation accepts one newly selected path and repeats supported-media,
successful-extraction, no-follow, size, stable-file, and checksum checks through
a read-and-hash verification that stages or publishes no copy. It replaces the
local binding only when the captured media
type, checksum, and size exactly match the latest managed immutable version; it
creates no source version, managed blob, or journal event. Different bytes must
first pass the explicit manual append operation and can then be rebound as an
exact match. A same-canonical-path selection is a no-op. The result contains
only source identity, current/rebound status, and binding time. The superseded
sensitive path is replaced rather than retained as history. Rebinding never
discovers a path, runs automatically, or changes refresh-observation state. The existing
source ID, kind, creation time, and display label remain stable; the
binding is not included in the portable descriptor or source/version metadata,
manifests, journals, inventory,
diagnostics, or application source projections.

Successful intake copies the exact approved raw bytes beneath `sources/` using
an opaque layout derived only from generated source and version IDs. The
original host path and filename are neither physical names in the store nor
portable source provenance. The successful managed-create origin binding is
the one explicitly documented local exception: it remains only in the
sensitive SQLite binding table and is not exposed to providers or diagnostics.
A local label may default to the basename or use a label chosen by the user,
but it is sensitive user-interface metadata, not an origin path or instruction.

Storage migration version 6 adds the managed-object marker that binds a source
version to its copied bytes. Publication is no-replace, file first, and database
second: bytes are staged privately, verified, published under their final opaque
name, and only then committed with their marker and integrity metadata. A
committed managed marker is valid only while the corresponding regular file
exists and matches the recorded checksum and size. Ordinary failures clean up
their staging or newly published file. A process crash or concurrent loser can
still leave an unreferenced opaque file, but an unreferenced entry has no
authenticated ownership evidence. A filename or layout shape cannot prove that
DraftLoop created or abandoned it, and no database row may be created to
legitimize it implicitly.

An explicit local application query can inventory the `sources/` namespace
after the normal referenced-blob validation succeeds. It is bounded and
non-destructive. Its result contains only counts of verified managed files,
scanned entries, staging-shaped root files, other opaque root files and
directories, extra entries inside expected managed-source directories,
symlinks, and special or otherwise unclassified entries, plus whether the scan
completed or reached its limit. It returns no names, paths, IDs, labels,
checksums, or file content. It never follows unknown symlinks, recurses into
unknown directories, reads unknown file bytes, mutates the database or
filesystem, or runs automatically. Missing or corrupt referenced blobs still
fail normal validation; this query is not a repair mode.

The inventory is groundwork for later reconciliation, not ownership proof or
cleanup authority. In particular, “staging-shaped” and “opaque” are structural
categories only; entries in either category remain unknown and must not be
deleted, adopted, quarantined, or repaired. The prospective journal described
below supplies provenance evidence for new writes only; safe cleanup also
requires coordination with managed-file writers and explicit user approval.
Entries absent from prospective journal proof remain unknown. The query is
local application state inspection, not provider-facing data or
content-diagnostic automation.

Storage migration version 7 adds a prospective, internal, append-only
managed-write ownership journal. Every new managed create or append records an
opaque intent before staging begins. A monotonic event records the resolved
target before publication, followed by publication and the atomic managed-marker
and database commit; completion is recorded only after staging cleanup succeeds.
New staging names are opaque hashes derived from the
operation rather than source metadata or user filenames.

The journal contains no origin path, filename, label, checksum, source content,
provider data, diagnostic projection, cleanup token, or approval. Journal
identifiers remain internal and are not returned by application operations or
the count-only inventory. Migration does not infer or backfill ownership for
legacy version-6 writes. Any entry without prospective journal proof remains
unknown, even when its bytes or shape resemble a managed or staging object.

Journal evidence is provenance for a future cleanup policy, not cleanup
authority. This slice does not delete, adopt, quarantine, repair, reconcile, or
automatically scan entries; coordinate writers with a lock or lease; expose an
approval UI; or authorize cleanup. Safe future cleanup still requires writer
coordination and explicit visible approval. Same-current-byte managed appends
record a terminal, non-owning no-op. An existing metadata-only version may be explicitly
materialized under the normal managed-copy checks, but a pre-existing unowned
target is never adopted merely because its bytes or shape match expectations.

Storage migration version 8 adds the separate local-only origin-binding table.
The binding is inserted atomically with a successful managed create's source,
version, managed marker, and committed journal event. Existing v7 sources
migrate without bindings. Manual appends do not insert or update a binding.
Storage migration version 9 replaces the blanket binding-update prohibition
with a guarded update used only after the portable store verifies an explicit
exact-byte rebind. The source ID remains immutable, deletion remains forbidden,
the source must remain a managed file source, and a replacement binding time
must not move backward. The replacement does not retain the superseded local
path.

Storage migration version 10 adds one guarded, path-free refresh-observation
row per source. It records the source and observed-version identities, bounded
outcome and observation time, and optional last successful changed-byte refresh
version/time. Version references must belong to the source, paired refresh
fields cannot be split, timestamps cannot move backward, source identity is
immutable, and deletion is forbidden. `stale` is derived when the observed
version is no longer latest; it is not persisted as a filesystem observation.

Storage migration version 11 adds the immutable logical-retirement marker.
The marker must reference a source in the requested active CKB, its timestamp
cannot precede source creation, and its only supported reason is
`user-requested`. It cannot be updated or deleted. Retiring a source does not
remove raw bytes, versions, bindings, observations, journals, indexes, backups,
or run references; those remain governed by later lifecycle-storage policy.

Storage migration version 12 permits the managed opaque-byte marker for file or
URL versions while preserving file-only origin bindings. It adds immutable,
source/version-scoped URL provenance and requires every managed URL version to
have matching provenance. URL provenance is committed atomically with the
source, each changed version, managed marker, exact bytes, and journal
transition. The same schema supports explicit URL refresh; no later migration is
required for this slice.

The store is local and plaintext. Creation applies restrictive filesystem
permissions where the operating system and filesystem support them, but those
permissions are best-effort and are not encryption or protection from another
process running as the same user. The user controls the selected location and
any copies made outside DraftLoop.

Filesystem paths are host configuration, not portable product data. The
selected path is excluded from the store's portable manifest, logical identity,
provider request data, and content-free audit or diagnostic projections. A UI
may show the local location to the user, but it must not treat that location as
candidate evidence or transmit it to a model provider.

The same rule applies to source origins in provider-facing and content-free
surfaces. The canonical path for a successful managed file create is retained only
as sensitive local state in the SQLite origin-binding table. It is copied with
the database but is not portable continuity, may become stale when the store
or origin moves or disappears, is not automatically updated, and never enters
a provider request or diagnostic projection. The explicit status operation does
not project that path and does not persist its observation. The separate
refresh-state projection contains only source/version identities, bounded
status, and timestamps. Exact managed
provenance elsewhere consists of the logical store, CKB, source and version IDs
plus the checksum, size, media type, and capture time of the copied bytes.
Approved original/final URLs are likewise retained only as sensitive local
per-version provenance. Source labels, URLs, and checksums can correlate known
content, so none belongs in a content-free diagnostic projection or provider
request.

Managed source bytes are inert candidate data. A source named `AGENTS.md`,
`.env`, or like another tool or repository configuration file must never become
application instructions, provider policy, permissions, or executable
configuration. Its original filename is not used in the managed layout.

This decision deliberately leaves the following work unintegrated:

- complete directory removal reconciliation, applied directory rebind, rename/removal,
  and broader member-retirement policy (the explicit operation handles only one
  approved missing same-member member; add-members handles only unmatched
  additions, while applied refresh handles only existing active same-member
  changed files);
- redirect-observation history, conditional URL requests, and URL-specific
  failure or time-based readiness policy;
- background refresh, time-based freshness policy, moved-origin discovery, and
  product-adapter controls for refresh state or explicit rebind;
- automatic duplicate merging or preference, source reactivation, and physical
  deletion handling;
- normalized facts and lexical, vector, or hybrid retrieval indexes;
- selecting one or more CKBs for an application and binding that selection to
  a run or provider-transmission approval;
- CLI and desktop creation, opening, selection, and lifecycle controls;
- source and store deletion semantics, including raw bytes, derived data, and
  retained run references;
- repair of missing or corrupt referenced blobs, writer locks or leases,
  cleanup approval, and reconciliation of unknown entries; and
- complete portable export, backup, restore, conflict handling, and migration
  rollback.

Until those boundaries are implemented, the existing workspace-scoped evidence
and retrieval path remains authoritative for application runs. The presence of
a portable-store record must not make a workspace run read from it implicitly.

## Alternatives considered

- **Keep reusable knowledge in every application workspace.** Rejected because
  copies diverge, deletion and freshness become ambiguous, and selecting an
  isolated corpus for a run is impossible to express reliably.
- **Use one application-wide path as the store identity.** Rejected because a
  path is machine-specific, leaks local directory structure, and changes when a
  user moves the store.
- **Put workspace run history in the portable store.** Rejected because
  opportunity and provider history has a different privacy, retention, and
  backup lifecycle from reusable candidate knowledge.
- **Keep the store metadata-only until full source lifecycle exists.** Rejected
  because narrowly approved immutable file and URL snapshots can establish
  portable byte provenance without prematurely enabling directory or URL
  refresh, retrieval, provider use, deletion, or backup claims.
- **Use cloud storage or remote vectors.** Rejected for this stage because it
  would add accounts, authentication, remote retention, and new provider
  exposure to a local-first boundary.

## Consequences

- A CKB can have a stable logical identity independent of its local path.
- Candidate knowledge and application history can evolve under separate
  lifecycle and retention policies.
- Moving or copying a SQLite file will require later conflict and restore rules;
  the UUID alone does not decide which copy is current.
- The store can contain immutable managed raw bytes for an approved file and
  append changed bytes as parent-linked versions without changing source
  identity. It does not yet improve application retrieval or monitor origins.
- The application can explicitly inspect bounded structural counts without
  disclosing entry identifiers or turning unknown entries into owned residue.
- The application can explicitly preflight a bounded recursive directory and
  import accepted files as independent managed sources. A complete import
  persists a sensitive local-only canonical root binding plus immutable
  SHA-256 relative-path membership; selected roots and exact origins remain
  runtime/local state outside product projections. Skips and limits are
  counted, while complete directory reconciliation and membership lifecycle
  decisions remain unimplemented. Existing active same-member changed files can
  be applied explicitly in deterministic source order; failures after an
  earlier member commit return a path-free partial result.
- Prospective v7 journal events provide internal provenance evidence for new
  managed writes without claiming legacy or otherwise unjournaled entries.
- Deleting an application workspace does not delete a separate CKB store, and
  deleting the original host file does not delete its managed CKB copy. Deleting
  a future CKB store must not silently claim to delete workspace run history,
  device backups, or user-created copies.
- A SQLite-only CKB copy is not a complete CKB backup because it
  does not include managed raw bytes. CKB deletion, backup, export, restore, and
  secure-erasure semantics remain unimplemented.
- The architecture and threat model must be revisited before incremental
  directory refresh, membership lifecycle actions, retrieval cutover,
  export/restore, or provider use is enabled.

## Follow-up

- Define managed-writer coordination and an explicit visible approval policy
  before future reconciliation can act on prospective journal evidence;
  unjournaled entries remain unknown.
- Define explicit application-to-CKB selection and fail-closed retrieval
  isolation.
- Define deletion coverage for raw, normalized, indexed, cached, historical,
  exported, and backed-up data.
- Add CLI and desktop approval surfaces only after those contracts have focused
  tests and provider-preflight integration.
