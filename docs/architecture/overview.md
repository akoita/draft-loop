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

| Boundary                                         | Owns                                                                                                                                  | Does not own                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/domain` and `packages/schemas`         | Framework-free concepts, workflow states, and Zod validation at persistence/exchange boundaries                                       | Provider SDKs, storage engines, or UI frameworks                        |
| `packages/ingestion` and `packages/evidence`     | Approved local/URL intake, extraction, normalized material, provenance, and source references                                         | Application selection or provider transport                             |
| `packages/orchestrator`                          | Author–critic sequencing, budgets, pause/stop, recovery, and user-visible run events through ports                                    | Provider-specific SDK calls                                             |
| `packages/validation` and `packages/evaluations` | Deterministic checks, rubric findings, and structured critique records                                                                | Proof of truth independent of candidate evidence and human decisions    |
| `packages/artifacts` and `packages/rendering`    | Approved structured output and local Markdown/DOCX/PDF rendering                                                                      | Submission or publishing                                                |
| `packages/storage`                               | Workspace history and portable CKB persistence, including managed bytes, derived lexical and vector projections, and local-only state | CKB selection, retrieval policy, or UI                                  |
| `packages/storage-postgres`                      | The Postgres implementation of the storage ports for the hosted service, its SQL migrations, and its audit-chain writes               | Desktop or CLI wiring, provider calls, or object storage                |
| `packages/storage-gcs`                           | The Cloud Storage implementation of the blob port for the hosted service: tenant-prefixed keys, checksum metadata and verified deletes | Desktop or CLI wiring, encryption keys, or bucket provisioning          |
| `packages/model-gateway`                         | The hosted service's model routes: a Claude on Vertex AI client limited to EU locations and listed models, Vertex pricing, the `vertex-ai` route in run history, the opt-in Claude API fallback, the OpenAI EU client and Secret Manager keys | Desktop or CLI wiring, prompts, or provider keys in images |
| `packages/run-queue`                             | The hosted service's durable run queue on Postgres (pg-boss): ids-only job payloads, one waiting job per run, retry and heartbeat settings, queue migrations and runtime grants | Run execution, candidate material in payloads, or desktop and CLI wiring |
| `packages/embeddings`                            | Local text-embedding runtime, pinned model manifest, and vector normalization behind the `TextEmbedder` port                          | Model download, vector persistence, retrieval policy, or provider calls |
| `packages/providers`                             | Provider identity, SDK translation, policy enforcement, and model calls                                                               | Domain workflow decisions                                               |
| `packages/application`, CLI, and desktop host    | Adapter-neutral use cases and shared user-facing contracts                                                                            | A second domain layer or provider SDKs in the UI                        |
| `apps/api`                                       | The hosted service's HTTP adapter over `ApplicationService`: Zod-typed `/v1` routes for workspace setup, workspaces, knowledge bases, job briefs, applications, runs and their review, path-free projections, idempotent run starts that queue the run for a worker, the committed OpenAPI document, owner-only token access and the error shape | Domain logic, storage engines, or provider calls |
| `apps/worker`                                    | The hosted service's run executor: claims queued runs, resumes each through `ApplicationService` from its last saved step, requeues a usage-limited run for its reset time, and stops within Cloud Run's shutdown notice | Domain logic, provider calls outside the application service, or job payloads with content |

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
  `hostedKnowledgeStoreReference` build the references it addresses. The API's
  and the worker's entry points compose them at startup, with Cloud Storage and
  the run queue; phase 1 serves one tenant per deployment.
- Postgres isolates tenants in shared tables (ADR 0011, D3):
  - every table carries `tenant_id`, and every key and foreign key includes
    it, so tenants can reuse ids;
  - a store opens for one tenant, and each transaction sets
    `draft_loop.tenant_id`, which fills `tenant_id` on insert;
  - forced row-level security compares that setting on every read and write,
    and the store refuses to open as a superuser or `BYPASSRLS` role;
  - migrations run separately as the schema owner (`migratePostgresStorage`),
    and `grantPostgresStorageAccess` gives the runtime role table access only.
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
- A run paused on a provider usage limit is queued again for the reset time
  (15 minutes when the provider names none) and resumed then.
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

`createRoutedAdapter` applies the deployment's route policy. The direct Claude
API is an optional fallback, off unless the deployment turns it on, because it
processes material outside the EU. A call falls back only when its model is
not offered on the primary route (`model-not-offered`) or the route still
refuses after the adapter's retries (`route-unavailable`). It never falls back
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

`apps/api` never calls a model. Its driver resolves no key and refuses to build
any provider client (`apiProviderOptions`), whatever its environment holds, so
only the worker reaches a provider.

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
  instead of being overwritten.
- `PATCH /v1/workspaces/:id/opportunities/:briefId` saves an edit of a job
  brief as a new draft version, from a patch of its editable fields in their
  brief shape. Its `expectedVersion` must be the latest, or the edit answers
  409 `brief_version_stale`, as a review of a stale version does.
  `GET .../versions` lists each version's number, status and dates.

Candidate sources reach a hosted knowledge store through
`createHostedKnowledgeIntake` in `packages/application`, over the storage ports
and the blob port:

- A tenant has one knowledge store, created with its first knowledge base,
  because knowledge bases belong to the tenant.
- A source file is a PDF, DOCX, Markdown or plain text file of at most 10 MiB by
  default. Its type is checked by its signature only: the service never parses
  an upload (ADR 0011, D11), and the run worker extracts the text from the
  stored bytes.
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
  existing source, so a retry is safe. Every other route keeps parsing JSON.
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
