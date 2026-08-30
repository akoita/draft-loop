# ADR 0008: Keep active lexical indexes with each candidate knowledge store

- Status: Accepted
- Date: 2026-08-30
- Decision owners: DraftLoop maintainers

## Context

DraftLoop already has a SQLite FTS5/BM25 path for files copied into one
application workspace. Issue #80 must instead retrieve reusable candidate
knowledge from the exact CKB source versions selected for a run. The product
also needs incremental rebuild and deletion, multi-CKB selection, visible stale
diagnostics, purpose-specific queries, and immutable retrieval evidence without
copying paths or the full candidate corpus into run history.

A profile may span more than one CKB. A workspace-local index would make
cross-CKB querying simple, but it could outlive a deleted or retired source
because a CKB operation cannot discover every workspace that copied its
derived rows. A global index would weaken the local-store ownership and
selection boundaries. Treating the existing append-only workspace evidence
tables as a mutable cache would also mix legacy run evidence with derived CKB
state that must be replaceable.

## Decision

### Index ownership

Each CKB SQLite store owns a separate derived FTS5/BM25 index for its managed
source versions. Index rows are not canonical candidate records: they are
replaceable local projections of integrity-verified managed bytes. Every row
is keyed by logical store, CKB, source, exact version, and deterministic chunk
identity. It records bounded normalized metadata for career entity, date,
section, technology, project, credential, and provenance. It never records a
filesystem path, source URL, workspace ID, opportunity, provider response, or
run decision.

Index operations always name exact source versions. They never infer `latest`.
The index manifest records the schema and indexer identity plus the exact
source-version set used to build it. An idempotent incremental sync replaces
only changed source-version projections; an explicit rebuild derives the whole
selected set again. Retirement, archive, missing managed bytes, version drift,
and deletion make affected rows unavailable. Confirmed CKB deletion removes
the derived rows before the owned source graph, while portable backups omit the
rebuildable index and therefore restore as `not-indexed`.

The legacy workspace evidence tables remain unchanged for old workspaces and
runs. New CKB retrieval uses a separate port so the migration does not silently
reinterpret historical evidence.

### Workspace selection and multi-CKB retrieval

The application opens only the store roots already bound in the sensitive
workspace configuration and revalidates the path-free CKB selection snapshot.
It queries each selected CKB for exactly the selected source/version pairs.
Results from multiple stores are combined with deterministic rank fusion
because BM25 scores from different corpora are not directly comparable.
Stable tie-breaking uses opaque logical identities, never paths or labels.

The application compares lifecycle and index evidence before and after reads.
An unindexed or stale selected version produces a visible structured status;
it is never converted silently to empty context. A current index with no lexical
match may return a bounded deterministic fallback from the same exact scope,
recorded explicitly as `bounded-fallback`.

### Query purposes and provider boundary

Retrieval requests use one of five bounded purposes:

- opportunity requirements;
- achievement recall;
- factual checks;
- contradiction detection; or
- critic review.

Purpose controls query construction, limits, and trace interpretation. The
provider receives bounded selected chunk text and opaque chunk IDs. Provider
output may cite only those chunk IDs; store, CKB, source, version, path, URL,
index, and score fields are not model-selectable evidence references.

### Immutable traces

The workspace database stores one immutable trace per retrieval operation. A
trace contains the workspace/run operation identity, query purpose, SHA-256 of
the normalized query, index schema/indexer identity, exact path-free selected
source/version references, status and counts, elapsed time, and selected chunk
IDs with BM25 ranks. It contains no query text, chunk text, path, root, URL,
source label, raw candidate content, provider prompt, or hidden reasoning.

Traces are historical evidence rather than active index rows. CKB retirement
or deletion removes active derived rows but does not rewrite an existing run,
profile, trace, artifact, or approved export. Workspace backup/restore preserves
traces; ordinary audit retention does not delete them.

## Consequences

- CKB lifecycle operations can remove or invalidate their own derived data
  without searching unrelated workspaces.
- Reusable CKB indexes avoid copying the full corpus for every opportunity.
- Multi-CKB retrieval needs an application-level fan-out and deterministic
  fusion step, plus lifecycle checks around separate local stores.
- Portable restore requires an explicit rebuild before retrieval.
- The first contract and storage migrations can land without cutting existing
  runs over to an incomplete index. Runtime cutover occurs only after indexing,
  lifecycle, trace, adapter, and representative-quality gates pass.

## Alternatives considered

### Copy every selected source into a workspace index

Rejected as the canonical CKB path because retirement or deletion in a CKB
cannot synchronously discover and clean every workspace cache. It also
duplicates reusable candidate material for each opportunity.

### Put all CKBs in one global index

Rejected because it creates a broader persistence and isolation boundary than
the user-selected portable stores and increases the consequence of a scope
filtering defect.

### Replace the legacy workspace evidence tables in place

Rejected because those append-only rows support existing run history, while a
derived CKB index must support replacement, invalidation, deletion, and rebuild.
