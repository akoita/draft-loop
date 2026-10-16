# ADR 0011: A client-server version beside the frozen local-first app

- Status: Proposed
- Date: 2026-10-16
- Decision owners: DraftLoop maintainers

## Context

DraftLoop is a local-first desktop app. The candidate's evidence, profile,
runs and exports live on their machine. Model providers receive only the
bounded material each run sends, after a visible approval. The last
local-first stage (#1309) brings CV quality to parity with the manual
Claude/Codex loop. The local version is then frozen in maintenance mode
(#1308).

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

### D1. Topology: a modular monolith with background workers

One TypeScript service exposes the API and runs the application service.
Separate **worker** processes execute runs, ingestion and embeddings from a
durable queue. A **web client** is the main interface.

- **Why:** the packages are already modules with enforced boundaries.
  Microservices would add network seams where function calls work today.
- **Consequence:** one deployable API plus one worker image, both built from
  the same packages.

### D2. Repository: same monorepo, new apps

Add `apps/api`, `apps/worker`, `apps/web` and `packages/storage-postgres`.
The architecture rules in `AGENTS.md` apply unchanged: domain owns concepts,
the orchestrator stays SDK-free, and adapters do not hold domain logic.

- **Why:** parity depends on running the exact same engine and prompts. One
  repository keeps that true by construction.
- **Consequence:** the frozen desktop app keeps building from the same
  packages. Package changes must keep both clients green until the desktop
  is retired.

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
- **Object storage** (S3-compatible) holds uploaded sources and exports.
  Objects are encrypted at rest and addressed by content checksum.
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

### D5. Providers: API routes, a platform-managed default, optional BYOK

- **API adapters only** on the server. The subscription CLI routes stay
  desktop-only.
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
  Retention is a per-tenant policy.
- **No hidden reasoning stored.** Only structured findings, decisions and
  user-visible rationale, as in the local version.
- **`AGENTS.md` data rules will change** when this ADR is accepted. "Keep
  material local by default" becomes "store only with recorded consent,
  send only the bounded approved material".

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
- **The desktop app** stays the frozen local-first product. Making it a
  thin client of the service is a later, separate decision.
- **The CLI** becomes an API client, for scripting and support.

### D10. API contract

- **One typed HTTP API** shaped on `ApplicationService`. Request and response
  schemas come from the existing Zod contracts. OpenAPI is generated from
  them.
- **Allowlist validation.** The desktop bridge's exact-key validation
  becomes the API's input validation, with the same drift tests.
- **Versioned from day one** (`/v1`), with idempotency keys on commands that
  start runs or exports.

### D11. Ingestion, retrieval and fetching

- **Ingestion runs in sandboxed workers.** Uploaded PDFs and DOCX files are
  untrusted input, so workers get no network access and bounded memory and
  time.
- **Embeddings:** the same pinned model runs on CPU workers. Vectors go in
  Postgres with pgvector, keeping retrieval in the same database and tenant
  boundary. Lexical retrieval stays the default where it is today.
- **Approved URL fetching** goes through an egress-controlled fetcher. The
  existing rule holds: a URL is fetched only after the candidate approves
  it.

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
- **Billing:** a payment provider with subscriptions, seats and usage-based
  overage (for example Stripe). Billing state only feeds entitlements; the
  domain never depends on it.
- **The quality engine is the same on every plan.** Plans gate volume,
  models and professional features, never the grounding, critic or
  validation that make a CV truthful.

### D14. Hosting on Google Cloud

The owner decided (2026-10-16) to host on Google Cloud. The components map
onto managed services in one EU region (for example `europe-west9`, Paris,
or `europe-west1`):

| Component | Google Cloud service |
|---|---|
| API (D1, D10) | Cloud Run service behind an external HTTPS load balancer, with Cloud Armor |
| Workers (D4, D11) | Cloud Run worker pools or always-on Cloud Run services pulling from the queue; ingestion in a separate service with no egress |
| Database (D3) | Cloud SQL for PostgreSQL with `pgvector`, private IP, automated backups and point-in-time recovery; AlloyDB if load requires it |
| Queue (D4) | Postgres-backed, in the same Cloud SQL instance, so run state and jobs commit together; Cloud Tasks or Pub/Sub only for fan-out that needs it |
| Objects (D3) | Cloud Storage, with CMEK through Cloud KMS and per-tenant prefixes |
| Secrets and BYOK keys (D5) | Secret Manager for platform secrets; Cloud KMS envelope encryption for customer keys |
| Identity (D6) | Identity Platform: OIDC, SAML and multi-tenancy for Business SSO. Confirm EU data handling before committing, or use a third-party vendor |
| URL fetching (D11) | A fetcher service with egress only through Cloud NAT and Secure Web Proxy rules |
| Observability | Cloud Logging, Monitoring and Trace through the OpenTelemetry instrumentation the packages already have, with content-free attributes only |
| Infrastructure | Terraform, Artifact Registry, and GitHub Actions deploying through Workload Identity Federation (no long-lived service account keys) |

- **Model providers.** The Anthropic and OpenAI APIs stay the default pair.
  Claude on **Vertex AI** in an EU region is an option worth evaluating for
  Anthropic models. It offers EU processing, Google Cloud billing and
  enterprise terms, at the cost of a new provider adapter and model-id
  mapping. OpenAI models stay on OpenAI's API.
- **Isolation.** Production in its own project, with separate service
  accounts for API, workers, ingestion and fetcher, each with least
  privilege. Business plans can later move to Assured Workloads controls.
- **Cost.** Cloud Run scales to zero for the API, and a small Cloud SQL
  instance is the main fixed cost at the start.

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

## Open decisions for the owner

1. ~~**Who pays first?**~~ **Decided 2026-10-16:** all profiles, through
   tiered plans (D13).
2. **Pricing levels.** Prices and run allowances per plan, and whether
   overage is billed or blocked. The plan structure itself is set in D13.
3. ~~**Hosting.**~~ **Decided 2026-10-16:** Google Cloud (D14). Still to
   choose: the exact EU region.
4. **Identity vendor.** Identity Platform is the default proposal (D14),
   subject to confirming its EU data handling.
5. **The desktop app's future.** It could stay frozen and local, or later
   become a thin client of the service.

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
  frozen desktop app remains for users who need full local control.
