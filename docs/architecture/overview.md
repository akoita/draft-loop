# Architecture

DraftLoop is a local-first, multi-model drafting and review workspace. The
first artifact is a job-specific CV, but the contracts are shaped around a
reusable workflow: canonical requirements and evidence produce an artifact,
an independent critic evaluates it, and a human approves the result. A hosted
client-server version is being built on the same packages
([ADR 0011](../adr/0011-client-server-version.md)).

## Boundaries

![System boundaries: the candidate uses the CLI or the desktop renderer, which reaches the Electron main host through a frozen preload bridge; both call shared application contracts over a provider-independent core; local stores, provider adapters, and the credential store sit beneath it; and only approved transmissions, validated URL requests, approved local intake, and approved artifacts cross external boundaries.](../assets/system-boundaries.svg)

Solid arrows show application data or control flow. The dotted credential edge
is lookup-only: stored keys are never projected to the renderer. Network and
export edges require visible approval. The solid CKB edge covers the explicit
file, URL, and bounded-directory commands documented in
[Candidate evidence](candidate-evidence.md). It also represents exact selected
source-version lexical retrieval through the CKB-owned index; selection is
explicit and does not imply implicit workspace access. See the [CKB integration
status](candidate-evidence.md#ckb-integration-status) for remaining limits.

The renderer receives bounded projections for workspace and run state. Native
dialogs, workspace paths, SQLite handles, credential persistence, provider SDK
construction, URL fetching, and export writes remain in the main process. The
renderer can submit an API key only through the allowlisted credential command;
the host validates it and owns encryption, status, removal, and environment
fallback. Browser mode has no native filesystem or persistent credential
capabilities and keeps a deterministic fixture fallback. See [ADR
0004](../adr/0004-desktop-credential-boundary.md).

## Package and data ownership

| Boundary                                         | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Does not own                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `packages/domain` and `packages/schemas`         | Framework-free concepts, workflow states, and Zod validation at persistence/exchange boundaries                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Provider SDKs, storage engines, or UI frameworks                                           |
| `packages/ingestion` and `packages/evidence`     | Approved local/URL intake, extraction, normalized material, provenance, and source references                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Application selection or provider transport                                                |
| `packages/orchestrator`                          | Author–critic sequencing, budgets, pause/stop, recovery, and user-visible run events through ports                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Provider-specific SDK calls                                                                |
| `packages/validation` and `packages/evaluations` | Deterministic checks, rubric findings, and structured critique records                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Proof of truth independent of candidate evidence and human decisions                       |
| `packages/artifacts` and `packages/rendering`    | Approved structured output and local Markdown/DOCX/PDF rendering                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Submission or publishing                                                                   |
| `packages/storage`                               | Workspace history and portable CKB persistence, including managed bytes, derived lexical and vector projections, and local-only state                                                                                                                                                                                                                                                                                                                                                                                                                              | CKB selection, retrieval policy, or UI                                                     |
| `packages/storage-postgres`                      | The Postgres implementation of the storage ports for the hosted service, its SQL migrations, and its audit-chain writes                                                                                                                                                                                                                                                                                                                                                                                                                                            | Desktop or CLI wiring, provider calls, or object storage                                   |
| `packages/storage-gcs`                           | The Cloud Storage implementation of the blob port for the hosted service: tenant-prefixed keys, checksum metadata and verified deletes                                                                                                                                                                                                                                                                                                                                                                                                                             | Desktop or CLI wiring, encryption keys, or bucket provisioning                             |
| `packages/model-gateway`                         | The hosted service's model routes: a Claude on Vertex AI client limited to EU locations and listed models, Vertex pricing, the `vertex-ai` route in run history, the opt-in Claude API fallback, the OpenAI EU client, Secret Manager keys and the Claude Haiku 5.5 screener that classifies untrusted text for prompt injection                                                                                                                                                                                                                                   | Desktop or CLI wiring, author or critic prompts, or provider keys in images                |
| `packages/run-queue`                             | The hosted service's durable run queue on Postgres (pg-boss): ids-only job payloads, one waiting job per run, retry and heartbeat settings, queue migrations and runtime grants; also the brief extraction queue, one job per brief version, and the profile derivation queue, one job per profile with content-free progress and cancel                                                                                                                                                                                                                                                                                                                                                                                    | Run execution, candidate material in payloads, or desktop and CLI wiring                   |
| `packages/embeddings`                            | Local text-embedding runtime, pinned model manifest, and vector normalization behind the `TextEmbedder` port                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Model download, vector persistence, retrieval policy, or provider calls                    |
| `packages/ui`                                    | The screens the desktop and the web share (Home, application steps, brief review, model presets, review, Run details) and the capability port they reach their host through: typed commands, typed results and the list of commands the host supports, plus the projections both hosts run on their answers, such as a job brief's or a career profile's view                                                                                                                                                                                                                                                                                                              | Electron, Node built-ins, provider SDKs, server packages, or a host implementation         |
| `packages/review-state`                          | The host-side projection of a run into the shared screens' review state, called by the desktop host and the hosted API with their own inputs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Browser bundles, storage engines, or provider calls                                        |
| `packages/providers`                             | Provider identity, SDK translation, policy enforcement, and model calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Domain workflow decisions                                                                  |
| `packages/application`, CLI, and desktop host    | Adapter-neutral use cases and shared user-facing contracts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | A second domain layer or provider SDKs in the UI                                           |
| `apps/api`                                       | The hosted service's HTTP adapter over `ApplicationService`: Zod-typed `/v1` routes for workspace setup, workspaces, knowledge bases, job briefs, applications, runs and their review, path-free projections, idempotent run starts that queue the run for a worker, the committed OpenAPI document, request authentication (the owner token, or identity-provider sign-in tokens resolved to an organisation and role), serving each request from its caller's tenant, organisation membership and operator routes over the tenant directory, and the error shape | Domain logic, storage engines, or provider calls                                           |
| `apps/worker`                                    | The hosted service's run executor: claims queued runs, resumes each through `ApplicationService` from its last saved step, requeues a usage- or rate-limited run for when the limit allows, and stops within Cloud Run's shutdown notice. It also extracts a queued live brief from its application's kept job text, only while the brief is at the queued version and the text matches its checksum, and derives a queued career profile from the workspace's selected evidence, stopping within seconds of a cancel                                                                                                                                                                                                                                                                                                                           | Domain logic, provider calls outside the application service, or job payloads with content |
| `apps/page-fetcher` | The hosted service's only runtime that reaches public web servers: one `POST /v1/fetch` hop of an approved job page per request through the pinned fetcher, answering the hop's status, content type, redirect target and at most one byte past intake's limit, and logging the host only. Cloud Run's IAM check decides who may call it | A database, secrets, candidate material, text extraction, or following redirects |
| `apps/web`                                       | The owner's browser screen over the `/v1` API, served by the API on the same origin: sign-in with the owner token or, in `oidc` mode, through the identity provider (authorization code with PKCE), kept in the tab, and a client typed from the committed OpenAPI document. In `oidc` mode it lists the caller's candidate records, switches between them and lets owners and admins assign members, export a record's archive and delete a record. Its Run step shows the organisation's credit balance with the 80% warning, the run's credit estimate beside the start button and a plain message for each plan refusal (`credits_insufficient`, `model_tier_not_in_plan`, `plan_required`, `run_cap_reached`, `plan_limit_reached`); the balance stays hidden with the owner token, which keeps one workspace. Each record opens on the desktop's shared Home and New application screens (`shared-screens.tsx`), which hide what the hosted service does not offer: closing the workspace and provider sign-in. An attached job file goes to the API's `applications/from-file` route, which keeps only its text; a job page address goes with the person's approval, and the API fetches the page once when requirements are extracted. The run's review, approval and export happen on the shared review screen, with its run details and the comparison between an application's runs. The earlier steps stay one click away, as “Consent, rules and credits”, for what the shared screens do not show yet: the workspace form, consent, sensitivity rules and the Run step's credits. Its HTTP bridge (`http-bridge.ts`) answers the shared screens' workspace model, writing policy, application, brief, run, review-load and model catalog commands over the API, and advertises nothing else. Its profile bridge (`profile-bridge.ts`) derives the career profile on the worker, waiting for it with progress and cancel, then reads, edits and reviews it, so a run binds a reviewed version as on the desktop. Its review actions (`review-actions.ts`) start a run from the application's reviewed brief and an optional reviewed profile, then decide findings, edit blocks, approve, ask for a revision, pause, resume, stop and export through the review routes, reading the review state again after each. An export is downloaded by the browser under the name the review state then shows (`@draft-loop/ui/export-file-name`), Modern unless another template is chosen; autopilot and provider recovery are refused for now. Career evidence (`knowledge-bridge.ts`) uploads a file from the browser's picker, lists only the bases the record owns and selects one, in one store per tenant; folders, URLs and store switching stay hidden                                                                           | Domain logic, imports of `apps/api` or server packages, or provider calls                  |

## Key flow

The CLI and desktop host call the shared application contracts. Those contracts
assemble approved local inputs, selected evidence, and immutable context
snapshots before handing provider-independent work to the orchestrator. The
orchestrator coordinates authoring, independent critique, bounded revision,
deterministic checks, approval, and local export through ports.

The provider adapters are the only model-facing boundary. They enforce the
approved data policy and record provider and model identity. The application
and storage boundaries retain path-free run references, evidence links, typed
findings, artifact history, and user decisions without storing hidden
chain-of-thought or raw provider payloads.

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
- `packages/storage-gcs` passes the `blobs` group, which the filesystem
  implementation also runs (ADR 0011, D3):
  - a blob's location is its full object key, and every operation refuses a
    key outside `tenants/<tenantId>/`;
  - put stores the content's SHA-256 as object metadata; reads use it to skip
    replaced objects, then download that exact generation and hash it;
  - delete names the generation it verified, so a concurrent write survives.
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

The hosted service starts runs through a queue rather than in the request
(ADR 0011, D4):

- `POST /v1/workspaces/:id/runs` begins the run, which saves it without a
  provider call, then queues its ids in `packages/run-queue`. A request that
  saved the run but could not queue it answers 503, and a retry with the same
  `Idempotency-Key` queues the saved run.
- A live workspace's brief made from an application's job text is saved
  without extraction. Once injection screening clears that text,
  `POST /v1/workspaces/:id/opportunities` queues its extraction on the same
  queue's brief extraction queue, and the brief's view says `extraction:
  pending` until the worker saves the extracted next version (or `failed`). A
  flagged or unscreened text is never queued, and a fixture workspace's brief
  is extracted as it is saved. The shared setup card says the requirements are
  being read and reads the brief again every few seconds until they arrive.
- The career profile is derived on the worker too, from the workspace's
  selected evidence with the desktop's extractor, sensitivity exclusions and
  provider approval (a fixture workspace calls no model). Its job carries ids
  and the person's choices only; the worker records content-free progress
  (calls done of calls planned), a cancel stops it before its next provider
  call, and the job keeps how it ended: the saved version, or a fixed message
  the person can act on.
- `/v1/workspaces/:id/profiles/:profileId/derivation` starts (POST), reads
  (GET) and cancels (DELETE) that derivation; a start needs the record's
  transmission consent in sign-in mode. The profile's own routes read, list,
  edit, review and check freshness through `ApplicationService`, and a run
  start's optional `candidateProfile` binds a reviewed version as on the
  desktop. The hosted history records no retrieval origin traces yet, so a
  hosted run with a profile retrieves the same evidence and traces none.
- Its optional `modelProfiles` binds exact author and critic profile versions
  to that run, such as a preset's pair, as the CLI and the desktop do. Without
  them the run uses provider-default runtime controls and unknown context
  windows, so a full-source request over the default budget falls back to
  retrieval. A pair the registry refuses answers 422.
- In sign-in mode the run must also fit the organisation's plan and credits
  (ADR 0011, D13), checked after the budget ceiling, screening and consent by
  `entitlement-gate.ts`. Owner-token mode skips it: its tenant has no
  organisation row to hold a plan or a ledger, so nothing there is refused or
  metered. The refusals are, in order:
  - 403 `plan_required`: the organisation has no plan yet.
  - 422 `model_tier_unknown`: a model's tier cannot be determined (`role`).
  - 403 `model_tier_not_in_plan`: the plan lacks a model's tier (`role`,
    `tier`).
  - 429 `run_cap_reached`: the plan's concurrent or daily run cap is reached
    (`cap`, `limit`).
  - 402 `credits_insufficient`: the balance does not cover the estimate
    (`estimate`, `remaining`).

  These answers carry codes, a role, a tier and numbers only. The tiers come
  from the application's own pair, else the request's `modelProfiles`, else the
  workspace's configured models, as `resolveRunCreditTiers` reads them, and the
  estimate is `estimateRunCredits` at the workspace's round limit.
- The gate reserves the estimate before the run is saved. It picks the run id,
  reserves under the ledger's lock (credits and caps together, so concurrent
  starts cannot overspend), then passes the id to `begin` (`runId` on the
  begin command). A refusal therefore saves nothing, and a `begin` that fails
  refunds the reservation. All of it runs inside the `Idempotency-Key`'s one
  execution, so a replay reserves nothing more. A reservation stays after a
  queueing failure, since the run is saved. A process that dies between the
  reservation and the save leaves one open reservation, which the worker's
  reconciliation releases (next item).
- `GET /v1/workspaces/:workspaceId/runs/estimate` (`credit-routes.ts`) says what
  a run on the workspace's current settings would reserve: `credits`,
  `estimateVersion`, the tiers and the round limit it assumed. It prices with
  `priceRun` (`run-pricing.ts`), the function the gate itself uses, so a member
  sees the number the gate reserves. `?applicationId=` prices an application's
  own pair. It refuses nothing and works in both modes; a model whose tier is
  unknown answers 422 `model_tier_unknown`. In sign-in mode a member also gets
  `plan` (whether the plan allows the tiers, with the code the gate would
  answer) and `balance` (whether `remaining` covers the estimate).
- `GET /v1/organisation/credits` (sign-in mode, any role) answers the plan id,
  the entitlements a member needs (`modelTiers`, `runsPerDay`,
  `concurrentRuns`, `seats`, `candidateRecords`) and the period's `allowance`,
  `used`, `reserved`, `grantsRemaining`, `remaining`, `periodStart`, `periodEnd`
  and `unlimited`. An organisation with no plan gets 403 `plan_required`;
  owner-token mode answers 404.
  - **`used`** is the credits of the period's allowance that finished runs
    settled plus the part of `reserved` taken from the allowance, so a started
    run counts at once. Operator grants are not counted, and `reserved` is the
    total held from both.
  - **`warning`** is true once `used` is at least 80% of `allowance`. It is
    never true on an unlimited plan or a zero allowance, which answer `null`
    for `allowance` and `remaining`.
- The gate logs two content-free `WARNING` lines when a new reservation crosses
  a threshold: `credit allowance 80% used` and `credit balance exhausted`. The
  ledger returns the balance just before and just after the reservation, read
  under its lock, so racing starts cross a threshold once. A line carries
  `organisationId`, `periodEnd`, `allowance`, `used` and `remaining`, and is
  written once the run is saved: a start refused or refunded writes nothing.
  Because the ledger holds no flag, a refund that brings the balance back under
  a threshold followed by a new reservation can cross it again. Unlimited plans
  and a zero allowance never log the 80% line.
- The worker closes each reservation, in `run-credit-settlement.ts`, after a
  job leaves its run in a final state. The ledger acts once, so a retried or
  replayed job settles once.
  - **Settle** when the run has a draft: `awaiting-approval`, `approved`,
    `exported`, `stopped` or `provider-error` with an artifact.
  - **Refund** when the run ended in one of those states without a draft, or
    when its job was dropped for an erased record or a missing run.
  - **Keep** while the run can continue: a user pause, a usage-limit pause, a
    failure waiting for the worker's retry, a consent or quarantine hold, or a
    step in flight. A job for a run with no reservation, as in owner-token mode,
    does nothing.
  - **No free run.** Only the worker retries a `provider-error` run, and the
    shared screen offers no retry by hand there: it says the service retries
    the step, or that a new run is needed (#1764). A repeated begin request
    still queues its run again. A job whose run has a
    refunded reservation therefore ends as `credits-closed` without a
    provider call.
  - **Reconciliation.** After each job the worker reads that tenant's open
    reservations older than an hour and compares them with their runs: no
    saved run (a crash between reservation and save, or an erased record) is
    refunded, and a run that finished with no job to say so, such as a paused
    run the person stopped, is settled or refunded as above. It runs per
    tenant, since the ledger does, so a tenant's orphan is found when the
    tenant next has a job.
  - **Known limits.** Erasing a record does not close the reservation of its
    paused runs at once; the reconciliation does within the hour after the
    tenant's next job. A run above the deployment's ceiling keeps its
    reservation. Rounds a person adds after the run reached its first draft
    are not charged again.
- Idempotency keys live in Postgres (`idempotency_keys`, under row-level
  security), so every API instance replays a key's first result for a day. A
  retry that arrives while the first request still runs waits up to five
  seconds, then answers a retryable 409 `idempotency_in_progress`; it never
  runs the command again. A request that stopped without a result frees its
  key after a two-minute lease, and each new key removes up to 100 expired
  ones.
- The queue keeps at most one waiting and one active job per run, so repeated
  requests collapse, and a paused run can queue its resumption while the
  paused attempt finishes.
- `apps/worker` claims a job, reads the run, and resumes it only when its
  state allows: a run the person paused, one awaiting approval, or one
  finished is left alone, so a duplicate or late job does nothing.
- One worker serves every tenant. It opens one `openPostgresTenancy` pool and
  one bucket at startup; for each job, `tenantServices` composes the
  application over `forTenant(job.tenantId)` and that tenant's blob prefix.
  Composition only wraps the shared pool and model routes, so nothing is
  cached between jobs or carried from one tenant's job to another's.
- A run paused on a provider usage limit is queued again for the reset time
  (15 minutes when the provider names none) and resumed then.
- A run stopped by a retryable failure is queued again and retries while its
  step has attempts left (#1763). The failures are a rate limit, a timeout, a
  provider fault and an output DraftLoop rejected. A rate limit waits at least
  a minute, the others at least 10 seconds, or later if the provider asks. An
  authentication or credit failure waits for the operator.
- A job that fails or stops sending heartbeats, as after a crash, is retried
  with backoff, and the worker resumes the run from its last saved step.
- On SIGTERM the worker stops claiming and gives the job in flight 8 seconds.
  It never cancels a step, which would record the run as cancelled; a step
  still running is failed back to the queue and repeated by the retry.
- Queue migrations run as the schema owner (`migrateRunQueue`), and
  `grantRunQueueAccess` gives the runtime role table and function access only.

Every provider call records its route beside its company and model, such as
`anthropic-api`, `vertex-ai` or `openai-api`, so a change of endpoint is never
silent (ADR 0011, D5). Run status in the CLI and the API lists each step's
routes. For the hosted author, `packages/model-gateway` reaches Claude on
Vertex AI:

- Only an EU location is accepted: the `eu` multi-region or a `europe-*`
  region. The endpoint is set explicitly, never from the environment.
- Authentication uses the runtime's service identity, so no long-lived key
  exists.
- Only listed models are called, under their first-party ids; any other model
  is refused rather than replaced.
- Cost estimates apply the location's price factor, which the deployment takes
  from Google's price list.
- The content screener (`createHostedContentScreener`) classifies untrusted job
  and candidate text with Claude Haiku 5.5 on this route. It sees the text only
  inside a delimited block of the user turn, answers with closed signal codes,
  fails closed on any route or answer error, and reports each call's usage and
  cost through `onUsage` for the caller to record against the tenant.

`createRoutedAdapter` applies the deployment's route policy. The direct Claude
API is an optional fallback, off unless the deployment turns it on, because it
processes material outside the EU. A call falls back only when its model is
not offered on the primary route or the deployment may not use it there, such
as a project whose billing account cannot buy Claude on Vertex AI
(`model-not-offered`), or the route still refuses after the adapter's retries
(`route-unavailable`). It never falls back
on content, policy, authentication or budget errors. A fallback keeps the
company and the model, and run history records the route it left and why.

Provider keys come from Secret Manager at call time, never from an image or an
environment file. `createSecretManagerCredentialResolver` reads the secret
version the deployment names for each key: OpenAI's key for the critic, and the
Claude API key only when the fallback is on, since Vertex AI needs none. A key
stays in memory for five minutes, so a rotated key takes effect without a
restart. A failed read names only the provider, never the value or the
client's error.

`apps/worker` composes these routes at startup from its settings, listed in
the [local server stack](../operations/local-server-stack.md#model-routes)
guide. The author's Anthropic models go through `createHostedAnthropicRoute`,
which the shared driver takes as `providerClientFactories.anthropicRoute`. The
critic's OpenAI client targets the EU endpoint. Without these settings, as on
the local stack, the worker knows no key, so only fixture runs work.

`apps/api` never drafts or reviews with a model. Its driver resolves no key and
refuses to build any provider client (`apiProviderOptions`), whatever its
environment holds, so only the worker reaches a provider for a run. The one
model call the API makes is the opt-in injection screener, described under
[Intake screening](#intake-screening).

Each hosted deployment sets a ceiling per run: rounds, cost and duration, all
required. A workspace without a cost or duration limit gets the ceiling's
(`withRunBudgetDefaults`). Beginning a run whose workspace asks for more than
the ceiling answers 422 `budget_above_ceiling` and names the limit to change,
and the worker re-checks each run's saved budget before it executes, so a
lowered ceiling also holds for runs already queued.

A cost limit holds only while every call is priced. When a call on a metered
route returns no cost estimate, a run with a cost limit stops as
budget-exhausted. Subscription sessions, local models and fixtures are
unmetered and exempt.

The owner reads usage from the API, in counts and amounts only:

- `GET /v1/workspaces/:id/runs/:runId/usage` sums one run's completed calls by
  company, model and route: calls, input and output tokens, and estimated
  cost. It counts the application plan's calls, which the plan step records
  apart from the run's executions.
- `GET /v1/usage?month=YYYY-MM` gives the tenant's totals for a UTC month in
  the same shape, summed in Postgres under row-level security.
- Calls without a cost estimate are counted as `unpricedCalls`, never as zero
  cost.

The owner sets up a hosted workspace through the API before any run:

- `PUT /v1/workspaces/:id` creates the workspace with its language, author and
  critic models, run limits, fixture mode and autopilot. Only Anthropic and
  OpenAI models are accepted, because the gateway routes only those, and a
  budget above the deployment's ceiling answers 422 before anything is saved.
  The request names no file or folder, and an existing workspace answers 409
  instead of being overwritten. `GET /v1/workspaces` lists the workspaces the
  caller can reach.
- A side the request leaves out gets the hosted default, the Balanced preset:
  Claude Sonnet 5.5 as the author and GPT-6.1 Sol as the critic. The desktop
  keeps the cheaper Economy pair as its own default.
- `PATCH /v1/workspaces/:id/models` changes the author and critic for the
  next runs, Anthropic and OpenAI only. A pair from one lineage needs
  `independenceOverrideRationale`, and a change while a run is executing
  answers 422; recorded runs keep the pair they ran with.
- `GET /v1/model-catalog` lists the catalog's model profiles the gateway
  serves, with their tier, roles and list prices, the presets whose author and
  critic it both serves, and the default preset (`hosted-model-catalog.ts`).
  Desktop-only companies and local models are left out.
- `PUT /v1/workspaces/:id/writing-policy` sets the candidate's writing policy
  from its Markdown text, at most 64 KiB, as a new immutable version that the
  next runs follow and record. `GET` reads the active policy, and
  `GET .../versions` lists the versions without their text. The server never
  reads a policy file a client names.
  `GET /v1/writing-policy-template` reads the template an editor starts from
  when a workspace has none, and saves nothing.
- `PATCH /v1/workspaces/:id/opportunities/:briefId` saves an edit of a job
  brief as a new draft version, from a patch of its editable fields in their
  brief shape. Its `expectedVersion` must be the latest, or the edit answers
  409 `brief_version_stale`, as a review of a stale version does.
  `GET .../versions` lists each version's number, status and dates.

The owner manages a workspace's job applications through the API
(`application-lifecycle-routes.ts`), as the desktop does:

- `POST /v1/workspaces/:id/applications` creates one from a name and pasted job
  text. The hosted service keeps that text in the application's record, never
  in a file, and `GET .../applications/:applicationId/job` reads it back.
- The same route takes a job page address instead, with `jobUrlApproved: true`
  as the person's approval to fetch it. Nothing is fetched then; the job reads
  back as that address.
- The page is fetched once, when requirements are extracted: the brief's
  `approved-url` source must be the application's approved address. The
  fetcher connects only to an address it checked (`job-page-brief.ts`, over
  `@draft-loop/ingestion`'s pinned fetcher). A deployment's API has no route
  to the internet, so it makes each hop through `apps/page-fetcher` when
  `DRAFT_LOOP_PAGE_FETCHER_URL` is set (#1837), and still checks every
  redirect and bounds the page itself. It waits 25 s for each hop, past the
  fetcher's own 15 s limit on the site and its cold start (#1853), so a slow
  site is reported by the fetcher's own timeout. A page it cannot read is refused
  with 422 before a brief is saved, and the brief records the original and
  final address and the fetch time. The page's text is kept with the
  application for the worker's extraction and screened like pasted job text
  before the worker's model sees it.
- `POST .../applications/from-file?name=<name>&fileName=<file name>` creates
  one from a job description file sent as the raw body: a PDF, DOCX, Markdown
  or plain text file within the career-evidence upload limit
  (`application-file-routes.ts`). The API reads the file's text as it reads
  career evidence and keeps that text as if it were pasted; the file is not
  stored.
- `PATCH .../applications/:applicationId` renames, archives or restores one,
  and an unknown application answers 404.
- `PUT .../models` sets or clears an application's author and critic pair, and
  `PUT .../chosen-run` chooses the run whose draft it uses.

The shared screens open on a review state the server projects
(`review-state-routes.ts`), with the same `packages/review-state` code the
desktop host calls:

- `GET /v1/workspaces/:id/review-state` returns the run on screen with its
  draft, findings, decisions and edits, and the workspace's readiness for the
  next run. `applicationId` scopes it to one application's newest run, and
  `runId` names an earlier one; a run the application does not hold answers
  404.
- With an application, the state carries the run details and the comparison's
  run list as the desktop shows them: each run's recorded author and critic
  models, round, state and score (`@draft-loop/review-state/application-runs`),
  plus the run's evidence mode and what its latest author step was sent.
- Readiness reads the application's pasted job or reviewed brief, the selected
  knowledge bases' sources and the writing policy. Without a run the state is
  the start state, with `runId` `pending`.
- The provider preflight names the gateway's routes and reads as acknowledged,
  because the server itself refuses a provider call without recorded consent.
- The web's HTTP bridge answers `review.load` from this route, and the port
  validates every field as it does the desktop host's.

Candidate sources reach a hosted knowledge store through
`createHostedKnowledgeIntake` in `packages/application`, over the storage ports
and the blob port:

- A tenant has one knowledge store, created with its first knowledge base,
  because knowledge bases belong to the tenant.
- A source file is a PDF, DOCX, Markdown or plain text file of at most 10 MiB by
  default. Its type is checked by its signature only: the service never parses
  an upload to store it (ADR 0011, D11), and the run worker extracts the text
  from the stored bytes. The API reads an upload's text once more, only to
  screen it (see [Intake screening](#intake-screening)).
- The bytes go to the tenant's blob prefix first, then the source and its
  managed version are recorded, so a recorded version always has its bytes.
  The same bytes in the same knowledge base return the existing source.

The owner manages that knowledge through the API, never naming a store or a
storage location:

- `POST /v1/knowledge-bases` creates a knowledge base, and `GET` lists them.
- `GET /v1/knowledge-bases/:id/sources` lists a base's sources with their
  latest file's name, media type, size, checksum and date, never its content.
- `POST /v1/knowledge-bases/:id/sources?name=<file name>` uploads one source
  file as the raw request body, with its media type as the `Content-Type`.
  Another type answers 415, a file over the limit 413
  (`DRAFT_LOOP_MAX_SOURCE_BYTES`), and the same bytes again 200 with the
  existing source, so a retry is safe. The answer carries the upload's
  `screening`. Every other route keeps parsing JSON.
- `GET /v1/knowledge-bases/:id/sensitivity-rules` lists a base's sensitivity
  rules, `POST` adds one and `DELETE .../:ruleId` removes one. A rule marks the
  Markdown sections under a heading as `sensitive` or `never-share`; each
  change saves a new version of the list, and runs withhold the marked
  sections as they do locally. A duplicate rule answers 422.
- `PUT /v1/workspaces/:id/knowledge-selection` selects the knowledge bases a
  workspace's runs use, by id. The API names the tenant's store itself, an
  unknown base answers 404, and several bases need `combinationApproved`. The
  workspace view lists the selected `knowledgeBaseIds`.

The owner reviews a hosted run through the API, with the same rules as the
desktop review:

- `GET /v1/workspaces/:id/runs/:runId/review` returns the draft with the
  owner's latest block edits, each claim with its evidence excerpts, the
  critic's findings with their ids and decisions, the run's recorded review
  independence, and the latest readiness scores. Before the first draft, the
  draft is null.
- `PUT .../findings/:findingId/decision` records a decision on one finding
  (accepted, rejected, deferred, overridden or back to pending, with an
  optional rationale), and `PUT .../edits/:blockId` records replacement text
  for one block. Both answer the updated review. Only a run awaiting approval
  takes them (409 `review_closed`), and a finding or block outside the current
  draft answers 404.
- `POST .../approve` approves a run awaiting approval. A blocking finding still
  pending, deferred or only accepted answers 409 `findings_unresolved`, as the
  desktop refuses it. When the final CV checks fail it answers 409 `readiness_blocked`, the review's `approvalCheck` lists
  the blockers, and approving past them needs `readinessOverrideRationale`.
  `POST .../stop` stops a run for good. Any action the run's state does not
  allow answers 409 `run_state_conflict` (`RunTransitionError`).
- `POST .../revision` sends a run awaiting approval back for another round,
  with the owner's optional direction for the author. `POST .../pause` pauses
  an active run, and `POST .../resume` lifts the pause without running a step
  (`releasePause`). Revision and resume take an `Idempotency-Key` and queue
  the run, so a worker drafts the next round or continues the step.
- These actions change the run's state only. Their engine has no agents, so
  the API still reaches no provider.

The owner exports an approved hosted run through the API:

- `POST /v1/workspaces/:id/runs/:runId/exports` renders the approved draft as
  Markdown, DOCX or PDF, with an optional built-in template, under an
  `Idempotency-Key`. It runs the same rendering checks as the desktop and marks
  the run exported. A run not yet approved answers 409.
- Each export gets a new path under its workspace, so an earlier document is
  never replaced. Its bytes go to the tenant's blob prefix
  (`workspaceReferenceBlobs`), and the export record keeps their checksum and
  size. The API never shows where a document is stored.
- PDFs come from the built-in writer: the server images carry no browser
  engine.
- `GET .../exports` lists a run's exports, newest first, and
  `GET .../exports/:exportId/content` downloads one as an attachment, named
  `cv-<day>-<export id>.<extension>` as the review state labels it, with its
  media type and its SHA-256 in `X-Content-SHA256`. The bytes are checked
  against the recorded checksum and size before they are sent: a document
  that changed answers 409 `export_integrity` and is never served. Downloads go
  through the owner token, with no signed storage URLs.

Together these routes take a hosted run from setup to a downloaded CV through
the API only: set up the workspace and its knowledge, review a brief, begin a
run, let the worker draft it, decide the findings, approve, export and
download. The local server stack's smoke and `pnpm test:postgres` both run
that flow, one of them through a revision round
([local server stack](../operations/local-server-stack.md#tests-against-the-stack)).

People manage their organisation through the API once it has a tenant
directory (ADR 0011, D6):

- `GET /v1/me` says who the caller is: a member's organisation, id, role and
  email, or `{ "kind": "owner" }` for the owner token, which belongs to no
  organisation.
- `GET` and `POST /v1/organisation/members` list the caller's organisation and
  invite a person by email.
- `PATCH` and `DELETE /v1/organisation/members/:memberId` change a role or
  remove a member.
- In sign-in mode the plan's `seats` and `candidateRecords` limit growth
  (`plan-limits.ts`, ADR 0011, D13):
  - An invitation takes a seat, active and invited members alike, and removing
    a member frees it. An email already invited answers 409 `member_exists` and
    takes none. The directory counts under the organisation's row lock in the
    same transaction as the insert, so racing invitations cannot pass the
    limit.
  - Creating a workspace takes a record slot. Records are counted as
    `GET /v1/workspaces` lists them, so an erased or closing record takes none,
    and an archived one still does. The count and the save are separate steps,
    so racing creations can pass the limit by a record; these are
    operator-scale actions, and the next creation is refused.
  - Past a limit the answer is 409 `plan_limit_reached` with `limit` (`seats`
    or `candidateRecords`) and `value`; an organisation with no plan gets 403
    `plan_required`. Owner-token mode checks nothing.
- Owners and admins may manage members; members get 403. Only an owner grants, takes away or
  removes the owner role, and the last owner answers 409 `last_owner`. The directory checks the
  acting role against the target's role inside the change, under the organisation's row lock, so
  a promotion racing an admin's request cannot slip past.
- `POST /v1/operator/organisations` creates an organisation and invites its
  first owner. Operator routes take only the deployment's owner token, in
  both authentication modes, never a member's sign-in.
- `PUT /v1/operator/organisations/:organisationId/plan`, `POST
  /v1/operator/organisations/:organisationId/credit-grants` and `GET
  /v1/operator/organisations/:organisationId/credits` let the operator assign an
  organisation's plan, grant it credits and read its plan, entitlements and
  balance (`operator-plan-routes.ts`). The plan body is `planId`, optional
  `overrides`, `seats` and `periodStart` (today's UTC date by default); an unknown
  plan, a seat-priced plan without seats or an impossible date answers 422
  `invalid_plan_assignment`, and an unknown organisation 404
  `organisation_not_found`. A grant is 1 to 1,000,000 credits with a reason
  code, needs an `Idempotency-Key` so a retry is not doubled, and expires after
  12 months. Each write logs one content-free `audit` line (ids, plan id, numbers,
  reason code), since a plan belongs to no workspace's audit trail.
- `DELETE /v1/organisation`, by an owner with the organisation id typed back
  as `confirm`, and `DELETE /v1/operator/organisations/:organisationId`, by the
  operator's token, delete an organisation. Each record is erased as
  `DELETE /v1/workspaces/:workspaceId` does, then every object left under the
  tenant's Cloud Storage prefix, then what the tenant still holds through
  `erase_tenant_remainder`: tenant-wide knowledge bases, idempotency keys, and
  the organisation with its members last. A queued or running run anywhere
  answers 409 `run_active`. The first call marks the organisation as closing
  (`organisations.closing_at`, never cleared); until it is gone, every member
  request but the repeated delete answers 409 `organisation_closing` and the
  worker drops its queued jobs, so nothing is created mid-deletion. An
  interrupted deletion finishes on the next call. Accounts at the identity provider are not deleted; a person's sign-in
  simply no longer resolves to an organisation.
- Each change logs one content-free line with the action, the organisation,
  the member and the role, never an email. The hash-chained audit trail is
  per workspace, and membership belongs to none.
- Each candidate record keeps an append-only consent ledger (ADR 0011, D7),
  the `ConsentLedger` port from `@draft-loop/storage/consent-ledger` over the
  `consent_events` table. `GET /v1/workspaces/:workspaceId/consents` returns
  each kind's latest entry and the history, and `POST` records a
  `material-storage` or `provider-transmission` grant or withdrawal with its
  basis, recorded by the caller. The runtime role may only read and insert
  entries, and each one logs a content-free line without its note.
- In sign-in mode the API enforces the ledger (`consent-enforcement.ts`). A
  source upload needs a current `material-storage` grant on the base's record;
  starting a run, a revision or a resume needs a `provider-transmission` grant
  naming every company the workspace's author and critic use. Otherwise it
  answers 409 `storage_consent_required` or `transmission_consent_required`.
  A worker with `DRAFT_LOOP_AUTH_MODE=oidc` always checks again as it claims
  each job (in owner mode `DRAFT_LOOP_REQUIRE_CONSENT=true` opts in) and
  pauses the run, without a provider call, when consent is gone.
  `DRAFT_LOOP_ALLOW_PROVIDER_DATA` stays a ceiling above consent.
- `GET /v1/workspaces/:workspaceId/archive` downloads everything held about
  a candidate record as a zip in the [record archive v1](../reference/record-archive.md)
  format, with the manifest's SHA-256 in `X-Archive-Manifest-SHA256`. Owners
  and admins may export, and the owner token in owner-token mode; members get 403. The archive holds the bases the record owns in sign-in mode, and every
  base of the tenant in owner-token mode, as the API's auth mode chooses.
  `openPostgresRecordArchives` reads the record's rows from one snapshot and
  checks every source and export object before the first byte is sent, so
  a missing or changed object answers 409 `archive_integrity`. The zip streams
  one file at a time, and each download logs one content-free line.
- `DELETE /v1/workspaces/:workspaceId` erases a candidate record for good.
  Owners and admins only, or the owner token in owner-token mode, with the
  workspace id typed back as `{ "confirm": "<id>" }` (400
  `confirmation_mismatch`). A queued or running run answers 409 `run_active`
  until the caller stops it. The record is closed first and is missing (404)
  to every other route from then on; its stored objects go next, removed by
  key whatever they hold, then its rows. Calling again finishes an interrupted
  erasure, and a record already gone answers 404. One content-free line logs
  the ids and the counts removed. A job queued for an erased record ends in
  the worker with outcome `record-erased`, without a provider call.
- Erasure has two storage steps (`@draft-loop/storage/record-erasure`).
  Closing a record writes a `candidate_record_erasures` mark, after which the record
  is missing to every reader, and returns the object keys its rows name.
  Erasing it calls `erase_candidate_record`, a `SECURITY DEFINER` function
  owned by the migrating role: the only delete the runtime role may make on
  the consent ledger and the audit chain. It removes, in one transaction, the
  record's history, settings, run state, idempotency keys, assignments,
  consent, screening results, its owned knowledge bases with their sources,
  versions and indexes, and the mark last. A repeated close finds the mark, so an interrupted
  erasure finishes on the next call.
- Screening results and quarantine are stored through the `ContentScreeningStore`
  port from `@draft-loop/storage/content-screening`, over the append-only
  `content_screening_results` and `content_screening_releases` tables. A result
  is the content-free outcome of the content screener and names its subject: a
  pasted job source of an opportunity brief, or one knowledge source version.
  Quarantine is derived rather than stored: a subject is quarantined while its
  latest result is `flagged` or `unscreened` and no release covers that result,
  so a newer `clear` result lifts it and a newer flag brings it back. A member's
  release covers one result, keeps a short written reason in the table and
  appends a content-free `content-screening.released` audit event with the
  result and member ids. Record and organisation erasure remove both tables, and
  the record archive includes them.
- Each organisation's plan assignment (ADR 0011, D13) is stored by
  `createOrganisationPlans` in `@draft-loop/storage-postgres`, reached as
  `forTenant(organisationId).organisationPlans`. The current row of
  `organisation_plans` is keyed by the tenant, which is the organisation, and holds
  the plan id, catalog version, validated entitlement overrides, seats and the UTC
  start of the credit period. `organisation_plan_history` appends every assignment
  and refuses updates and deletes. The operator assigns by opening the
  organisation's tenant. Organisation erasure removes both tables; record
  erasure and the record archive leave them alone, since a plan is not candidate
  material.
- Each organisation's credits (ADR 0011, D13) live in an append-only ledger,
  `createCreditLedger` in `@draft-loop/storage-postgres`, reached as
  `forTenant(organisationId).creditLedger`. Rows of kind `grant`, `reserve`,
  `settle`, `refund` and `expire` hold positive amounts, and the balance is
  summed from them. Every write first locks the organisation's balance row, so
  reservations, run caps and the period roll cannot race. A reservation spends
  the period's allowance first, then the operator grant that expires first;
  a refund never revives expired credits. Organisation erasure removes both
  tables.

### Intake screening

The API screens untrusted text for prompt injection before any model reads it
(ADR 0011, phase 2d), in `content-screening-*.ts`. `DRAFT_LOOP_SCREENING`
chooses how, the same in both auth modes: `off`, `rules` (the default) or
`rules+model`. Anything else stops the API at startup.

- **What is screened.** Each source of `POST /v1/workspaces/:id/opportunities`
  and each file of the knowledge source upload, after it is saved, so the
  subject ids exist. The rule screener (`packages/ingestion`) always runs;
  `rules+model` adds Claude Haiku 5.5 on the EU Vertex route
  (`packages/model-gateway`), and `screenWith` merges the verdicts. An
  upload's text comes from the same extraction the run uses; a file with no
  readable text is left unscreened. An edit to a reviewed brief is typed by a
  member and is not screened again.
- **What the answer shows.** A `screening` object with the verdict, the closed
  signal codes and the stored result id, never a quote of the text. With
  screening `off` nothing is screened or stored and the object is absent.
- **Fail closed.** A screener that fails makes the result `unscreened`, which
  is quarantined like `flagged`. The request itself still succeeds, and the
  same bytes uploaded again are screened again while the result is unscreened
  and unreleased.
- **Consent.** A job post is third-party text, so `rules+model` always sends it
  to the model. A candidate source (an upload, or a brief's candidate-input
  source) reaches the model only when `DRAFT_LOOP_ALLOW_PROVIDER_DATA` is on
  and the record's current `provider-transmission` consent names Anthropic;
  otherwise only the rules run, and the result's `screeners` shows that. A base
  that no record owns, as in owner-token mode, has no consent to read, so its
  uploads get the rules only. The data policy is built from that consent, as a
  run's is.
- **Usage.** Each answered model call writes one content-free log line with the
  tenant, model, token counts and estimated cost. There is no usage table yet;
  per-tenant metering comes with entitlements.
- **The run gate.** `POST /v1/workspaces/:id/runs` answers 409
  `material_quarantined` when the brief's job sources, or the latest version of
  any source in a selected knowledge base, are quarantined, and lists them with
  their result ids in `error.quarantined`. The gate reads stored results, so it
  holds in every mode, including `off`. With screening on, it also answers 409
  `material_unscreened` for material with no stored result, such as a brief
  saved while screening was `off` or whose result write failed, and lists those
  subjects by ids in `error.unscreened` (`unscreenedRunMaterial` in
  `packages/application`). It does not screen at run start, because the brief's
  text and the upload's bytes are not at hand there; saving the brief again or
  uploading the file again screens it.
- **The worker check.** Material can be flagged after a run is queued, so the
  worker asks the same question (`quarantinedRunMaterial` in
  `packages/application`, shared with the gate) as it claims each job, in every
  auth mode and before any provider call. If anything the run would send is
  quarantined, or, with screening on, has no stored result, it pauses the run
  as it does for withdrawn consent, ends the job
  with outcome `material-quarantined` and logs one content-free `WARNING` with
  the tenant, workspace and run ids and, for each piece, its kind, result id and
  signal codes. After a release, a resume queues the run and the next job
  continues it.
- **Release.** `POST /v1/workspaces/:id/screening/:resultId/release` with a
  `{ "reason" }` of 1 to 500 characters lets one result through. Owners and
  admins, and the owner token, may release; members get 403. A result must
  belong to the record (its job source, or a base the record owns in sign-in
  mode), else 404. A result that a newer one replaced answers 409
  `result_superseded`, and a clear one 409 `not_releasable`. A later flagged or
  unscreened result quarantines the text again.
- **Status.** `GET /v1/workspaces/:id/screening` reads the record's latest
  status after a reload: each job source of its briefs, and each current source
  version in the bases the record owns or selects (every base in owner-token
  mode). Each item has the subject ids, verdict, signal codes, result id,
  `quarantined` and, when released, `release` with the member and time. The
  release reason is member-written, so only owners and admins get it. The
  route needs the same sign-in and record access as other workspace routes and
  answers an empty list when nothing was screened.
- **Web screen.** `apps/web` reads that route to badge each uploaded file and
  the job brief with text, not colour alone: clear, quarantined (flagged with
  its signals in words, or not screened), released, or not screened. A 409
  `material_quarantined` at the run start names what is quarantined from
  `error.quarantined`. Owners and admins release each piece in a dialog that
  requires a reason; other members see the status only, and the API enforces
  the same rule.
- **Alerts.** Four content-free `WARNING` lines let the owner alert on screening
  and on refused access (ADR 0011, D16): `material quarantined` at intake,
  `quarantined material released`, `run paused for quarantined material` in the
  worker, and `access refused` when the API refuses a record, run or knowledge
  base. Ids and closed codes only, never the text, a file name or a release
  reason. [Server deploy](../operations/server-deploy.md#logs) lists their
  fields.
- **Red-team test.** `apps/worker/src/injection-flow.test.ts` runs the
  synthetic corpus of `packages/ingestion` through the API on Postgres and the
  worker with a scripted gateway. It checks that every injected case is
  quarantined, as a job post and as an upload, by the rule screener alone, that
  clean cases are not, and that no author or critic call happens before a
  release. The [threat model](../security/threat-model.md#hosted-service-prompt-injection-through-job-posts-and-uploads)
  lists the remaining gaps.

## Data and quality contracts

Career evidence is the material a run uses. Runs read the selected knowledge
base; legacy workspace evidence (the workspace `evidence` folder) is used only
when none is selected, and the desktop imports it into a new base once.

Retrieval is workspace-scoped behind a provider-independent port. SQLite
FTS/BM25 is the integrated lexical baseline and supplies selected chunks to live
author and critic requests. Local vector and hybrid implementations remain
evaluation components until deletion, retention, isolation, provenance, and
quality are validated for the product path.

[ADR 0008](../adr/0008-ckb-scoped-lexical-retrieval.md) defines the CKB cutover:
each portable store owns its replaceable exact-source-version lexical index,
while the application fans out only across the workspace's explicit selection
and persists content-free retrieval traces in workspace history. The exact
selected projection stays inside the lifecycle boundary that can delete or
rebuild it. Migration 25 supplies the CKB chunk/FTS projection, freshness
inspection, exact-scope query and fallback, whole-projection invalidation on
source-version deletion, and immutable workspace traces. Runs with an explicit
CKB selection provide only opaque chunk references and bounded text to author
and critic; legacy workspaces without a CKB selection keep the earlier
workspace evidence index. CKB selection remains explicit and path-free in run
contexts.

Before evidence reaches the author, bounded supplementary searches reserve
content for required CV sections. If a search limit is reached without
establishing section content, drafting fails visibly because the search cannot
establish absence. Author validation rejects empty sections and unavailable
placeholders when supplied evidence establishes content; missing individual
details may remain explicit.

Author-output validation checks every substantive claim against its cited
evidence. Protected multi-word values stay within one cited chunk, and numbers,
names, and explicit experience contradictions stay protected.

Block text outside substantive claims fails with the content-free
`substantive_text_uncovered` diagnostic, for bounded author retry, when any of
these holds:

- An uncovered content word appears in no retrieved chunk. A short closed list
  of function words, such as articles, prepositions, and connectives, is exempt.
- A protected value in the block is not supported by the chunks its claims cite.
- A date range is not stated with the same start and end in one cited chunk.
- A capitalised single-word name appears in no retrieved chunk.

Headings, labels, and explicit missing-data notices stay exempt. Wording built
only from function words and evidence words is left to critic and human review.

The checks never pass ungrounded content, but one failing block does not
discard the whole draft. When every failure is confined to individual blocks,
the draft keeps the blocks that pass:

- A block with a failing claim, or a failing date range in its text, is removed.
  A section left without blocks is removed.
- A block whose claims pass but whose surrounding text fails is shortened to
  its own claim text, with no new wording.
- The kept draft is re-checked with the same rules. The draft carries one
  content-free `ungrounded-author-content-dropped` warning with the counts, so
  the critic, the revision round, and the user see that content was left out.

The author step still fails, with the original diagnostics, when a failure is
not confined to a block, such as a required section losing all its content, or
when no section would remain.

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

## Detailed current-system views

This page is the stable external entry point. The detailed views below are the
canonical homes for the current-state material that would otherwise make this
overview a file tour:

- [Candidate evidence](candidate-evidence.md) covers opportunity briefs,
  writing policy enforcement, portable CKB lifecycle, canonical candidate
  profiles, and CKB integration boundaries.
- [Drafting and review](drafting-and-review.md) covers the
  evaluator–optimizer workflow, requirement matching, author grounding,
  independent readiness, adjudication, stopping decisions, and rendering QA.
- [Runtime and trust](runtime-and-trust.md) covers the author–critic loop,
  workflow states, duration accounting, application adapters, provider controls,
  and export boundaries.

## Current limitations

Portable CKB retrieval is explicit and scoped to selected source versions;
index synchronization and lifecycle checks run before results are used. Local
vector and hybrid retrieval remain evaluation components. Rendering QA is
bounded: OOXML cannot establish true office pagination or visual clipping, and
structured links and images are unsupported by the current artifact model.
DraftLoop prepares local artifacts but does not submit applications, publish
documents, send messages, or perform uncontrolled web research.
