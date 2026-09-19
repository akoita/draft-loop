# Candidate evidence architecture

This page is the canonical current-state reference for the contracts that turn candidate-owned material and opportunity context into bounded, reviewable evidence. It covers opportunity briefs, writing policies, portable candidate knowledge bases, canonical candidate profiles, and their local lifecycle and run-selection boundaries.

Use [Architecture overview](overview.md) for the system map. See [Drafting and review](drafting-and-review.md) for author, critic, and artifact-quality boundaries, and [Runtime and trust](runtime-and-trust.md) for workflow, adapter, provider, and export boundaries. The [CLI and desktop reference](../reference/cli-and-desktop.md) documents user operations; [ADR 0007](../adr/0007-portable-candidate-knowledge-store.md) is canonical for the portable CKB contract.

## Opportunity brief contract

The #67 components define a provider-independent, versioned opportunity brief
with durable local persistence and application-level intake. A brief distinguishes job
postings, social announcements, company context, and candidate instructions;
records approved-URL, local-file, pasted-content, or direct-input provenance;
and keeps role, employer, responsibilities, requirements, priorities, and
candidate instructions source-linked. Opportunity requirements are employer
context, never candidate facts.

Draft briefs may retain inaccessible, unsupported, failed, partial, stale,
duplicate, or contradictory source issues. A reviewed brief requires the
minimum structured opportunity fields and no open issue; acknowledged source
limitations remain visible. Candidate-instruction sources may support only the
instruction fields, while opportunity facts may not cite them. The contract
stores bounded structured fields and checksums, not raw source content or host
paths, and preserves human-authored ordering.

Application-level source intake connects that contract to explicitly approved
HTTPS URLs, selected local files, pasted content, and direct candidate
instructions. Existing bounded ingestion controls remain authoritative.
Captured sources retain checksums; failed or inaccessible sources retain a
visible status and issue without a fabricated checksum. The draft contains
provenance metadata, not raw intake content or host paths. Duplicate captured
bytes remain visible for review.

Edits and review create immutable successive brief versions. Review still
requires the minimum structured opportunity fields and no open issue; editing
a reviewed brief creates a new draft rather than changing the reviewed value.
SQLite schema v22 persists those versions under a workspace-scoped composite
identity with canonical payload checksums, immediate-parent enforcement, and
immutable update/delete guards. Identical writes are idempotent; latest-version
lookup does not create a mutable current pointer. Audit events retain only an
opaque brief identity, version, status, and checksum rather than brief content
or source provenance.

An adapter-neutral application service reloads validated, deeply frozen
versions after restart and applies edits or review only to an explicitly
expected latest version. Reload never refetches URLs or local files. Provider
extraction uses the configured author model through the existing
Anthropic/OpenAI/local adapter boundary and requires the same explicit data
approval as drafting. Only sanitized opportunity source records cross that
boundary; candidate inputs, URLs, paths, and provenance remain local. Provider
output is schema-checked and citation-checked before application-owned IDs are
created, while failures become fixed content-free draft issues. Shared
application operations now create, reload, list, edit, and review durable
versions. The CLI accepts runtime-only JSON manifests; the desktop host owns
native file selection and returns a bounded path- and URL-free projection
through its strict capability bridge. A new run may select one exact reviewed
brief ID and version. The application verifies its stored checksum, derives the
opportunity context only from that reviewed record, and persists a safe
ID/version/checksum reference in the immutable run context. Resume reuses that
snapshot; it cannot select a different opportunity version. Source URLs, paths,
raw text, and provenance remain outside provider-facing context.

## Writing policy enforcement

Writing policies are local, immutable, checksum-addressed versions. Activating
a Markdown or text file appends it to the workspace's SQLite policy history and
makes it the default for future runs. Importing appends a version without
changing that default. Existing managed files are migrated lazily, and direct
managed-file changes are versioned before the next run rather than silently
overwriting history.

The policy compiler recognizes bounded forbidden-term and
forbidden-punctuation rules, tone, spelling locale, verbosity, a one- or
two-page target, section order, emphasis areas, and transparent anti-formulaic
defaults. The defaults are ordinary forbidden-term rules and can be disabled
explicitly in the policy. Older content-only policy snapshots remain readable.
Preferences are advisory model context: locale is not a spell checker, page
target is not a rendering profile, and emphasis does not authorize new facts.

`packages/validation` evaluates the deterministic rules in artifact section
and block order. Each finding carries a stable rule identity and content-free
block location; messages do not copy the forbidden term, matched draft text,
source paths, or surrounding content. The orchestrator applies the exact policy
from the immutable context during normal draft validation before independent
critique.

Section-order validation is deterministic and reports stable, content-free
section and block locations. Page targets and emphasis areas remain advisory;
rendering QA separately verifies the produced document.

A reviewed opportunity may select one imported policy version as a complete
run-specific override. The application verifies both immutable versions,
records base and override checksums in the run context, and supplies the
effective policy to both author and critic. The selection never changes the
active workspace policy. CLI and desktop projections expose safe version and
lineage metadata; exact policy content is available only through an explicit
local content-read action.

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

Automatic move inference, indexing, and background refresh remain deferred
under their owning roadmap issues.
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
write, imports into a fully staged current-schema store, validates the restored graph and
managed bytes, and then publishes to an approved new directory without replacing
an existing entry. The only supported collision decision is
`fail-if-destination-exists`; restore never merges stores, renames logical
identities, or claims continuity with the exporting host. Restored URL evidence
keeps only its safe fetched-at and kind fields. Original URLs and all file and
directory bindings remain absent.

Confirmed deletion accepts only an archived non-default CKB after a separate
path-free preview. Its exact token binds the store graph, effective retention
and override revisions, managed-object integrity, and bounded physical
inventory. The command revalidates that state under the store-wide writer
lease, stages verified managed blobs before committing the logical deletion,
and uses a durable v21 operation journal to recover safely across interruption.
Legal hold, manual preservation, unmanaged database records, missing or
mismatched managed blobs, and unknown deletion state block the operation.
Unknown or unowned filesystem entries are preserved. The retained completion
audit is content-free; external backups, exports, and copied stores are not
deleted.

The package deliberately represents every restored source as unbound. It does
not preserve directory-root/member relationships or host-binding history, and
a valid legacy store containing unmanaged source versions cannot be described
as a complete package, so export refuses it rather than silently omitting
provenance.

The schema currently preserves append-only source/version, origin, observation,
retirement, URL, restored path-free URL provenance, directory-root, and
directory-member history. [ADR 0007][adr-0007] records the compact v6–v21
schema-evolution summary and the invariants that
motivated each boundary.

### Canonical candidate profile contract

The first #66 component defines a provider-independent, immutable canonical
profile aggregate without replacing the legacy profile identity used by older
contexts. A profile version binds an exact path-free CKB selection and stores
bounded normalized facts for identity, contact, employment and dates,
achievements, projects, skills, certifications, education, languages, and
approved links. Every fact cites an exact selected store, CKB, source, and
source version and requires candidate-provided provenance; public
corroboration is optional.

Conflicts, possible duplicates, and omissions remain explicit issues rather
than silently selecting a value. Every issue must be handled before reviewed
status. The strict schema and framework-free constructor enforce version
lineage, review timestamps, source membership, bounded collections, stable
identifiers, canonical ordering, deep immutability, and path-free JSON round
trips.

The second #66 component adds workspace-local, append-only profile history in
SQLite migration 24. Canonical payload checksums, immediate parent lineage,
monotonic update timestamps, immutable triggers, strict reload validation, and
content-free audit events protect every version. A provider-independent
application service supports optimistic fact/issue edits and creates a new
reviewed version only after the domain review blockers pass.

Profiles may combine explicitly selected CKBs, so their history does not belong
to any one portable CKB package and is not included in CKB backup/restore. This
component now also has a provider-independent derivation boundary. CKB storage
returns fresh bytes plus safe version metadata after one-handle size, checksum,
and file-identity verification; it never exposes the managed path. The
application revalidates the exact lifecycle snapshot after normalization and
again after extraction before persistence, requires explicit provider-data
approval, and sends only
bounded normalized text, media types, checksums, and application-owned opaque
source IDs through a strict extraction port.

The strict provider proposal can describe all canonical fact categories and
relationships but cannot choose persisted IDs, provenance kinds, review state,
severity, or messages. Each proposed fact must include an evidence quote that
occurs in its cited normalized source and contains the proposed value; the quote
is checked locally and is not persisted. The application maps valid citations back to exact selected CKB
versions, generates deterministic IDs, keeps conflicting and duplicate facts,
adds visible category omissions, builds a draft, and appends it through the
shared history service. The configured-provider adapter uses the workspace's
author model and existing API-key, authenticated user-session, or local
transport. Its system prompt treats source text as untrusted data, and the
strict proposal schema remains the only accepted response shape.

Shared application and local-driver operations derive from the workspace's
validated, pinned CKB selection and provide exact/latest reads, immutable
history, optimistic edits, and candidate review. Store roots remain inside the
local driver rather than entering adapter-neutral commands or results. The CLI
and packaged desktop host expose the shared five-operation workflow without
accepting a CKB store root; only derivation has a provider-transmission approval
flag. The desktop bridge returns an explicit bounded profile projection and
does not expose the stored selection snapshot.

New runs may select one exact reviewed profile version. The local driver
verifies its persisted checksum and requires its CKB selection to match the
workspace's current lifecycle-ready selection before recording a safe profile
ID, version, and checksum reference in immutable context. Resume accepts no
replacement selection, so later profile edits cannot change an existing run.
Legacy starts without a canonical profile remain readable. Source lifecycle
changes preserve immutable profile and run history, but the same selection
check blocks stale drafts from becoming reviewed and blocks unavailable
profiles from new runs. Whole-workspace backup and retention preserve profile
and approved-export records; a portable single-CKB backup does not claim a
cross-CKB workspace profile. #80 owns removal or rebuilding of derived index
rows when these dependencies become unavailable. A visual profile editor in
the collecting desktop workspace uses only the bounded host projection. It
loads exact history, preserves provenance while editing fact values and issue
statuses, requires explicit transmission approval for derivation, and injects
the selected reviewed ID/version pair into the existing run-dispatch boundary.
Historical and reviewed versions remain read-only in that surface.

### CKB integration status

The exact-version lexical path is integrated. Each portable CKB store owns a
replaceable SQLite FTS5/BM25 projection for its managed source versions. The
shared application service revalidates explicit selections, synchronizes or
rebuilds each selected source/version scope, queries selected stores, and
deterministically fuses multi-CKB results. Provider-facing results carry only
bounded text and opaque chunk IDs; workspace history stores immutable,
content-free retrieval traces. Legacy workspaces without a CKB selection
continue to use the earlier workspace evidence path.

Lifecycle and integrity checks cover selected-version scope, index freshness,
retirement, archive state, and managed-byte verification. A stale, unavailable,
or mismatched selection does not silently become empty context. Derived index
rows are replaceable and can be invalidated when source versions are deleted;
historical traces remain part of immutable run history. Portable backup omits
the rebuildable index, so a restored store must rebuild before retrieval.

Vector and hybrid retrieval remain deferred evaluation components rather than
the default CKB retrieval path.

[adr-0007]: ../adr/0007-portable-candidate-knowledge-store.md
