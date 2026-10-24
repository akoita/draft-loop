# Local server stack

The client-server version runs locally with Docker Compose: Postgres 16 with
`pgvector`, a Cloud Storage emulator, the API and one worker. It needs no cloud
account and makes no provider calls (ADR 0011, D15). The desktop and the CLI do
not use it.

You need Docker with the Compose plugin, plus the repository's usual Node and
pnpm versions.

## Commands

From the repository root:

```sh
pnpm server:up     # build the images, start the stack and wait until it is healthy
pnpm server:test   # start or update the stack, then run the server suites and the smoke
pnpm server:down   # stop the services and keep their data
```

To also delete the stored data, run `docker compose down --volumes`.

## Web screen

The API serves the owner's web screen (`apps/web`) at
`http://127.0.0.1:58080/`. Sign in with the local owner token,
`local-stack-owner-token-not-a-secret`, then go through its steps:

1. **Workspace:** create the `owner` workspace. Tick fixture mode on the local
   stack, since it makes no provider calls. Optionally paste your writing
   policy; each save is a new version that the next runs follow.
2. **Sources:** record the basis for storing the candidate's material, create
   a knowledge base, upload PDF, DOCX, Markdown or text files, and tick the
   bases runs use. Under each base, mark private Markdown sections by heading
   as never-share or sensitive.
3. **Job brief:** paste a job post, check and edit what was read, and mark the
   version reviewed.
4. **Run:** record the candidate's consent to send material to the
   workspace's model providers, then start a run and follow it; the worker
   drafts it to your review.
5. **Review:** decide the findings with their evidence, edit blocks, then
   approve or ask for another round, and export and download the CV.

Each consent panel shows the current state and its history, and withdraws a
grant. A refused upload or run that lacks a consent points to the step that
records it.

Injection screening shows as a text badge beside each uploaded file and under
the job brief's heading: screened clear, quarantined (flagged, with the signals
found in words, or not screened because a screener failed), released, or not
screened when nothing was stored. A run that screening refuses (409
`material_quarantined`) lists what is quarantined in the Run step. Owners and
admins, and the owner token, get a **Release** button for each piece; it opens
a dialog that requires a reason of up to 500 characters. Members see the
status and are told to ask an owner or admin.

The screen asks the API's public `GET /v1/auth/config` how to sign in. In
`oidc` mode (`DRAFT_LOOP_AUTH_MODE=oidc`) it has no token field: **Sign in**
goes to the identity provider with the authorization code and PKCE, as the
public client `DRAFT_LOOP_OIDC_WEB_CLIENT_ID`, and returns to the screen's
address, `/`, which the provider must accept as a redirect and post-logout
address. Its tokens stay in the tab's session storage and are refreshed before
they expire. An account that belongs to no organisation is told so and signed
out at the provider.

In `oidc` mode, owners and admins also see **Export or delete this record**
above the steps; members do not. **Export everything** downloads the record's
archive, and **Delete record** erases the record for good once its id is typed
back. A record with a queued or running run asks you to stop the run first.

### Sign-in on the stack

The stack also runs Keycloak and a second API, `api-oidc`, in `oidc` mode at
`http://127.0.0.1:58082/`. Keycloak imports the realm `draft-loop-local` from
`compose/keycloak/` with fictional people only:

| Username | Email               | Password                 | Email verified |
| -------- | ------------------- | ------------------------ | -------------- |
| `ada`    | `ada@org-a.example` | `local-stack-password-a` | yes            |
| `ben`    | `ben@org-b.example` | `local-stack-password-b` | yes            |
| `una`    | `una@org-a.example` | `local-stack-password-u` | no             |

A person signs in only once an organisation has invited their verified email.
Create one with the operator token, then sign in at `http://127.0.0.1:58082/`:

```sh
curl -X POST http://127.0.0.1:58082/v1/operator/organisations \
  -H 'authorization: Bearer local-stack-owner-token-not-a-secret' \
  -H 'content-type: application/json' \
  -d '{"organisationId":"org-a","name":"Org A","firstOwnerEmail":"ada@org-a.example"}'
```

Assign the organisation a plan and grant it credits with the same token. A
plan id is one of `individual`, `job-search-pass`, `pro`, `team`, `business` or
`internal`; `team` and `business` also need `seats`. The grant needs an
`Idempotency-Key`, and its `reason` is a short code, never free text:

```sh
curl -X PUT http://127.0.0.1:58082/v1/operator/organisations/org-a/plan \
  -H 'authorization: Bearer local-stack-owner-token-not-a-secret' \
  -H 'content-type: application/json' \
  -d '{"planId":"pro"}'
curl -X POST http://127.0.0.1:58082/v1/operator/organisations/org-a/credit-grants \
  -H 'authorization: Bearer local-stack-owner-token-not-a-secret' \
  -H 'idempotency-key: grant-org-a-0001' \
  -H 'content-type: application/json' \
  -d '{"credits":50,"reason":"goodwill"}'
```

The realm's clients are `draft-loop-web` (the screen, code flow with PKCE) and
`draft-loop-local-smoke` (the password grant, for the smoke test only). Both
put the audience `draft-loop-api` in their access tokens. Tokens name the
issuer `http://127.0.0.1:58081/realms/draft-loop-local`, the address the
browser uses; the API fetches the signing keys inside the Compose network
(`DRAFT_LOOP_OIDC_JWKS_URL`). Keycloak's admin console is at
`http://127.0.0.1:58081/admin` with `admin` /
`local-stack-keycloak-admin-not-a-secret`.

To work on the screen itself, run `pnpm --filter @draft-loop/web dev`. Vite
serves it with hot reload and forwards `/v1` to the API at
`DRAFT_LOOP_WEB_API_URL`, `http://127.0.0.1:8080` by default; point it at
`http://127.0.0.1:58080` to use the local stack.

## Services

| Service    | What it is                                    | Local address                                           |
| ---------- | --------------------------------------------- | ------------------------------------------------------- |
| `postgres` | `pgvector/pgvector:0.8.0-pg16`                | `postgres://postgres:postgres@127.0.0.1:55432/postgres` |
| `gcs`      | `fsouza/fake-gcs-server:1.56.1`               | `http://127.0.0.1:4443`                                 |
| `api`      | `apps/api/Dockerfile`, the `/v1` HTTP API and the web screen at `/` | `http://127.0.0.1:58080`                                |
| `api-oidc` | The same image in `oidc` mode, signing members in through Keycloak | `http://127.0.0.1:58082`                                |
| `keycloak` | `keycloak/keycloak:26.7.5` in development mode, with the fictional realm | `http://127.0.0.1:58081`                                |
| `worker`   | `apps/worker/Dockerfile`, executes queued runs | none                                                    |

- Every published port listens on `127.0.0.1` only. The Postgres port is
  55432, so it does not clash with a Postgres server already on 5432.
- Three one-shot services run first, doing what a deployment's infrastructure
  does instead:
  - `postgres-setup` creates the runtime role `draft_loop_app`;
  - `migrate` runs the worker image's migration job, which migrates storage
    and the run queue as the schema owner and grants the runtime role table
    access only;
  - `gcs-setup` creates the bucket `draft-loop-local`.
- The API and the worker connect as `draft_loop_app` and keep blobs in the
  emulator. In owner mode, the stack's default, the owner token acts in one
  tenant, `local`; in `oidc` mode each member acts in their own organisation.
  The worker runs any tenant's queued job in that tenant. Every credential in
  `compose.yaml` is a fixed local-only value; the API's owner token is
  `local-stack-owner-token-not-a-secret`.
- Data lives in the named volumes `postgres-data` and `gcs-data`.

## Images

Both images are built from the repository root on `node:24.22.1-bookworm-slim`.
Each installs only its app's production dependency graph from the lockfile and
runs the TypeScript sources with `tsx`, so there is no separate build step. The
API image is the exception for its web screen: a separate stage builds
`apps/web` with Vite and copies only the built files in. The worker image also
runs the migration job (`src/migrate.ts`).

The install happens in a separate build stage, so pnpm and its store stay out
of the images. The embedding runtime (`onnxruntime-node`) ships native binaries
for every platform:

- The API image leaves it out, because the API never embeds text and the
  runtime loads only on demand.
- The worker image keeps only the Linux build for the image's architecture:
  x64 for Cloud Run, or arm64 on an Apple-silicon machine.

| Image  | Before (2026-10-22) | After   | `node_modules` before → after |
| ------ | ------------------- | ------- | ----------------------------- |
| api    | 1.09 GB             | 630 MB  | 515 MB → 228 MB               |
| worker | 1.09 GB             | 694 MB  | 515 MB → 272 MB               |

Sizes are as `docker images` reports them; about 330 MB of each is the Node
base image.

They read their settings from the environment, so the same images run in a
deployment with that deployment's values:

| Variable                                | Used by        | Meaning                                                         |
| --------------------------------------- | -------------- | --------------------------------------------------------------- |
| `DRAFT_LOOP_DATABASE_URL`               | API, worker    | The runtime role's connection                                   |
| `DRAFT_LOOP_DATABASE_SCHEMA`            | all            | Storage schema, default `draft_loop`                            |
| `DRAFT_LOOP_QUEUE_SCHEMA`               | all            | Run queue schema, default `draft_loop_queue`                    |
| `DRAFT_LOOP_TENANT_ID`                  | API            | The tenant the owner token acts in: required in `owner` mode, optional in `oidc` mode; the worker takes each job's own |
| `DRAFT_LOOP_BLOB_BUCKET`                | API, worker    | The Cloud Storage bucket                                        |
| `DRAFT_LOOP_GCS_ENDPOINT`               | API, worker    | An emulator; unset in a deployment                              |
| `DRAFT_LOOP_API_OWNER_TOKEN`            | API            | The owner's bearer token, at least 32 characters; also the operator's credential, the only one `/v1/operator/*` routes accept in either mode |
| `PORT`                                  | API            | Listening port, default 8080                                    |
| `DRAFT_LOOP_AUTH_MODE`                  | API, worker    | `owner` (the default) accepts only the owner token; `oidc` accepts the identity provider's access tokens, resolves each to an organisation member through the tenant directory, and keeps the owner token for operators |
| `DRAFT_LOOP_OIDC_ISSUER`                | API            | In `oidc` mode, the provider's issuer, an https URL matched exactly |
| `DRAFT_LOOP_OIDC_AUDIENCE`              | API            | In `oidc` mode, the audience the API's tokens carry             |
| `DRAFT_LOOP_OIDC_WEB_CLIENT_ID`         | API            | In `oidc` mode, the web screen's public client id               |
| `DRAFT_LOOP_OIDC_JWKS_URL`              | API            | The provider's key set; discovered from the issuer when unset   |
| `DRAFT_LOOP_OIDC_ALLOW_HTTP`            | API            | `1` accepts plain-http provider addresses, for the local stack only |
| `DRAFT_LOOP_MAX_SOURCE_BYTES`           | API            | Largest candidate source upload, default 10485760 (10 MiB), at most 30 MiB |
| `DRAFT_LOOP_WEB_ROOT`                   | API            | The built web screen's directory, served at `/`; the image sets it |
| `DRAFT_LOOP_WORKER_JOB`                 | API            | The worker's Cloud Run job, `projects/<p>/locations/<l>/jobs/<j>`, started after each queued run; unset locally |
| `DRAFT_LOOP_ALLOW_PROVIDER_DATA`        | API, worker    | `true` lets runs, and the API's model screener for candidate sources, send approved material to providers; default `false` |
| `DRAFT_LOOP_SCREENING`                  | API, worker    | Injection screening at intake: `off`, `rules` (the default) or `rules+model`; another value is a startup error. `rules+model` needs the Vertex settings under [Model routes](#model-routes). Unless it is `off`, a run on material with no stored result is refused (API) or held (worker). Give the worker the API's value; the worker screens nothing itself |
| `DRAFT_LOOP_REQUIRE_CONSENT`            | worker         | In `owner` mode, `true` checks each job's candidate record's provider transmission consent before any provider call and pauses the run without it; default `false`. Under `DRAFT_LOOP_AUTH_MODE=oidc` the check is always on and `false` is a startup error. The stack's one worker also serves the owner-mode API, so it runs in `owner` mode with the check off |
| `DRAFT_LOOP_WORKER_READY_FILE`          | worker         | Touched once the worker claims jobs, for a health check         |
| `DRAFT_LOOP_WORKER_MODE`                | worker         | `serve` (the default) keeps claiming jobs; `drain` exits once the queue stays empty, for a Cloud Run job |
| `DRAFT_LOOP_WORKER_IDLE_MS`             | worker         | In drain mode, how long the queue stays empty before the worker exits, default 60000 |
| `DRAFT_LOOP_RUN_MAX_ROUNDS`             | API, worker    | Required ceiling on a run's rounds                              |
| `DRAFT_LOOP_RUN_MAX_COST_USD`           | API, worker    | Required ceiling on a run's estimated cost, in US dollars       |
| `DRAFT_LOOP_RUN_MAX_DURATION_MS`        | API, worker    | Required ceiling on a run's duration, in milliseconds           |
| `DRAFT_LOOP_MIGRATION_DATABASE_URL`     | migration job  | The schema owner's connection                                   |
| `DRAFT_LOOP_RUNTIME_ROLE`               | migration job  | The role the API and the worker connect as                      |
| `DRAFT_LOOP_RUNTIME_MEMBERS`            | migration job  | Cloud SQL IAM database users made members of the runtime role, comma-separated; unset locally |
| `DRAFT_LOOP_CLOUD_SQL_INSTANCE`         | all            | A Cloud SQL connection name; turns on Google's connector, see below |
| `DRAFT_LOOP_CLOUD_SQL_SOCKET_DIR`       | all            | The connector's socket directory, default `/tmp/cloudsql` |

## Cloud SQL

The stack connects to Postgres with plain URLs. On Cloud Run, setting
`DRAFT_LOOP_CLOUD_SQL_INSTANCE` starts Google's Cloud SQL connector in each
process before it opens the database. The connector opens a TLS tunnel to the
instance's private IP and listens on a Unix socket in
`DRAFT_LOOP_CLOUD_SQL_SOCKET_DIR`, so the database URL names that directory as
its host, for example `postgres://<user>@/postgres?host=/tmp/cloudsql`.

- **The API and the worker** sign in with IAM database authentication as their
  service identities, so their URLs carry no password.
- **The migration job** signs in as a built-in schema-owner user with a
  password. It creates the runtime role without login when it is missing and
  makes the users in `DRAFT_LOOP_RUNTIME_MEMBERS` its members, so the services
  get table access only.

## Model routes

The stack sets no model routes, so its runs use fixtures and call no provider.
Without them the worker knows no provider key, so a provider call fails rather
than reading a key from the environment.

A deployment turns the routes on with the worker settings below. Values come
from the deployment's configuration, never from this repository.

| Variable                          | Meaning                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `DRAFT_LOOP_VERTEX_PROJECT_ID`    | The Google Cloud project that serves Claude on Vertex AI; setting it turns the routes on |
| `DRAFT_LOOP_VERTEX_LOCATION`      | `eu` (the default) or a `europe-*` region; any other location is refused         |
| `DRAFT_LOOP_VERTEX_PRICE_FACTOR`  | The location's price factor over first-party rates, at least 1                   |
| `DRAFT_LOOP_OPENAI_KEY_SECRET`    | The Secret Manager version holding the critic's OpenAI EU project key            |
| `DRAFT_LOOP_OPENAI_ENDPOINT`      | `eu` (the default) or `global`, OpenAI's endpoint outside the EU                 |
| `DRAFT_LOOP_ANTHROPIC_FALLBACK`   | `true` allows the direct Claude API as a recorded fallback; default `false`      |
| `DRAFT_LOOP_ANTHROPIC_KEY_SECRET` | The Secret Manager version holding the Claude API key; only with the fallback on |

- The author calls Claude on Vertex AI with the worker's service identity, so
  no Claude key exists unless the fallback is on. The direct Claude API
  processes material outside the EU, which is why the fallback is off by
  default.
- The critic calls OpenAI's EU endpoint, `https://eu.api.openai.com/v1`, with
  a key from a project created with EU data residency. A deployment whose
  OpenAI organization cannot create such a project may set `global` instead,
  which processes material outside the EU; the worker logs its routes at
  every start.
- Keys are read from Secret Manager at call time and kept in memory for five
  minutes.
- The API reads `DRAFT_LOOP_VERTEX_PROJECT_ID`, `DRAFT_LOOP_VERTEX_LOCATION` and
  `DRAFT_LOOP_VERTEX_PRICE_FACTOR` only with `DRAFT_LOOP_SCREENING=rules+model`,
  for the injection screener's Claude Haiku calls. It uses its own service
  identity and has no direct Claude API fallback.

To check both routes by hand with synthetic data, set the same variables, sign
in with an identity that may call Vertex AI and read the secrets, and run:

```sh
DRAFT_LOOP_LIVE_CRITIC_MODEL=<the critic's OpenAI model> pnpm test:gateway:live
```

It makes one Vertex call and one OpenAI EU call, and prints each route, model,
token count and cost. It never runs in CI. `DRAFT_LOOP_LIVE_AUTHOR_MODEL`
picks the Claude model, `claude-haiku-5-5` by default.

In CI, `pnpm test:postgres` drives one run through the same routes with
scripted Vertex AI, OpenAI and Secret Manager endpoints. It checks each call's
recorded route and cost, including the application plan's calls, and that
the usage routes report the run's whole cost.

## Tests against the stack

`pnpm server:test` runs `docker compose up --detach --wait --build`, then three
suites with the stack's addresses and local values in the environment:

1. `pnpm test:postgres`, against `DRAFT_LOOP_TEST_POSTGRES_URL`;
2. `pnpm test:gcs`, against `DRAFT_LOOP_TEST_GCS_URL`;
3. `pnpm test:server-smoke`, the end-to-end smoke against
   `DRAFT_LOOP_TEST_API_URL`, and the sign-in smoke against
   `DRAFT_LOOP_TEST_OIDC_API_URL` and `DRAFT_LOOP_TEST_OIDC_ISSUER_URL`.

The smoke takes runs from setup to a downloaded CV through the API only, with
synthetic data and no database seeding:

1. **Setup.** It creates a fixture-mode workspace and a knowledge base, uploads
   one Markdown source and selects it, then creates, edits and reviews a job
   brief.
2. **Draft.** It begins a run and waits for the worker to draft it to the
   person's review.
3. **Review and approve.** It reads the review, accepts every finding and
   approves the run, with an override rationale when the final checks block
   approval.
4. **Export.** It exports a DOCX, lists the run's exports, downloads the
   document and checks its size and SHA-256 against the export's record.

The sign-in smoke creates two organisations with the operator token and signs
`ada` and `ben` in through Keycloak. Each lands in their own organisation, and
`ben` gets 404 for a workspace `ada` created. The operator route refuses a
member's token, and an invited person whose email is not verified gets 403.

A second run takes one revision round with a candidate direction before the
same review, approval and export.

`pnpm test:postgres` drives the same flow in-process against Postgres, without
the containers, so the CI `Server storage` job covers it too. That test runs
the API's routes and the worker's job handler over one database, with exports
in a local folder in place of the bucket. A second in-process test takes the
same flow through the web screen's typed client, so a screen call that drifts
from the API fails there.

To run one suite, set its variables yourself. CI does not use this file: its
`Server storage` job starts the Postgres and emulator images as its own
containers and runs the first two suites.

Cloud deployment is described in [Deploying the hosted service](server-deploy.md);
its Terraform and workflow live in a private infrastructure repository
(ADR 0011, D2).
