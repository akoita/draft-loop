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
explicit application operation. They do not connect CKB selection or retrieval
to an application workflow.

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

The application command to add one local file is the approval boundary for that
one file. Intake accepts only a regular file of at most 20 MiB in the five
ingestion-supported media types: plain text, Markdown, HTML, PDF, and DOCX. The
existing extraction and content-quality checks must succeed before any raw bytes
or metadata are persisted.

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

The selected append path exists only for the duration of the operation. It is
not remembered as an origin binding or persisted in portable metadata,
provider-facing data, or content-free diagnostics. The existing source ID,
kind, creation time, and display label remain stable even if the newly selected
path or basename differs. The selection therefore says which bytes the
candidate approves for this version; it does not redefine the source's identity
or provenance.

Successful intake copies the exact approved raw bytes beneath `sources/` using
an opaque layout derived only from generated source and version IDs. The
original host path and filename are neither physical names in the store nor
persisted provenance. A local label may default to the basename or use a label
chosen by the user, but it is sensitive user-interface metadata, not an origin
path or instruction.

Storage migration version 6 adds the managed-object marker that binds a source
version to its copied bytes. Publication is no-replace, file first, and database
second: bytes are staged privately, verified, published under their final opaque
name, and only then committed with their marker and integrity metadata. A
committed managed marker is valid only while the corresponding regular file
exists and matches the recorded checksum and size. Ordinary failures clean up
their staging or newly published file. A process crash or concurrent loser can
still leave an unreferenced opaque file; explicit orphan reconciliation remains
future lifecycle work and no database row may be created to legitimize residue
implicitly.

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

The same rule applies to source origins in this slice: exact host paths and URLs
are not persisted. Exact managed provenance consists of the logical store, CKB,
source and version IDs plus the checksum, size, media type, and capture time of
the copied bytes. It does not claim to preserve the original host location.
Source labels are local user-visible metadata and checksums can correlate known
content, so neither belongs in a content-free diagnostic projection or provider
request.

Managed source bytes are inert candidate data. A source named `AGENTS.md`,
`.env`, or like another tool or repository configuration file must never become
application instructions, provider policy, permissions, or executable
configuration. Its original filename is not used in the managed layout.

This decision deliberately leaves the following work unintegrated:

- directory intake, URL/fetched source intake, and directory bindings;
- remembered origin binding, automatic refresh, freshness or last-refresh
  state, and moved, deleted, or inaccessible-origin reporting;
- cross-source duplicate relationships and duplicate handling;
- normalized facts and lexical, vector, or hybrid retrieval indexes;
- selecting one or more CKBs for an application and binding that selection to
  a run or provider-transmission approval;
- CLI and desktop creation, opening, selection, and lifecycle controls;
- source and store deletion semantics, including raw bytes, derived data, and
  retained run references;
- explicit orphan reconciliation; and
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
  for this slice because a narrowly approved, immutable single-file copy can
  establish portable byte provenance without prematurely enabling directory
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
- Deleting an application workspace does not delete a separate CKB store, and
  deleting the original host file does not delete its managed CKB copy. Deleting
  a future CKB store must not silently claim to delete workspace run history,
  device backups, or user-created copies.
- A SQLite-only CKB copy is not a complete CKB backup because it
  does not include managed raw bytes. CKB deletion, backup, export, restore, and
  secure-erasure semantics remain unimplemented.
- The architecture and threat model must be revisited before directory or URL
  intake, retrieval cutover, export/restore, or provider use is enabled.

## Follow-up

- Define explicit orphan reconciliation for interrupted managed intake without
  adopting or deleting unrelated files.
- Define explicit application-to-CKB selection and fail-closed retrieval
  isolation.
- Define deletion coverage for raw, normalized, indexed, cached, historical,
  exported, and backed-up data.
- Add CLI and desktop approval surfaces only after those contracts have focused
  tests and provider-preflight integration.
