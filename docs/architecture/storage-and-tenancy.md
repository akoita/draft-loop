# Storage and tenancy architecture

This page is the reference for how DraftLoop stores workspaces, candidate
knowledge, exports and run history, and how the hosted service keeps tenants
apart. Application code names storage ports only; a local driver and a hosted
driver implement them (ADR 0011, D3 and D15).

Start with the [architecture overview](overview.md) for the system map. The
hosted routes that use this storage are in [Hosted service](hosted-service.md).

```mermaid
flowchart TB
  app["Application contracts<br/>packages/application"] --> ports["Storage ports<br/>packages/storage/src/ports"]
  ports --> local["Local driver<br/>desktop, CLI"]
  ports --> hosted["Hosted driver<br/>createHostedApplicationDriver"]
  local --> sqlite[("SQLite workspace store<br/>and portable CKB")]
  local --> files[("Files under the workspace")]
  hosted --> pg[("Postgres + pgvector<br/>packages/storage-postgres")]
  hosted --> blobs[("Cloud Storage or files<br/>packages/storage-gcs")]
  conformance["Conformance suite<br/>@draft-loop/storage/conformance"] -. checks .-> local & hosted
```

## Contents

- [Storage ports](#storage-ports)
- [Postgres and the hosted driver](#postgres-and-the-hosted-driver)
- [Tenant isolation](#tenant-isolation)
- [Blobs on Cloud Storage](#blobs-on-cloud-storage)
- [Testing and running the stack](#testing-and-running-the-stack)
- [Run history](#run-history)

## Storage ports

Storage sits behind ports, as ADR 0011 (D3, D15) requires:

- The port interfaces and record types live in `packages/storage/src/ports/`.
  Application modules name these ports, never the SQLite class.
- The local driver's storage factory,
  `packages/application/src/local-storage-factory.ts`, is the one application
  module that opens SQLite. It alone reaches SQLite maintenance such as backup,
  integrity checks and history compaction.
- A workspace's settings go through a settings port
  (`ports/workspace-settings.ts`): its configuration, the managed writing
  policy, and the small documents that record its modes, model pair, consent
  and decisions. The local driver keeps them as files under
  `<root>/.draft-loop/`, written atomically. A driver that keeps them elsewhere
  wraps each call in `withWorkspaceSettings`, which reaches every module the
  call goes through.
- A job description and source folder are read through a workspace-files port
  (`packages/application/src/workspace-files.ts`). A driver without local
  files wraps each call in `withWorkspaceFiles(noWorkspaceFiles, ...)`, so its
  runs start only from a reviewed job brief and a knowledge selection.
- A run opens the candidate knowledge stores its selection names through
  `openKnowledgeStore`. Locally the reference is the store's folder; a driver
  that keeps knowledge elsewhere wraps each call in `withKnowledgeStoreOpener`.
  Such a store need only offer a run's operations
  (`@draft-loop/storage/run-knowledge-store`): lifecycle readiness,
  sensitivity rules, pinned source bytes, and the lexical and vector
  projections. `runOnlyCandidateKnowledgeStore` refuses everything else.
- `createHostedApplicationDriver` (`packages/application/src/hosted-driver.ts`)
  is the shared driver over injected ports (ADR 0011, D15). It runs the local
  driver's code inside `withWorkspaceSettings`, `withStorageFactory`,
  `withKnowledgeStoreOpener` and `withWorkspaceFiles`, so a call never touches
  the filesystem. Its workspace reference is an opaque absolute POSIX path,
  such as `/tenants/<tenant>/workspaces/<id>`. It offers workspace setup, job
  briefs, applications and runs; other methods refuse until an issue needs
  them. It never imports a Postgres or Cloud Storage package.
- Exported documents go through a blob port, read and checked by content
  checksum. The local filesystem implementation keeps today's export paths;
  `packages/storage-gcs` implements the same port on Cloud Storage for the
  server.
- Managed candidate-knowledge files go through a managed-file port, keyed by
  source and version and checked against the recorded checksum and size.
  Intake stages and verifies the bytes, then publishes them without ever
  replacing an existing file, or rolls them back. Deletion stages a knowledge
  base's files away from their keys, then commits by removing them or restores
  them. Store-open recovery and the unknown-entry inventory use the same port.
  Portable backup and the local file-path lookup stay filesystem-only, since
  they exist only in the local version.

## Postgres and the hosted driver

- A conformance suite, exported as `@draft-loop/storage/conformance`, checks
  the contracts any implementation must honour. It runs against SQLite in
  `pnpm test`.
- `packages/storage-postgres` is the hosted implementation. It joins the suite
  one contract group at a time and now passes the history, versioned-record,
  application, knowledge-base, lexical-retrieval and vector-index groups. It shares these
  rules with SQLite, so both stores accept, hash, chain and audit records the
  same way and differ only in their queries:
  - audit-trail hashing, from `@draft-loop/storage/audit-trail`;
  - run-record rules, from `@draft-loop/storage/history-records`;
  - versioned-record chain rules, from `@draft-loop/storage/versioned-records`;
  - knowledge-source version rules, from `@draft-loop/storage/candidate-knowledge`;
  - lexical-index and retrieval-trace rules, from
    `@draft-loop/storage/candidate-knowledge-lexical`.
  - vector-index validation, staleness and hit ranking, from
    `@draft-loop/storage/knowledge-vector-rules`.
- Postgres ranks lexical hits with `@draft-loop/storage/lexical-ranking`, which
  tokenizes text as FTS5's `unicode61` tokenizer does and computes FTS5's
  `bm25()` in the application over chunks Postgres selects through a GIN index
  (ADR 0011, D11). Parity tests check it against FTS5 directly and against the
  SQLite store, so both stores return the same chunks, order and scores.
- Postgres stores embedding vectors as pgvector `vector` values and ranks a
  knowledge base's vectors exactly, in the application, with the shared rules.
  It has no approximate (HNSW) index: a single person's knowledge base is small,
  and exact ranking keeps hits and scores identical to the local index.
- Postgres keeps workspace settings as one row per document, keyed by the
  driver's workspace reference and the document name. It passes the same
  `workspace-settings` conformance group as the local files.
- `openPostgresCandidateKnowledgeStore` opens one tenant's candidate knowledge
  store for runs. It reads records and projections from Postgres and source
  bytes from blob storage, checked against each version's checksum and size,
  and offers a run's operations only.
  - Postgres records the store, which versions the service holds bytes for and
    where, and the versioned sensitivity rules, hashed as the local store
    hashes them.
  - A hosted file source has no local origin to refresh from: its origin is
    the upload, so it is ready once its latest version's bytes are held.
- `hostedWorkspaceHistory` presents one tenant's Postgres storage as the
  hosted driver's workspace history. The orchestrator's run state (snapshots,
  step executions and artifacts) lives in `run_state_entries`, its key-value
  port. The legacy local evidence folder and semantic retrieval traces refuse,
  since hosted runs take evidence from candidate knowledge bases.
- `hostedApplicationPorts` gives the hosted driver its ports over one
  tenant's Postgres and blob storage, and `hostedWorkspaceReference` and
  `hostedKnowledgeStoreReference` build the references it addresses. The
  worker composes them per job, for the tenant the job names (see below).

## Tenant isolation

- The API serves each request from its caller's tenant (ADR 0011, D6): a
  member acts in their organisation, and the owner token in
  `DRAFT_LOOP_TENANT_ID`'s tenant.
  - It shares one pool, one run queue and one bucket among tenants, and
    composes a tenant's application on its first request, with its blobs under
    the tenant's prefix. The 100 most recently used stay composed.
  - A `preHandler` hook binds the tenant's application to the request's async
    context, and the routes' dependencies forward each call to it
    (`registerTenantApplications`). A route that runs with no tenant bound
    fails with a server error rather than reach a default tenant.
  - Idempotency keys belong to the tenant: Postgres keeps them under row-level
    security, and the memory store scopes them by tenant.
  - Request logs carry the tenant and member ids, never an email or token.
  - In sign-in mode a member reaches only the candidate records assigned to
    them, and owners and admins every record of their organisation. One hook
    after tenant binding checks every route that names a workspace, and a
    refused record answers 404 like an unknown one (`registerRecordAccess`,
    over the tenants' `recordAccessFor`). Creating a workspace assigns its
    creator before the workspace is saved, and when several members create the
    same new record at once storage assigns only one (`assignCreator`); the
    others get the usual 404. `GET /v1/workspaces` lists the records the
    caller reaches.
  - Owners and admins assign members to a record and remove them through
    `/v1/workspaces/{workspaceId}/members`, which an assigned member may only
    read; each change is a content-free audit log line
    (`registerRecordMemberRoutes`).
  - In sign-in mode each knowledge base belongs to the candidate record named
    when it is created, and reaching it follows that record's access. A member
    whose records do not own a base gets the 404 of an unknown base on its
    sources, rules and uploads; listing shows only reachable bases; and a
    workspace selects only its own bases (`registerKnowledgeAccess`, over the
    tenants' `knowledgeOwnersFor`).
  - In owner-token mode a base created for a workspace belongs to it too, so
    erasing the workspace erases the base, a workspace lists only its own
    bases, and no workspace selects another's (`registerOwnerTokenKnowledge`,
    #1758). The owner token still lists every base of the tenant.
  - A flow test takes two organisations from creation through sign-in, setup,
    a run on the scripted model gateway, approval and export, and checks that
    neither organisation's material reaches the other's provider requests,
    export or listings (`apps/worker/src/tenancy-flow.test.ts`).
  - A second flow test takes one organisation with an owner and two coaches,
    each assigned to their own candidate record. Each coach reaches only their
    record and its material, an upload and a run wait for the matching
    consent, each run sends only its own candidate's material, and a
    withdrawal stops the next run (`apps/worker/src/coaching-flow.test.ts`).
  - A third flow test gives one organisation two records, each with its own
    material, consents, run and export. Each record's archive holds only its
    own material; erasing one leaves no row or stored object of it while the
    other still exports and runs; and deleting the organisation leaves
    nothing of the tenant (`apps/worker/src/erasure-flow.test.ts`).
- Postgres isolates tenants in shared tables (ADR 0011, D3):
  - every table carries `tenant_id`, and every key and foreign key includes
    it, so tenants can reuse ids;
  - one pool serves many tenants: `openPostgresTenancy` hands out a tenant's
    ports with `forTenant`, and each transaction sets the transaction-local
    `draft_loop.tenant_id`, which fills `tenant_id` on insert, so the pool
    never grows with the number of tenants;
  - tenant ports borrow the pool and have no close; the tenancy closes it.
    `openPostgresStorage` opens one tenant over a pool of its own;
  - forced row-level security compares that setting on every read and write,
    and the store refuses to open as a superuser or `BYPASSRLS` role;
  - migrations run separately as the schema owner (`migratePostgresStorage`),
    and `grantPostgresStorageAccess` gives the runtime role table access only.
- `createPostgresTenantDirectory` records organisations and their members
  behind the `TenantDirectory` port from `@draft-loop/storage/tenant-directory`
  (ADR 0011, D6):
  - an organisation's id is its tenant id, and its members have the role
    `owner`, `admin` or `member`; an organisation always keeps an owner;
  - a member is invited by email and becomes active on the first sign-in
    with that verified email, which binds the issuer and subject; later
    sign-ins resolve by them, and a person belongs to one organisation;
  - both tables are under row-level security like the rest. Resolving a
    sign-in is the one cross-tenant read: it goes through
    `resolve_member_sign_in`, a `SECURITY DEFINER` function owned by the
    migrating role, and the runtime role may only execute it.
- Each tenant's `candidateRecords` port records which members are assigned to
  which candidate records, behind `CandidateRecordAccess` from
  `@draft-loop/storage/candidate-records` (ADR 0011, D6). A candidate record is
  a workspace in the tenant, named by its API id, which the API checks exists;
  assignments sit under row-level security and go when the member does.
- Each tenant's `knowledgeBaseOwners` port records the one candidate record
  that owns each knowledge base, behind `KnowledgeBaseOwners` from
  `@draft-loop/storage/knowledge-base-owners`. An owner is set once, and goes
  with its base. When the API cannot record the owner of a base it just
  created, `removeUnowned` deletes the base, so none is left unreachable.

## Blobs on Cloud Storage

- `packages/storage-gcs` passes the `blobs` group, which the filesystem
  implementation also runs (ADR 0011, D3):
  - a blob's location is its full object key, and every operation refuses a
    key outside `tenants/<tenantId>/`;
  - put stores the content's SHA-256 as object metadata; reads use it to skip
    replaced objects, then download that exact generation and hash it;
  - delete names the generation it verified, so a concurrent write survives.

## Testing and running the stack

- `pnpm test:postgres` runs the Postgres suites against the server named by
  `DRAFT_LOOP_TEST_POSTGRES_URL`, including the run queue's, the worker's and
  the API's idempotency store, and `pnpm test:gcs` runs the Cloud Storage
  suites against the emulator named by `DRAFT_LOOP_TEST_GCS_URL`. The CI `Server storage` job runs both, against
  Postgres 16 with `pgvector` and the `fake-gcs-server` emulator.
- Locally, `pnpm server:up` starts Postgres, the emulator, the API and one
  worker with Docker Compose. `pnpm server:test` runs both suites and an
  end-to-end smoke that sets up a workspace, its knowledge and a reviewed job
  brief through the API only, begins a run and reads it back once the worker
  has drafted it; see the
  [local server stack](../operations/local-server-stack.md).
- `deploy/local/compose.yaml` runs the same services for real use on one
  machine: the `direct` model routes with the operator's key files or a local
  model, files on disk and generated secrets; see the
  [self-hosted server](../operations/self-hosted.md).

## Run history

SQLite migration 26 preserves the artifact-history boundary: each immutable
artifact ID may begin its own version-1 lineage, later rows link by parent
version, and dependent run, execution, finding, decision, and export references
remain valid. The migration rebuilds the version table transactionally,
recreates immutable update/delete triggers, and validates the foreign-key graph.
The application checks workspace and context identity, rejects missing or
conflicting ancestors, then projects checksum-verified ancestry from durable
run snapshots parent-first and idempotently before inserting the latest
artifact, including earlier round records. Resume can complete an
already-reviewed projection without another provider call or changing earlier
snapshots.

Run snapshot rows are slim: each references its executions (ids plus a checksum
over their contents) and its draft (id, version, checksum) instead of embedding
them, so a row stays small as a run grows. The execution records and the draft
are stored once under the run store's keys, and `resolveSnapshotPayload` in the
orchestrator is the single reader that rebuilds a snapshot from a row, verifies
the checksums, and passes older full rows through unchanged.

`workspace compact` shrinks a workspace written before that shape. The immutable,
hash-chained history file is never edited in place: a verified backup is kept, a
copy is rewritten (legacy rows slimmed, snapshot events turned into references, the
chain recomputed and a `workspace.history-compacted` event naming the old head),
checked, and swapped in. The old chain survives whole in the backup.
