# Deploying the hosted service

The hosted service runs on Google Cloud in `europe-west1` (ADR 0011, D14). This
repository holds the code and the images; a private infrastructure repository
holds the Terraform, the deploy workflow and every cloud identifier (D2). No
project id, service account, pool id or bucket name belongs here.

## Releasing a server version

1. **Tag.** The owner starts the staging release workflow in the
   infrastructure repository. It tags a commit of `main` whose CI gate passed
   with `server-vX.Y.Z`: CI on the commit, and the desktop acceptance gates on
   the pull request that produced it. Server tags are independent of the
   desktop's `v*` tags, and `pnpm release:preflight` stays the rule for desktop
   releases only.
2. **Staging.** The same run checks the gate, builds the API and worker images
   from their Dockerfiles, pushes them by digest, runs the migration job and
   deploys staging.
3. **Smoke.** It runs the synthetic smoke (`pnpm test:server-smoke`, the same
   one as on the local stack) against staging. A failure stops the release.
4. **Release notes.** Once the smoke passes, the run publishes a GitHub Release
   for the tag (see [Server release notes](#server-release-notes)).
5. **Production.** A second, manual run of the deploy workflow deploys the same
   image digests to production, migrates, runs the smoke there and adds a
   `Production: deployed on <date>` line to the release.

The workflow signs in to Google Cloud through Workload Identity Federation, so
no long-lived service account key exists.

### Server release notes

Each server tag that passed on staging gets a GitHub Release titled
`Hosted service: <name> server-vX.Y.Z`. It is a pre-release and never marked
Latest, so it never takes that place from a desktop release.

- **Text.** The name, summary, known limitations, roadmap stage, stage issue
  and milestone come from [`server-release.json`](../../server-release.json) at
  the tagged commit. Update it in the last pull request of each sprint.
- **Generated parts.** `scripts/server-release.mjs` renders the notes in the
  desktop releases' layout, linking the public CI run on the source commit.
  GitHub's What's Changed since the previous server release follows, and a
  CycloneDX SBOM of the source is attached.
- **Public only.** The notes never link to the infrastructure repository or
  name a cloud identifier; `pnpm test:release` checks the file for them.

## What runs where

| Part       | Runs as                                     | Notes                                                                                                     |
| ---------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| API        | Cloud Run service                           | Scales to zero; serves its Cloud Run address behind the owner token in phase 1, and the web screen at `/` |
| Worker     | Cloud Run job                               | Drains the queue, then exits (D4)                                                                         |
| Migrations | Cloud Run job, from the worker image        | Runs before each deploy as the schema owner                                                               |
| Database   | Cloud SQL for PostgreSQL 16 with `pgvector` | Private IP only, backups and point-in-time recovery                                                       |
| Objects    | One Cloud Storage bucket per environment    | Encrypted with a customer-managed key                                                                     |
| Secrets    | Secret Manager in `europe-west1`            | Owner token, the critic's OpenAI EU key, migration login                                                  |

The owner opens the web screen at the API's address and signs in with the
owner token from Secret Manager. The screen keeps the token in the browser tab
until it closes; sign-in through the identity provider replaces it in phase 2.

Each part has its own service account with only the access it needs. The
worker may reach Google APIs and the OpenAI EU endpoint and nothing else; the
API has no internet egress unless the model screener is on (see Settings).

## Settings

The images read the settings listed in
[the local server stack](local-server-stack.md): the database, the tenant, the
bucket, the owner token, the run ceilings and the model routes. A deployment
sets them from its infrastructure. Unlike the local stack, it:

- leaves `DRAFT_LOOP_GCS_ENDPOINT` unset;
- sets `DRAFT_LOOP_CLOUD_SQL_INSTANCE`, so the services reach the database
  through the Cloud SQL connector with no runtime password, and lists their IAM
  database users in the migration job's `DRAFT_LOOP_RUNTIME_MEMBERS`;
- runs the worker in drain mode (`DRAFT_LOOP_WORKER_MODE=drain`) and gives the
  API `DRAFT_LOOP_WORKER_JOB`, so the API starts the worker job after each
  queued run; a Cloud Scheduler sweep starts it every 10 minutes for retries
  and resumed runs, and the API's identity needs permission to run that job;
- sets `DRAFT_LOOP_ALLOW_PROVIDER_DATA` and the model routes on the worker, and,
  in sign-in mode, the same `DRAFT_LOOP_AUTH_MODE=oidc` as the API. The worker
  then always checks consent as it claims each job, and refuses to start if
  `DRAFT_LOOP_REQUIRE_CONSENT=false` is also set;
- gives the worker the same `DRAFT_LOOP_SCREENING` as the API, so a run on
  material with no stored screening result is held there as the API refuses it;
- leaves `DRAFT_LOOP_SCREENING` at its default, `rules`, or sets `rules+model`
  on the API. The model screener calls Claude Haiku on the EU Vertex route with
  the API's own identity, so the API needs the Vertex settings, permission to
  call Vertex AI and egress to Google APIs, which the infrastructure
  repository grants; without them every model screening fails closed to
  `unscreened`. It also reads `DRAFT_LOOP_ALLOW_PROVIDER_DATA`, the ceiling
  above consent for screening candidate sources with the model.

## Before a provider run on staging

The synthetic smoke runs in fixture mode and calls no model. A run with real
models, such as the [hosted parity](../evaluation/hosted-parity.md) run, needs
two things the code cannot set up:

- the critic's OpenAI EU key, added by the owner as a value of its secret;
- Claude enabled in the Vertex AI Model Garden for the project, with quota in
  the EU multi-region for the author's model.

Real reference material goes on staging only with the owner's recorded
consent; otherwise use synthetic material.

## Assigning plans and granting credits

Until a payment provider lands, the operator assigns each organisation's plan
and grants credits with the owner token, the only credential the
`/v1/operator/*` routes accept.

- **Assign:** `PUT /v1/operator/organisations/{organisationId}/plan` with
  `planId` (`individual`, `job-search-pass`, `pro`, `team`, `business` or
  `internal`), optional `overrides`, `seats` (required for `team` and
  `business`) and `periodStart` (a UTC date, today by default). It replaces
  the current plan, keeps the earlier ones as history and answers the
  entitlements the plan resolves to.
- **Grant:** `POST /v1/operator/organisations/{organisationId}/credit-grants`
  with `credits` (1 to 1,000,000) and a `reason` code such as `goodwill`,
  never free text, and an `Idempotency-Key` header. Repeat the same key to
  retry safely. Granted credits expire after 12 months and are spent after the
  plan's allowance.
- **Check:** `GET /v1/operator/organisations/{organisationId}/credits` answers
  the plan, its entitlements and the balance.
- **Errors:** 422 `invalid_plan_assignment` for an unknown plan or missing
  seats, 404 `organisation_not_found`, 409 `idempotency_conflict` for a key
  reused with another amount.
- **Effect:** a member's run start reads the plan and reserves its credits
  (see the [architecture overview](../architecture/overview.md)). An
  organisation with no plan is refused with 403 `plan_required` until the
  operator assigns one. Inviting past the plan's seats or creating a record
  past its record limit answers 409 `plan_limit_reached`.
- **Members' view:** `GET /v1/organisation/credits` shows any signed-in member
  the plan, its limits, the balance and an 80% `warning`; the 80% and
  exhaustion thresholds also write alert lines (see [Alert lines](#alert-lines)).
- **Trail:** each write logs one `audit` line with ids, the plan id, numbers
  and the reason code, and no free text.
- **Owner-token mode:** a deployment on the owner token has one tenant with no
  organisation row, so it holds no plan and no ledger. It skips the run gate
  and is not metered; plans and credits apply in sign-in mode only.

Example requests for a fictional organisation, with `$API` the API's address
and `$OWNER_TOKEN` the deployment's owner token. This gives Fern Careers the
Individual plan with a credit allowance of 5 for the period, then grants it two
more credits:

```sh
curl -X PUT "$API/v1/operator/organisations/org-fern/plan" \
  -H "authorization: Bearer $OWNER_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"planId":"individual","overrides":{"creditsPerPeriod":5}}'

curl -X POST "$API/v1/operator/organisations/org-fern/credit-grants" \
  -H "authorization: Bearer $OWNER_TOKEN" \
  -H 'idempotency-key: grant-org-fern-0001' \
  -H 'content-type: application/json' \
  -d '{"credits":2,"reason":"goodwill"}'

curl "$API/v1/operator/organisations/org-fern/credits" \
  -H "authorization: Bearer $OWNER_TOKEN"
```

A seat-priced plan needs its seats, for example
`{"planId":"team","seats":3}`. The
[worker flow test](../../apps/worker/src/plans-credits-flow.test.ts) runs this
sequence against Postgres with scripted providers.

## Erasing records and organisations

Owners and admins delete a candidate record from the web screen or with
`DELETE /v1/workspaces/{workspaceId}`; an owner deletes the organisation with
`DELETE /v1/organisation`, and the operator with
`DELETE /v1/operator/organisations/{organisationId}`. Each asks for the id
typed back and refuses while a run is queued or running. In owner-token mode,
the operator erases the deployment's own tenant (`DRAFT_LOOP_TENANT_ID`) the
same way, although no organisation was ever registered for it. Deleting an
organisation locks it first: its members get 409 `organisation_closing` until
a repeated delete finishes. Offer the record's
archive first: deletion cannot be undone.

- **What goes:** the record's stored objects in the bucket (sources and
  exported documents), then its rows: settings, runs, drafts, knowledge
  bases, assignments, consent ledger and audit trail. Deleting an organisation
  does this for every record, removes every object under the tenant's prefix,
  then the organisation and its members.
- **What stays:** accounts at the identity provider. A deleted member can
  still sign in there, but reaches no organisation; remove the account at the
  provider if the person asks.
- **Backups:** database backups and point-in-time recovery still hold the
  deleted rows until they age out, within 35 days. The infrastructure
  repository sets that window. A restore from an older backup must repeat the
  deletions made since.

## Logs

The API and the worker write one JSON object per line to standard output, with
a `severity` and a `message`, which Cloud Logging reads as structured entries.
The lines are content-free (ADR 0011, D16):

- **API requests** log their method, route pattern, status and duration, never
  headers, bodies, query strings or client addresses.
- **Errors** log their type, code and stack frames, never their message, which
  may quote what a person sent.
- **Each worker job** logs one `run job finished` line with the tenant,
  workspace and run ids, the job's outcome, the run's state, and its usage so
  far: calls, tokens and estimated cost, in total and by company, model and
  route.
- **Each run whose credits were settled or refunded** logs one
  `run credits settled` `INFO` line (see below).
- **Each failed provider call** logs one `provider call failed` line before
  it: the run id, step, role and attempt; the company, model and route; the
  HTTP status and the normalized code; the provider's own error `type` and
  `code` when each is a short token; and, for a rate limit, which limit ran out
  and the Retry-After seconds. When DraftLoop rejected the call's output, the
  line also names the `failureStage` and the diagnostic codes and field paths,
  never a value. A call the run retries is a `WARNING`, any other an `ERROR`.
- **Each refused export** logs one `export refused by rendering checks`
  `WARNING` line with the `format`, the `failedChecks` (such as
  `visible-content` or `page-target`) and, for a PDF, the
  `undrawableCharacters` as `U+XXXX` code points.
- **Each job page that cannot be read** logs one `job page fetch failed`
  `WARNING` line with the fetcher's `issueCode` (such as `fetch-failure`,
  `unsafe-url` or `fetch-timeout`), the address's `host` and the
  `durationMs`, never its path, query or text. The person sees a message that
  matches the code.

The run's failure keeps the same fields. The API returns the call as the run's
`lastError.failedCall` and a rejection's stage and diagnostics beside it, so
the web screen can name the call that failed and why.

### Margin line

When the worker settles or refunds a run's reserved credits, it writes one
`INFO` line whose exact `message` is `run credits settled`. A repeated job
writes nothing more. A log-based margin alert compares the
credits with the cost. The fields sit at the top level of the entry and are a
stable contract:

- **`organisationId`** and **`runId`**: the organisation and the run.
- **`credits`**: the credits the reservation held.
- **`estimateVersion`**: the version of the credit estimate rule that priced it.
- **`outcome`**: `settled` when the run had a draft, `refunded` when it ended
  without one. A refund still carries the cost the run incurred.
- **`estimatedUsd`**: the run's estimated US dollar cost from its usage, the
  same number as `usage.estimatedUsd` on its `run job finished` line, or `null`
  when no run was read (an erased record).

A run with no reservation, as in owner-token mode, writes no line. If the
reconciliation of an organisation's stale reservations fails, the worker
writes an `ERROR` line `run credit reconciliation failed` with the `tenantId`
and the error's type, code and stack frames, and the job is unaffected.

### Alert lines

Six `WARNING` lines are the owner's alerts on injection screening, on refused
access and on credit use. The infrastructure matches each on its exact
`message`. They carry ids, closed codes and numbers only, never candidate
text, file names, titles, email addresses or the reason a member types for a
release.

- **`access refused`** (API) is written when a record or knowledge base is
  refused to a member. Field `accessRefusal`: `resource`, `reason`, `tenantId`,
  `memberId`, `resourceId`.
- **`material quarantined`** (API) is written at intake when a result is
  `flagged` or `unscreened`. Field `screening`: `tenantId`, `resultId`,
  `subjectKind`, `verdict`, `signals`.
- **`quarantined material released`** (API) is written when an owner or admin
  releases a result. Fields `screening` (`tenantId`, `resultId`, `subjectKind`,
  `signals`) and `audit`.
- **`run paused for quarantined material`** (worker) is written when a claimed
  job pauses its run. Fields `screening` (`tenantId`, `resultIds`, `signals`),
  the job's `tenantId`, `workspaceId` and `runId`, and `quarantined`, each
  piece's kind, result id and signals.
- **`credit allowance 80% used`** (API) is written when starting a run takes an
  organisation's use of the period's allowance from under 80% to at least 80%.
- **`credit balance exhausted`** (API) is written when starting a run takes the
  organisation's `remaining` credits to 0.

Both credit lines carry, at the top level of the entry, `organisationId`,
`periodEnd` (the UTC date the period ends), `allowance`, `used` and
`remaining`, besides the request's own `tenantId` and `memberId`. `used` counts the allowance's
settled credits and the credits reserved from it, the figure
`GET /v1/organisation/credits` reports. Each fires once per crossing, so once
per period in practice. A refund that brings the balance back under a
threshold, followed by a new reservation, crosses it again. Unlimited plans
and a zero allowance never write the 80% line.

The fields of `accessRefusal`:

- **`resource`** is `record` or `knowledge-base`. `run` is reserved: a run the
  tenant does not have is indistinguishable from a missing one.
- **`reason`** is `unassigned` when the record, or the record that owns the
  knowledge base, exists and the member is not assigned to it, and `role` when
  a member tries an action only owners and admins may take. `other-tenant` is
  reserved for a refusal the API can prove crosses tenants; row-level security
  hides another tenant's rows, so today none is written.
- **The answer is unchanged:** 404 for an unreachable record or base, 403 for a
  role.
- **Not logged:** a 404 for an id that does not exist, and a row hidden by
  row-level security. The owner token is never refused.

`subjectKind` is `job-source` or `knowledge-source-version`, and `signals` are
the closed screening codes.

The infrastructure builds its log-based metrics and alerts on these fields.
