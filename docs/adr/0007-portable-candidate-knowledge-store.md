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
SQLite lifecycle metadata. The current metadata-only source/version slice adds
stable CKB-scoped source identities and immutable source versions without
putting candidate source content in the store or connecting it to an application
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
The metadata contains neither the original bytes nor extracted content.

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
are not persisted. Source labels are local user-visible metadata and checksums
can correlate known content, so neither belongs in a content-free diagnostic
projection or provider request.

This decision deliberately leaves the following work unintegrated:

- adding physical candidate source files or fetched source content, including
  managed intake and directory bindings;
- exact origin provenance, refresh and freshness, and duplicate handling;
- normalized facts and lexical, vector, or hybrid retrieval indexes;
- selecting one or more CKBs for an application and binding that selection to
  provider-transmission approval;
- CLI and desktop creation, opening, selection, and lifecycle controls;
- source and store deletion semantics, including derived data and retained run
  references; and
- portable export, backup, restore, conflict handling, and migration rollback.

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
- **Store candidate files in the initial slice.** Deferred because safe managed
  copies, symlink and traversal handling, versioning, deletion coverage,
  backup/restore, and provider-selection approval need explicit contracts and
  tests before physical source material crosses this boundary.
- **Use cloud storage or remote vectors.** Rejected for this stage because it
  would add accounts, authentication, remote retention, and new provider
  exposure to a local-first boundary.

## Consequences

- A CKB can have a stable logical identity independent of its local path.
- Candidate knowledge and application history can evolve under separate
  lifecycle and retention policies.
- Moving or copying a SQLite file will require later conflict and restore rules;
  the UUID alone does not decide which copy is current.
- The store contains source and source-version metadata but no source content,
  so it does not yet improve application retrieval or reduce repeated import.
- Deleting an application workspace does not delete a separate CKB store, and
  deleting a future CKB store must not silently claim to delete workspace run
  history or user-created backups.
- The architecture and threat model must be revisited before physical source
  ingestion, retrieval cutover, export/restore, or provider use is enabled.

## Follow-up

- Define managed physical-source intake and exact provenance without retaining
  host paths in portable or provider-facing records.
- Define explicit application-to-CKB selection and fail-closed retrieval
  isolation.
- Define deletion coverage for raw, normalized, indexed, cached, historical,
  exported, and backed-up data.
- Add CLI and desktop approval surfaces only after those contracts have focused
  tests and provider-preflight integration.
