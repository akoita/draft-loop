# ADR 0011: A client-server version beside the local-first app

- Status: Accepted (2026-10-17)
- Date: 2026-10-16 (updated 2026-10-17)
- Decision owners: DraftLoop maintainers

## Context

DraftLoop is a local-first desktop app. The candidate's evidence, profile,
runs and exports live on their machine. Model providers receive only the
bounded material each run sends, after a visible approval. The last
local-first stage (#1309) brings CV quality to parity with the manual
Claude/Codex loop. After that stage, the local version stays a supported
product. It is not frozen: it can keep evolving in parallel with the hosted
version (D15).

The next product is a **client-server version**: hosted, professional, with
**traceability** as a first-class feature and a viable **business model**.
This ADR sets its architecture. It records decisions and the open questions
that only the owner can settle. It does not start implementation.

### What already carries over

The monorepo was built around ports, and most of it is framework-free:

| Package | Today | Server reuse |
|---|---|---|
| `domain`, `schemas` | Framework-free concepts and Zod contracts | Unchanged |
| `orchestrator` | Author–critic engine behind ports (`RunStore`, agents, planner) | Unchanged, plus a durable runner |
| `validation`, `evaluations`, `artifacts`, `evidence` | Pure checks, readiness, diffs, grounding | Unchanged |
| `rendering` | Markdown, DOCX, PDF | Unchanged |
| `ingestion` | Parsers for PDF, DOCX, HTML and more | Unchanged, run in sandboxed workers |
| `providers` | API adapters and subscription CLI routes | API adapters unchanged; CLI routes stay desktop-only |
| `embeddings` | Pinned local ONNX model behind a port | Same model on CPU workers |
| `application` | `ApplicationService` over an `ApplicationDriver`; `local.ts` is the filesystem driver | Service reused; new server driver |
| `storage` | One SQLite class (`SqliteStorage`), with no storage port | **Replaced** by a port and a Postgres implementation |
| `apps/desktop` | Electron host and React renderer | Renderer components reused on the web; host stays desktop-only |
| `apps/cli` | Adapter over `ApplicationService` | Becomes an API client |

The desktop and the CLI already call one contract, `ApplicationService`, and
every bridged payload is validated against explicit allowlists. That contract
is the natural shape of the server API.

### What does not carry over

- **Subscription sessions.** The `user-session` routes drive the user's own
  Claude and Codex CLIs. A server cannot run a user's subscription on their
  behalf, so the hosted version uses provider APIs only.
- **The filesystem workspace.** Workspaces, knowledge stores and exports are
  folders on disk, and absolute paths appear in workspace configuration
  (see ADR 0007).
- **The local trust model.** "Candidate material stays on the machine" no
  longer holds. Hosting personal career data is a new privacy and legal
  commitment, covered by D7 below.

## Decision drivers

1. **Same CV quality as the local version.** Reuse the engine, prompts and
   checks unchanged, so parity carries over by construction.
2. **Traceability as the product.** Every claim, decision and export must be
   explainable and verifiable after the fact.
3. **Privacy by design.** Career material is personal data. In the EU it is
   subject to GDPR, and it can include special-category data.
4. **Small team, fast path.** The architecture must run with one developer
   and grow without a rewrite.
5. **Provider diversity.** The cross-company author/critic pair stays a
   product rule.

## Decisions

The diagram shows where these decisions lead. It is a plan: on `main` today,
only the Postgres storage package and the shared packages exist on the
hosted side. The [architecture overview](../architecture/overview.md)
describes what runs now.

![Planned client-server architecture: a web app and AI agents reach a Fastify API on Cloud Run in europe-west1; the API queues runs for workers, which call a model gateway that sends approved context to the Anthropic author on Vertex AI in the EU and the OpenAI critic in an EU data-residency project; data lives in Cloud SQL Postgres with pgvector, already built, and Cloud Storage; sign-in uses Keycloak on Clever Cloud; every service uses the desktop app's packages, and the local-first desktop app, CLI, a planned local MCP server and SQLite keep running on the user's machine.](../assets/client-server-target-architecture.svg)

### D1. Topology: a modular monolith with background workers

One TypeScript service exposes the API and runs the application service.
Separate **worker** processes execute runs, ingestion and embeddings from a
durable queue. A **web client** is the main interface.

- **Why:** the packages are already modules with enforced boundaries.
  Microservices would add network seams where function calls work today.
- **Consequence:** one deployable API plus one worker image, both built from
  the same packages.
- **Agent pattern: a fixed author–critic workflow, not autonomous
  multi-agent teams.** The planner, author, critic and coverage judge run in
  a known order with structured outputs. That keeps runs reproducible,
  costed and traceable claim by claim. A separate agent is added only to
  isolate a task, an access boundary or a token budget, never for its own
  sake. This extends the evaluator-optimizer decision in ADR 0003.

### D2. Repository: same monorepo, new apps

Add `apps/api`, `apps/worker`, `apps/web`, `packages/storage-postgres` and
`packages/storage-gcs`.
The architecture rules in `AGENTS.md` apply unchanged: domain owns concepts,
the orchestrator stays SDK-free, and adapters do not hold domain logic.

- **Why:** parity depends on running the exact same engine and prompts. One
  repository keeps that true by construction.
- **Consequence:** the desktop app keeps building from the same packages.
  Package changes must keep both clients green (D15).
- **No fork and no long-lived branch.** Server work merges to `main` through
  the normal PR flow. Unfinished server code ships to nobody until it is
  deployed, so it needs no branch of its own.
- **When to revisit (decided 2026-10-17).** The two versions differ only in
  the adapters behind the ports. Revisit the single repository only if
  either of these keeps happening:
  - shared packages need changes specific to one version;
  - shared changes break one of the clients.

  The response is then to publish the shared core as versioned packages,
  never a fork or a long-lived branch.
- **Infrastructure lives in a private repository.** Terraform, the deploy
  workflow, project identifiers and service accounts sit in a separate
  private infrastructure repository, so this public repository holds none
  of them. This repository keeps the Dockerfiles and the local Compose stack
  (D15).

**Delivery lanes.** CI stays one gate; delivery splits by client.

- **CI:** `ci.yml` keeps typechecking and testing the whole workspace, so a
  shared-package change that breaks either client fails its PR. Postgres
  tests run in their own job with a service container.
- **Desktop releases:** `release.yml` is unchanged and still requires
  `pnpm release:preflight` first.
- **Server deploys:** a workflow in the private infrastructure repository
  checks out a `server-v*` tag of this repository, builds the API and worker
  images, and deploys them to Cloud Run through Workload Identity Federation
  (D14). Staging comes first, then production behind a manual approval.
  - A `server-v*` tag needs the CI gate green on its commit.
  - The synthetic smoke on staging gates production, as
    `pnpm release:preflight` gates a desktop release (decided 2026-10-22).

### D3. Persistence: a storage port, then Postgres and object storage

- **First, extract a storage port** from `SqliteStorage`: the record types it
  persists, behind interfaces grouped by concern. These are runs and
  snapshots, the audit chain, applications, briefs, profiles, knowledge
  sources and exports.

  `RunStore` already shows the pattern. SQLite becomes one implementation
  of the port, and this work lands in the local repo first.
- **Postgres** is the server implementation:
  - every row carries `tenant_id`;
  - **row-level security** enforces isolation as defence in depth;
  - the hash-chained audit events (`verifyAuditChain`) and the slim snapshot
    format (#1293–#1295) carry over as is.
- **Object storage** (Cloud Storage, D14) holds uploaded sources and exports
  behind the same blob port as the local filesystem:
  - every object key sits under its tenant's prefix, and a key outside it is
    refused;
  - the content's SHA-256 is stored with the object and checked on every
    read, and a delete removes only the generation it verified;
  - objects are encrypted at rest with the bucket's default customer-managed
    key, which infrastructure sets; the adapter never holds keys.
- **Why:** the 14,500-line storage class is the largest coupling in the
  repo. A port is needed for any server, and it makes the SQLite path
  testable too.

### D4. Run execution: durable jobs over the existing resumable steps

Runs execute as **queued jobs** on workers. The orchestrator already saves
each step and resumes from the last completed one, including mid-plan
(#1304) and after a usage-limit pause (#1306). A worker crash therefore
resumes rather than restarts.

- **Recommended:** a Postgres-backed queue (for example pg-boss). It adds no
  new infrastructure and transactions stay in one database. Move to a
  workflow engine (Temporal) only if runs need cross-service orchestration.
- **Progress** streams to the client over server-sent events, from the same
  run events the desktop shows today.
- **On-demand worker (decided 2026-10-22).** On Cloud Run the worker is a job
  that drains the queue and exits once it stays empty. The API starts it
  after each enqueue, and a scheduled sweep starts it every few minutes for
  retries and resumed runs. An always-on worker would be the main fixed cost
  while one person uses the service.

### D5. Providers: API routes, a platform-managed default, optional BYOK

- **API adapters only** on the server. The subscription CLI routes stay
  desktop-only.
- **Entry points, one primary and one fallback per company:**
  - *Author (Anthropic):* Claude on Vertex AI in the D14 region first. Calls
    stay in the EU, use Google Cloud identities instead of a long-lived key,
    and sit on the same bill. The direct Claude API is the fallback, and the
    route for models or features that reach it before Vertex. Check that
    parity when building, and let the evaluation gate confirm it.
  - *Critic (OpenAI):* OpenAI's API in an EU data-residency project. Azure
    OpenAI in an EU region is an option for Business customers who require
    it.
- **An internal model gateway,** a module of the server rather than a
  third-party proxy. It holds keys and identities, meters usage per tenant,
  enforces run budgets and picks the route. A fallback is never silent: it is
  recorded in run history. No outside proxy sees candidate material.
- **Platform keys by default:** the service calls Anthropic and OpenAI with
  its own keys, meters usage per tenant, and enforces per-tenant budgets.
  The run budget machinery already exists.
- **Bring your own key (BYOK)** as an option for professional plans. Keys
  are held in a KMS-backed secret store and never returned to clients
  (compare ADR 0004).
- **Contracts:** use provider terms that do not train on or retain inputs
  (zero data retention where available), signed in data processing
  agreements.
- **Rules kept:** an Anthropic author with an OpenAI critic by default, a
  same-company warning, and model identity recorded in run history.

### D6. Identity, tenancy and candidate records

The owner decided (2026-10-16) to serve every profile through tiered plans
(D13). One person or one organisation can therefore act for many candidates.

- **OIDC sign-in** through a managed identity provider with organisation
  support and EU data residency. Business plans add SSO (SAML or OIDC) and
  directory sync.
- **Organisation** is the tenant. An individual plan is an organisation of
  one.
- **Candidate record** is what a local workspace is today (ADR 0010): one
  candidate's evidence, reviewed profile, writing policy and applications.
  An organisation holds one or many candidate records.
- **Roles:**
  - *Owner/admin*: billing, members, policies, retention.
  - *Member* (coach, recruiter, counsellor): works on the candidate records
    assigned to them.
  - *Candidate*: owns or is invited to their own record. Can see their
    evidence, approve or reject drafts, and export.
  - *Reviewer*: comments on and approves drafts they are invited to.
- **Who approves and exports:** the candidate, or a member the candidate
  has authorised for that record. The authorisation is recorded in the
  audit trail.

**Built in phase 2a (sprint 1j, 2026-10-24):**

- The API verifies the identity provider's tokens when
  `DRAFT_LOOP_AUTH_MODE` is `oidc`; staging keeps the owner token until
  Keycloak is hosted.
- Organisations and members live in a tenant directory on Postgres. The
  operator creates an organisation with its first owner, owners and admins
  invite members by email, and an invitation becomes active on the first
  sign-in with that verified email.
- Each request is served from its caller's tenant, and one worker serves
  every tenant from the job's tenant id.
- Roles so far are owner, admin and member, scoped to the whole
  organisation. Candidate records, assignment, the candidate and reviewer
  roles, and consent come next.

### D7. Privacy and data protection

- **Controller and processor.** For an individual plan, DraftLoop is the
  controller of the candidate's data. For team and business plans, the
  organisation is the controller and DraftLoop processes the data on its
  behalf under a data processing agreement. The organisation must hold a
  lawful basis to process each candidate's material.
- **The candidate's consent is captured and recorded:**
  - When a member uploads material for a candidate, the member attests
    the lawful basis.
  - The candidate is invited to confirm, where the plan requires it, and
    can see what is held about them and request deletion.
  - Each step is recorded: storing material, sending bounded excerpts to
    model providers, and every sharing with a reviewer.
- **Sensitivity tiers are enforced on the server.** Never-share sections are
  stored for the candidate's own reference but are never sent to a provider
  or a reviewer. Sensitive sections need consent per run, as today.
- **Hosting in the EU by default.** Encryption in transit and at rest, with
  per-tenant data keys.
- **Data subject rights by design:** export everything, and delete
  everything, including objects and backups within a stated window.
- **Retention defaults** (working defaults, accepted 2026-10-20; a GDPR
  lawyer confirms the periods before phase 2 admits other users, especially
  for special-category data):

  | Situation | What is kept |
  |---|---|
  | Active plan or pass | Everything, encrypted with per-tenant keys |
  | After cancellation or a pass ends | 30 days read-only for export, then deletion; backups age out within 35 days |
  | Inactive free account | A reminder at 11 months, deletion at 12 |
  | Audit trail | Content-free metadata, kept as long as the account and deleted with it |
  | Model providers | Nothing, under zero-retention terms (D5) |

  Pro adds a low-cost encrypted, read-only *vault* that keeps a reviewed
  profile between job searches. Team and Business set retention per
  candidate record (D13).
- **No hidden reasoning stored.** Only structured findings, decisions and
  user-visible rationale, as in the local version.
- **`AGENTS.md` data rules cover both versions.** The local-first version
  keeps material local by default. The hosted version stores material only
  with recorded consent and sends only the bounded, approved material.

### D8. Traceability as a product feature

Build on what the local version already records:

- **Provenance:**
  - every CV claim links to evidence chunks;
  - those chunks link to a source version (checksum, upload time);
  - the run records its brief, profile, model identities, prompt versions
    and the application plan.
- **Decisions:** every finding decision, override, direction and approval
  is recorded with actor, time and round.
- **Integrity:** the hash-chained audit trail per tenant, verifiable with
  `verifyAuditChain`. An optional export of the chain head lets a third
  party verify later.
- **Deliverable:** a **provenance report** exported beside the CV. It shows
  which evidence supports each statement and how the draft converged. It is
  content-scoped to that application.

### D9. Clients

- **Web app first.** Move the desktop renderer's screens into a shared UI
  package where they are not Electron-specific: Home, application steps,
  review, run comparison and Run details. The web app uses them over the
  HTTP API.
- **Phase 1 screen (amended 2026-10-23).** Phase 1 ships a small,
  purpose-built `apps/web` for the owner's own use instead. The API serves
  it on the same origin, and its types are generated from the committed
  OpenAPI document. The shared UI package moves to phase 2, when the web
  becomes the main interface for other users.
  - *Why:* the desktop review screen is one large file wired to the Electron
    bridge. Extracting it first would take several sprints and put the
    local-first app at risk before the phase 1 gate.
- **The desktop app** stays the local-first product and keeps evolving in
  parallel (D15). Making it a thin client of the service is a later,
  separate decision.
- **The CLI** becomes an API client, for scripting and support.
- **Agents** reach DraftLoop through an MCP server (D17).

### D10. API contract

- **One typed HTTP API** shaped on `ApplicationService`. Request and response
  schemas come from the existing Zod contracts. OpenAPI is generated from
  them.
- **Allowlist validation.** The desktop bridge's exact-key validation
  becomes the API's input validation, with the same drift tests.
- **Versioned from day one** (`/v1`), with idempotency keys on commands that
  start runs or exports.
- **Framework: Fastify, not NestJS.** `apps/api` is a thin adapter over
  `ApplicationService`, like `apps/cli`. Routes are typed with
  `fastify-type-provider-zod`, and `@fastify/swagger` generates OpenAPI.
  Auth, rate limits and security headers come from Fastify plugins.
  - *Why:* the packages already provide the modules, ports and validation
    that NestJS would add. A second module system and decorators would
    duplicate them in a framework-free codebase.
  - *Scale:* the API is stateless on Cloud Run, and runs scale through the
    worker queue (D4), so the HTTP framework is not the limiting factor.

### D11. Ingestion, retrieval and fetching

- **Ingestion runs in sandboxed workers.** Uploaded PDFs and DOCX files are
  untrusted input, so workers get no network access and bounded memory and
  time.
- **Embeddings:** the same pinned model runs on CPU workers. Vectors go in
  Postgres with pgvector, keeping retrieval in the same database and tenant
  boundary. Lexical retrieval stays the default where it is today.
- **Retrieval stays in Postgres (amended 2026-10-17).** Hosted retrieval runs
  in Cloud SQL:
  - lexical search uses Postgres full-text search;
  - semantic search uses `pgvector` with the same pinned embedding model.

  There is no managed RAG product and no separate vector database. That
  keeps one tenant boundary, one backup and one consistency model, and the
  retrieval code stays the shared code the desktop runs.
  - *Risk:* Postgres text ranking is not BM25, so ranking may differ from
    SQLite FTS5. The storage conformance suite compares the two on shared
    fixtures. If they differ, the fallback is BM25 computed in the
    application over the chunks Postgres selects.
  - *Revisit* AlloyDB or a reranker only when evaluation shows a retrieval
    quality or latency gap.
- **Approved URL fetching** goes through an egress-controlled fetcher. The
  existing rule holds: a URL is fetched only after the candidate approves
  it.
- **Egress is enforced per service, not only in code.** Each service has
  its own identity (D14) and an allowlist of destinations: the run worker
  reaches only the model endpoints, the fetcher only approved URLs, and
  ingestion nothing.

### D12. Bringing local users across

Offer an **import from a local workspace** through the portable knowledge
backup format (ADR 0007), plus applications and their history. The upload
is explicit, and the local copy is unchanged. This is optional for the
first release.

### D13. Plans and entitlements

One product, tiered like Claude's plans. Every user profile is served; the
plan decides what is enabled.

| Plan | For | Shape |
|---|---|---|
| Individual | A candidate managing their own job search | One seat, one candidate record, monthly run allowance |
| Pro | A demanding candidate or an independent coach | Higher run allowance, frontier model pairs, provenance report, run comparison |
| Team | Coaches and recruiters working for several candidates | Seats, shared policies and templates, many candidate records, reviewer role |
| Business | Outplacement firms, schools, career services | SSO and directory sync, admin controls, retention policies, audit export, BYOK, DPA |

- **Entitlements are data, not code paths.** A plan maps to a set of
  entitlements (run allowance, model tiers, seats, candidate records,
  provenance report, BYOK, SSO, retention controls). Services check
  entitlements, never plan names, so plans can change without code changes.
- **Metering:** runs, provider tokens and cost are already recorded per run.
  They are aggregated per organisation and enforced by the existing run
  budget machinery.
- **Pricing model (proposed):** a subscription that includes monthly
  credits, plus top-up packs.
  - One credit is about one reviewed CV. Longer runs and frontier model pairs
    cost more credits.
  - A prepaid *job-search pass* of one to three months suits candidates,
    whose need lasts weeks, better than an open-ended subscription.
  - Team and Business pool credits across seats. Business can commit
    annually, or bring its own keys and pay per seat.
  - The platform pays the model providers (D5). Users never need an API key
    unless they choose BYOK.
- **Price levels (working defaults, accepted 2026-10-20).** The comparison
  with other CV services is on #1402.

  | Plan | Price | Included |
  |---|---|---|
  | Individual | €19/month | 4 CVs, economy model pair |
  | Job-search pass | €49 once, 3 months | 12 CVs |
  | Pro | €49/month | 8 CVs, frontier pair, provenance report |
  | Team | €149/month per coach seat | 30 CVs, pooled |
  | Business | Quote | BYOK, SSO, retention controls |
  | Extra CV | €5 | |

  - **Margin rule:** an included CV costs the platform no more than about
    half of what the user pays for it.
  - **Gate:** these prices apply only once phase 1 measures a cached run at
    US$3 or less, against about US$5.60 uncached today (D14). Otherwise
    allowances shrink, or the economy pair becomes the default on more
    plans.
- **Capping usage:**
  - A run's credit cost is estimated before it starts. It does not start if
    the balance is too low, so no run creates debt.
  - At 80% of the allowance the user is warned, then offered a top-up or a
    stop. Overage is never silent.
  - Per-tenant daily and concurrency caps stop abuse, and provider cost
    alerts protect the platform.
- **Billing:** a payment provider with subscriptions, seats and top-ups (for
  example Stripe). Billing state only feeds entitlements; the domain never
  depends on it.
- **The quality engine is the same on every plan.** Plans gate volume,
  models and professional features, never the grounding, critic or
  validation that make a CV truthful.

### D14. Hosting on Google Cloud

The owner decided (2026-10-16) to host on Google Cloud, and chose the region
`europe-west1` (Belgium) on 2026-10-17. The components map onto managed
services in that region:

| Component | Google Cloud service |
|---|---|
| API (D1, D10) | Cloud Run service behind an external HTTPS load balancer, with Cloud Armor |
| Workers (D4, D11) | Cloud Run worker pools or always-on Cloud Run services pulling from the queue; ingestion in a separate service with no egress |
| Database (D3) | Cloud SQL for PostgreSQL with `pgvector`, private IP, automated backups and point-in-time recovery; AlloyDB if load requires it |
| Queue (D4) | Postgres-backed, in the same Cloud SQL instance, so run state and jobs commit together; Cloud Tasks or Pub/Sub only for fan-out that needs it |
| Objects (D3) | Cloud Storage, with CMEK through Cloud KMS and per-tenant prefixes |
| Secrets and BYOK keys (D5) | Secret Manager for platform secrets; Cloud KMS envelope encryption for customer keys |
| Identity (D6) | Keycloak managed by Clever Cloud in France, outside Google Cloud: OIDC sign-in, organisations as tenants, SAML for Business SSO. Identity Platform is excluded because its Firebase Authentication base runs only in US data centres |
| URL fetching (D11) | A fetcher service with egress only through Cloud NAT and Secure Web Proxy rules |
| Observability | Cloud Logging, Monitoring and Trace through the OpenTelemetry instrumentation the packages already have, with content-free attributes only |
| Infrastructure | Terraform, Artifact Registry, and GitHub Actions deploying through Workload Identity Federation (no long-lived service account keys), all in a private infrastructure repository (D2) |

- **Model providers.** Anthropic and OpenAI stay the default pair, through
  the entry points in D5.
  - Claude is called through Vertex AI's EU multi-region endpoint, which
    keeps processing in the EU at about a 10% premium over list price.
  - Claude on Vertex AI needs one more adapter beside the existing
    `@anthropic-ai/sdk` one, since both share the messages interface, plus
    a model-id mapping.
- **Cost per run.** A standard run measured from local history costs about
  $6 with the Vertex EU premium; the figures are on #1357.
  - It is an upper bound, since cached tokens were not recorded.
  - The model gateway (D5) replaces it with measured hosted cost before
    price levels are set.
- **Isolation.** Production in its own project, with separate service
  accounts for API, workers, ingestion and fetcher, each with least
  privilege and an egress allowlist (D11). Business plans can later move
  to Assured Workloads controls.
- **Cost.** Cloud Run scales to zero for the API, and a small Cloud SQL
  instance is the main fixed cost at the start.
- **Phase 1 deployment (decided 2026-10-22).** Phase 1 serves only the owner,
  so it deploys a smaller footprint than the table above, for about US$50 a
  month in fixed cost:
  - **No load balancer or Cloud Armor yet.** The API serves its Cloud Run
    address behind the owner token, with a low instance cap. The load
    balancer and Cloud Armor arrive with sign-in in phase 2.
  - **The worker is an on-demand job** (D4).
  - **No database password at runtime.** The API and the worker sign in to
    Cloud SQL with IAM database authentication through Google's Cloud SQL
    connector, on its private IP. Only the migration job uses a password,
    from Secret Manager.
  - **Staging and production** are separate projects, and production
    receives the image digest staging tested.
  - **Egress.** The worker reaches only Google APIs and the OpenAI EU
    endpoint; the API has no internet egress.
- **European exit: Scaleway.** Scaleway is the planned move if Google Cloud
  stops fitting. It has serverless containers and jobs, serverless Postgres
  with `pgvector` in Paris, and S3-compatible storage. OVH needs more
  operations work, because it has no scale-to-zero container service.
  - **Switch when** Claude can be called with EU processing outside Google
    Cloud, a customer requires French or EU-sovereign hosting, or Google
    Cloud clearly costs more than Scaleway for the same load.
  - **Why not now.** Scaleway does not host Claude, and the direct Anthropic
    API has no EU processing option. On Vertex AI, CV content stays in the
    EU. Re-check before the infrastructure sprint.
  - **Keeping the exit cheap.** Containers, plain Postgres, an S3-speaking
    storage port, standard OIDC sign-in and Terraform keep a move a
    migration, not a rewrite. Neither provider sells sign-in for app users,
    so identity (D6) stays a separate service either way.

### D15. Local-first and client-server evolve in parallel

Both versions are products. Either can ship a change without waiting for
the other, and neither may break the other.

- **Shared core first.** Logic that both need lands in the shared packages
  behind ports. Each client only adds its adapter: SQLite and the filesystem
  for the desktop, Postgres and Cloud Storage for the server. A feature that
  only one version needs stays in that app.
- **One storage contract, two implementations.** A conformance test suite
  runs against both the SQLite and the Postgres implementations of the
  storage port, so they cannot drift.
- **Capabilities, not forks.** Where behaviour differs, such as provider
  routes, consent or retention, the application layer reads a capability set.
  On the desktop it comes from local settings; on the server, from
  entitlements (D13).
- **The bridge between versions** is the portable backup format (ADR 0007),
  used for import (D12). Changing it needs a version bump and a migration.

**Local development.** The desktop runs as today with `pnpm` scripts and no
cloud account. The server stack runs locally with Docker Compose: Postgres
with `pgvector`, a local object-storage emulator, the API and one worker.
The existing offline fixture mode keeps local runs free of provider calls.

**CI.** One required gate on every PR, as D2 describes:

- format, lint, typecheck and unit tests across the workspace;
- a Postgres job with a service container, running the storage
  conformance suite and the API tests;
- the packaged-desktop acceptance workflows (installed app and credential
  lifecycle) run on all three platforms for every PR that can change the
  packaged app, so a shared change that breaks the desktop fails its PR.
  PRs that change only documentation or tests skip them, and every release
  build runs them again.

**Releases.** Independent cadences from the same `main`:

| | Local-first desktop | Client-server |
|---|---|---|
| Tags | `v*`, as today | `server-v*` |
| Workflow | `release.yml`, manual | A deploy workflow: staging, then production after manual approval |
| Precondition | `pnpm release:preflight` passes locally | The evaluation gate passes on the release commit (D16) |
| Rollback | Previous installer | Previous Cloud Run revision; database migrations are backward compatible for one release |

### D16. Observability and quality evaluation

- **Observability:** the OpenTelemetry instrumentation feeds Cloud Logging,
  Monitoring and Trace with content-free attributes only.
  - Dashboards cover run success and duration, cost per run and per tenant,
    provider errors and limits, and grounding failures.
  - Alerts fire on cost spikes, failed runs and cross-tenant denials.
  - No tracing tool that captures prompts is used unless it is self-hosted
    in the EU with capture off.
  - Phase 1 starts with structured logs, log-based metrics and alerts.
    Tracing waits for phase 2, when more than one person uses the service
    (decided 2026-10-22).
- **Offline evaluation is the change gate.** The `evaluations` package and
  the manual-parity rubric run before any prompt, model or orchestration
  change, against synthetic cases and consented references kept outside the
  repo.
- **Online quality signals,** all content-free: approval rate, retracted
  claims, critic findings per run, edits before sending and re-runs. Real
  CVs are graded only with explicit consent.
- **Where live evaluation runs.** `AGENTS.md` keeps provider credentials out
  of hosted automation, so live evaluation never runs in GitHub Actions. It
  runs as a manually triggered Cloud Run job in a separate evaluation
  project, on synthetic data only. `AGENTS.md` records this exception.

### D17. Agent channel: an MCP server

Users increasingly work inside agents such as Claude, Codex or ChatGPT.
DraftLoop is offered there as an MCP server: one more client, like the CLI,
not a second product.

- **Two transports, one tool set:**
  - *Local:* `apps/mcp`, a stdio server over the same application services
    as `apps/cli`. Candidate data stays on the user's machine. It does not
    depend on the hosted phases.
  - *Hosted:* the same tools over the HTTP API (D10), with OAuth sign-in
    through the identity provider and plan credits (D13). After phase 1.
- **Tools:** list applications, start a tailored CV run from a job post,
  follow its progress, read the draft with its findings and evidence, and
  request an export. Inputs and outputs reuse the API's Zod contracts.
- **The engine stays in DraftLoop.** The host agent never writes or edits
  CV claims; it asks DraftLoop to run the author–critic workflow, so
  grounding and the critic still apply.
- **Approval stays in DraftLoop.** An export or share needs the user's
  approval in DraftLoop, never through the agent.
- **Minimal disclosure.** Whatever a tool returns reaches the host agent's
  model provider. Tools return only what was asked, never return
  never-share material, and the hosted version records consent for it.
- **Untrusted input.** Job posts and text arriving from an agent are
  handled like uploads (D11).
- *Cost:* a public tool surface to secure and keep stable. Tracked in #1403.

## Phasing (for planning only)

The stage-gated delivery method (discovery, design, evaluation gate, safety
stack, pilot, production, adoption, operation) is in the
[client-server delivery plan](../architecture/client-server-delivery-plan.md).
The phases below are the engineering slices inside it.

| Phase | Outcome | Gate |
|---|---|---|
| 0. Ports | Storage port extracted; SQLite behind it; the application driver no longer assumes the filesystem. Done in the current repo, with the desktop still green | Both local clients pass on the port |
| 1. Hosted single-tenant | API and worker on Cloud Run, Cloud SQL and Cloud Storage, Terraform, and the web review screen, for the owner's own use | A parity run on the server matches the local result |
| 2. Multi-tenant beta | Identity, organisations and candidate records, consent, entitlements and billing, deletion and export | A privacy review and a security review |
| 3. Professional features | Provenance report, reviewer role, Team and Business plans (SSO, retention, audit export, BYOK) | First paying users on each plan |
| 4. Later services | Job matching against approved job feeds, then a live advisor, both on the same credits (D13) | Each passes its own evaluation and privacy review |

Notes on phase 4:

- **Job matching** uses official job APIs and partner feeds only, never
  scraping. Embeddings shortlist jobs, and a model scores only the top
  ones, citing the profile's evidence. DraftLoop suggests jobs and never
  applies on the user's behalf.
- **Ranking candidates for recruiters** is high-risk under the EU AI Act,
  unlike recommending jobs to a candidate. The candidate-side version comes
  first; the recruiter side waits for legal review.

## Open decisions for the owner

1. ~~**Who pays first?**~~ **Decided 2026-10-16:** all profiles, through
   tiered plans (D13).
2. ~~**Pricing levels.**~~ **Working defaults accepted 2026-10-20** (D13).
   They apply once phase 1 measures a cached run at US$3 or less.
3. ~~**Hosting.**~~ **Decided 2026-10-16:** Google Cloud (D14), in
   `europe-west1` (decided 2026-10-17).
4. ~~**Identity vendor.**~~ **Decided 2026-10-17:** Keycloak managed by
   Clever Cloud (D14). It is the most widely adopted open-source identity
   server, run by a French operator, with organisations built in. Users and
   their password hashes can be exported, so any other Keycloak host is an
   exit. The cost is about €0.05 per active user beyond the first 100.
   Confirm the data processing agreement and SAML support before phase 2.
5. ~~**The desktop app's future.**~~ **Decided 2026-10-17:** it stays a
   local-first product that can keep evolving in parallel (D15). Making it
   a thin client of the service remains a later option.
6. ~~**Retention periods.**~~ **Working defaults accepted 2026-10-20**
   (D7). A fixed-price GDPR lawyer review confirms them before phase 2
   admits other users.

## Consequences

- **Phase 0 is valuable on its own.** Extracting the storage port lowers
  the largest hotspot and makes storage testable, even before any server
  exists.
- **Parity is preserved by construction**, because the engine, prompts and
  checks are shared code, not a port.
- **New obligations:** GDPR compliance, data processing agreements with
  providers, incident response, backups and uptime. These are product
  work, not only engineering.
- **Lost with the local trust model:** the strongest privacy argument
  ("your material never leaves your machine"). It is replaced by recorded
  consent, minimal transmission, encryption and the right to delete. The
  desktop app remains for users who need full local control.
- **Two products to keep green.** Every shared-package change is tested
  against both clients, which costs CI time and review care (D15).
