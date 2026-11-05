# Local server stack

This page is for a contributor who runs the client-server version on their own
machine to develop or test it. The stack runs with Docker Compose, needs no
cloud account and makes no provider calls (ADR 0011, D15). The CLI does not use
it.

To run DraftLoop for real use on your machine, use the
[self-hosted server](self-hosted.md) instead.

## Quick start

You need Docker with the Compose plugin, plus Node 24.22.1 and pnpm 10.18.3.
From the repository root:

```sh
pnpm server:up     # build the images, start the stack, wait until healthy
pnpm server:test   # start or update the stack, then run the server suites
pnpm server:down   # stop the services and keep their data
```

Then open `http://127.0.0.1:58080/` and sign in with the owner token
`local-stack-owner-token-not-a-secret`.

To delete the stored data as well, run `docker compose down --volumes`. If a
service stays unhealthy, `docker compose logs <service>` shows why.

## Services

```mermaid
flowchart LR
    B[Browser] --> A[api :58080<br/>owner mode]
    B --> O[api-oidc :58082<br/>sign-in mode]
    O --> K[keycloak :58081]
    A & O --> F[page-fetcher]
    A & O --> P[(postgres :55432)]
    A & O --> G[(gcs emulator :4443)]
    W[worker] --> P
    W --> G
```

| Service        | What it is                                                               | Local address                                           |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------------- |
| `postgres`     | `pgvector/pgvector:0.8.0-pg16`                                           | `postgres://postgres:postgres@127.0.0.1:55432/postgres` |
| `gcs`          | `fsouza/fake-gcs-server:1.56.1`                                          | `http://127.0.0.1:4443`                                 |
| `api`          | `apps/api/Dockerfile`: the `/v1` API and the web screen at `/`           | `http://127.0.0.1:58080`                                |
| `api-oidc`     | The same image in `oidc` mode, signing members in through Keycloak       | `http://127.0.0.1:58082`                                |
| `keycloak`     | `keycloak/keycloak:26.7.5` in development mode, with the fictional realm | `http://127.0.0.1:58081`                                |
| `page-fetcher` | `apps/page-fetcher/Dockerfile`: fetches approved job pages for the API   | none                                                    |
| `worker`       | `apps/worker/Dockerfile`: executes queued runs                           | none                                                    |

Three one-shot services run first and do what a deployment's infrastructure
does:

| Service          | What it does                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `postgres-setup` | Creates the runtime role `draft_loop_app`                                                               |
| `migrate`        | Runs the worker image's migration job as the schema owner and grants the runtime role table access only |
| `gcs-setup`      | Creates the bucket `draft-loop-local`                                                                   |

Facts that matter when you debug the stack:

- **Ports:** every published port listens on `127.0.0.1` only. Postgres uses
  55432, so it does not clash with a server already on 5432.
- **Identities:** the API and the worker connect as `draft_loop_app`. The owner
  token acts in one tenant, `local`; in `oidc` mode each member acts in their
  own organisation. The worker runs each queued job in that job's tenant.
- **Credentials:** every credential in `compose.yaml` is a fixed local-only
  value.
- **Data:** lives in the named volumes `postgres-data` and `gcs-data`.
- **Page fetching:** the API fetches approved job pages through
  `page-fetcher`, as a deployment does. The fetcher holds no database, secret
  or candidate material, and takes no identity token locally.

## Web screen

The API serves the web screen (`apps/web`), the same screens the desktop
client shows. A first run goes like this:

1. **Set up:** choose the CV language, round limit and model preset. Tick demo
   mode, since the stack makes no provider calls. **Create workspace** opens
   Home, where **Edit policy** saves a new writing-policy version.
2. **Career evidence:** upload PDF, DOCX, Markdown or text files into a
   knowledge base and choose the bases runs use. **File checks** shows each
   file's injection screening. **Private sections** marks Markdown sections as
   never-send or only-if-allowed.
3. **New application:** paste a job post, attach a job file or give an
   approved page address. Check and review the requirements that were read.
4. **Start:** start the run and follow it until the worker drafts it to your
   review.
5. **Review:** decide the findings, edit blocks, then approve or ask for
   another round. Export and download the CV.

Other things the screen shows:

| Feature           | Behaviour                                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New release       | On focus and every five minutes, the tab compares the served entry script with its own. When they differ it offers **Reload**.                                                                            |
| Screening badges  | Each file under **File checks** is screened clear, quarantined (with the signals found, or because a screener failed), released, or not screened.                                                         |
| Refused run       | A run that screening refuses (409 `material_quarantined`) is explained above the screens, listing the held material.                                                                                      |
| Release           | Owners, admins and the owner token get **Release** per held piece, with a required reason of up to 500 characters. Members are told to ask an owner or admin.                                             |
| Consents          | Sign-in mode only. Career evidence first asks permission to store material, and **Start** shows the credit cost and asks consent to send material. Each consent shows its state and a way to withdraw it. |
| Export and delete | Sign-in mode, owners and admins. **Export everything** downloads the record's archive. **Delete record** erases it once its id is typed back, and asks you to stop a queued or running run first.         |

To work on the screen itself, run `pnpm --filter @draft-loop/web dev`. Vite
serves it with hot reload and forwards `/v1` to `DRAFT_LOOP_WEB_API_URL`
(default `http://127.0.0.1:8080`). Set it to `http://127.0.0.1:58080` to use
the stack.

## Sign-in on the stack

The `api-oidc` service at `http://127.0.0.1:58082/` signs people in through
Keycloak. The screen asks the public `GET /v1/auth/config` how to sign in, so
in `oidc` mode it has no token field.

```mermaid
sequenceDiagram
    participant S as Web screen
    participant K as Keycloak
    participant A as api-oidc
    S->>A: GET /v1/auth/config
    S->>K: Sign in (code flow with PKCE)
    K-->>S: Redirect to / with code
    S->>K: Exchange code for tokens
    S->>A: /v1 calls with access token
    A->>A: Resolve token to an organisation member
```

Tokens stay in the tab's session storage and refresh before they expire. An
account that belongs to no organisation is told so and signed out.

### Fictional accounts

Keycloak imports the realm `draft-loop-local` from `compose/keycloak/`:

| Username | Email               | Password                 | Email verified |
| -------- | ------------------- | ------------------------ | -------------- |
| `ada`    | `ada@org-a.example` | `local-stack-password-a` | yes            |
| `ben`    | `ben@org-b.example` | `local-stack-password-b` | yes            |
| `una`    | `una@org-a.example` | `local-stack-password-u` | no             |

The admin console is at `http://127.0.0.1:58081/admin`, as `admin` with
password `local-stack-keycloak-admin-not-a-secret`.

### Set up an organisation

A person signs in only once an organisation has invited their verified email.
Use the operator token for each step.

1. Create the organisation with its first owner:

   ```sh
   curl -X POST http://127.0.0.1:58082/v1/operator/organisations \
     -H 'authorization: Bearer local-stack-owner-token-not-a-secret' \
     -H 'content-type: application/json' \
     -d '{"organisationId":"org-a","name":"Org A","firstOwnerEmail":"ada@org-a.example"}'
   ```

2. Assign a plan. The plan id is one of `individual`, `job-search-pass`, `pro`,
   `team`, `business` or `internal`; `team` and `business` also need `seats`:

   ```sh
   curl -X PUT http://127.0.0.1:58082/v1/operator/organisations/org-a/plan \
     -H 'authorization: Bearer local-stack-owner-token-not-a-secret' \
     -H 'content-type: application/json' \
     -d '{"planId":"pro"}'
   ```

3. Grant credits. The grant needs an `Idempotency-Key`, and `reason` is a short
   code, never free text:

   ```sh
   curl -X POST http://127.0.0.1:58082/v1/operator/organisations/org-a/credit-grants \
     -H 'authorization: Bearer local-stack-owner-token-not-a-secret' \
     -H 'idempotency-key: grant-org-a-0001' \
     -H 'content-type: application/json' \
     -d '{"credits":50,"reason":"goodwill"}'
   ```

4. Sign in as `ada` at `http://127.0.0.1:58082/`.

### Plan refusals

The owner-token API on port 58080 is not metered. In sign-in mode the plan
decides what a member may do:

| Response                     | When                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------- |
| 403 `plan_required`          | The organisation has no plan and creates a workspace, invites or starts a run |
| 409 `plan_limit_reached`     | An invitation or new workspace goes past the plan's seats or record limit     |
| 402 `credits_insufficient`   | The credit balance cannot cover the run                                       |
| 429 `run_cap_reached`        | The plan's run cap is used up                                                 |
| 403 `model_tier_not_in_plan` | The workspace picks a model outside the plan's tiers                          |

### Realm clients

| Client                   | Used for                                       |
| ------------------------ | ---------------------------------------------- |
| `draft-loop-web`         | The web screen, code flow with PKCE            |
| `draft-loop-local-smoke` | The password grant, for the sign-in smoke only |

Both put the audience `draft-loop-api` in their access tokens. Tokens name the
issuer `http://127.0.0.1:58081/realms/draft-loop-local`, the address the
browser uses. The API fetches signing keys inside the Compose network
(`DRAFT_LOOP_OIDC_JWKS_URL`). The provider must accept `/` as a redirect and
post-logout address.

## Images

All images build from the repository root on `node:24.22.1-bookworm-slim`. Each
installs only its app's production dependencies from the lockfile, in a
separate stage, and runs the TypeScript sources with `tsx`.

| Image          | Contents beyond its app                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `api`          | The web screen, built with Vite in its own stage. No embedding runtime, since the API never embeds text.    |
| `worker`       | The migration job (`src/migrate.ts`), the Linux embedding runtime for its architecture and the pinned model |
| `page-fetcher` | Only `@draft-loop/ingestion` and its dependencies                                                           |

The worker carries the default embedding model (Granite 311m, about 350 MB) at
`/app/models`. The critic needs it to judge requirement coverage; without it,
relevance counts only word matches (#1806).

- A separate stage downloads the model from Hugging Face, so a code change does
  not download it again.
- The build checks each file's size and SHA-256 against the manifest and fails
  on a bad download.
- Each worker start logs `embedding model`, with a warning when it is not
  ready.

The Node base image is about 330 MB of each image. The same images run in a
deployment, reading that deployment's values from the environment.

## Configuration

The services read their settings from environment variables. Compose sets the
local values; a deployment sets its own.

### Database and blobs

| Variable                            | Used by       | Meaning                                                                       |
| ----------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `DRAFT_LOOP_DATABASE_URL`           | API, worker   | The runtime role's connection                                                 |
| `DRAFT_LOOP_DATABASE_SCHEMA`        | all           | Storage schema, default `draft_loop`                                          |
| `DRAFT_LOOP_QUEUE_SCHEMA`           | all           | Run queue schema, default `draft_loop_queue`                                  |
| `DRAFT_LOOP_MIGRATION_DATABASE_URL` | migration job | The schema owner's connection                                                 |
| `DRAFT_LOOP_RUNTIME_ROLE`           | migration job | The role the API and the worker connect as                                    |
| `DRAFT_LOOP_RUNTIME_MEMBERS`        | migration job | Cloud SQL IAM users made members of the runtime role, comma-separated         |
| `DRAFT_LOOP_CLOUD_SQL_INSTANCE`     | all           | A Cloud SQL connection name; turns on the connector ([Cloud SQL](#cloud-sql)) |
| `DRAFT_LOOP_CLOUD_SQL_SOCKET_DIR`   | all           | The connector's socket directory, default `/tmp/cloudsql`                     |
| `DRAFT_LOOP_BLOB_BACKEND`           | API, worker   | `gcs` (default) or `filesystem` for a self-hosted stack                       |
| `DRAFT_LOOP_BLOB_BUCKET`            | API, worker   | The Cloud Storage bucket, with `gcs`                                          |
| `DRAFT_LOOP_GCS_ENDPOINT`           | API, worker   | An emulator; unset in a deployment                                            |
| `DRAFT_LOOP_BLOB_ROOT`              | API, worker   | With `filesystem`, the absolute directory for `tenants/<id>/` keys            |

With `filesystem`, the host disk's encryption protects the files.

### Sign-in

| Variable                        | Used by     | Meaning                                                                                       |
| ------------------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `DRAFT_LOOP_AUTH_MODE`          | API, worker | `owner` (default) accepts only the owner token; `oidc` accepts provider tokens for members    |
| `DRAFT_LOOP_API_OWNER_TOKEN`    | API         | The owner's bearer token, 32 characters or more; the only credential `/v1/operator/*` accepts |
| `DRAFT_LOOP_TENANT_ID`          | API         | The owner token's tenant: required in `owner` mode, optional in `oidc` mode                   |
| `DRAFT_LOOP_OIDC_ISSUER`        | API         | The provider's issuer, an https URL matched exactly                                           |
| `DRAFT_LOOP_OIDC_AUDIENCE`      | API         | The audience the API's tokens carry                                                           |
| `DRAFT_LOOP_OIDC_WEB_CLIENT_ID` | API         | The web screen's public client id                                                             |
| `DRAFT_LOOP_OIDC_JWKS_URL`      | API         | The provider's key set; discovered from the issuer when unset                                 |
| `DRAFT_LOOP_OIDC_ALLOW_HTTP`    | API         | `1` accepts plain-http provider addresses, for the local stack only                           |

### Runs, safety and limits

| Variable                         | Used by     | Meaning                                                                                                          |
| -------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `DRAFT_LOOP_ALLOW_PROVIDER_DATA` | API, worker | `true` lets runs and the model screener send approved material to providers; default `false`                     |
| `DRAFT_LOOP_SCREENING`           | API, worker | `off`, `rules` (default) or `rules+model`; any other value fails at start. Give the worker the API's value       |
| `DRAFT_LOOP_REQUIRE_CONSENT`     | worker      | `true` checks each record's transmission consent before a provider call. Always on, and required, in `oidc` mode |
| `DRAFT_LOOP_RUN_MAX_ROUNDS`      | API, worker | Required ceiling on a run's rounds                                                                               |
| `DRAFT_LOOP_RUN_MAX_COST_USD`    | API, worker | Required ceiling on a run's estimated cost, in US dollars                                                        |
| `DRAFT_LOOP_RUN_MAX_DURATION_MS` | API, worker | Required ceiling on a run's duration, in milliseconds                                                            |
| `DRAFT_LOOP_MAX_SOURCE_BYTES`    | API         | Largest candidate source upload, default 10 MiB, at most 30 MiB                                                  |

Unless screening is `off`, a run on material with no stored result is refused
by the API and held by the worker. The worker screens nothing itself.
`rules+model` needs the settings under [Model routes](#model-routes). The
stack's one worker also serves the owner-mode API, so it runs with the consent
check off.

### Processes

| Variable                             | Used by           | Meaning                                                                                                                       |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                               | API, page fetcher | Listening port, default 8080                                                                                                  |
| `DRAFT_LOOP_WEB_ROOT`                | API               | The built web screen's directory, served at `/`; the image sets it                                                            |
| `DRAFT_LOOP_SPEECH_MODEL_DIR`        | API               | The pinned speech model's folder, served at `/speech-models/`; the image fetches and sets it. Fill it with `pnpm speech-model:install` |
| `DRAFT_LOOP_PAGE_FETCHER_URL`        | API               | The page fetcher's origin, called with a Google identity token over https. Unset, the API fetches pages itself                |
| `DRAFT_LOOP_API_RATE_LIMIT`          | API               | Requests one source address may make per minute, health excepted; 1200 when unset. Past it the API answers 429 `rate_limited` |
| `DRAFT_LOOP_API_REFUSED_TOKEN_LIMIT` | API               | Refused credentials one address may present per minute before all its requests wait for the next minute; 30 when unset        |
| `DRAFT_LOOP_WORKER_JOB`              | API               | The worker's Cloud Run job, started after each queued run; unset locally                                                      |
| `DRAFT_LOOP_WORKER_MODE`             | worker            | `serve` (default) keeps claiming jobs; `drain` exits once the queue stays empty                                               |
| `DRAFT_LOOP_WORKER_IDLE_MS`          | worker            | In drain mode, how long the queue stays empty before exit, default 60000                                                      |
| `DRAFT_LOOP_WORKER_READY_FILE`       | worker            | Touched once the worker claims jobs, for a health check                                                                       |
| `DRAFT_LOOP_EMBEDDING_MODEL_ROOT`    | worker            | Where the embedding model is installed; the image sets `/app/models`                                                          |

## Cloud SQL

The stack connects to Postgres with plain URLs. On Cloud Run,
`DRAFT_LOOP_CLOUD_SQL_INSTANCE` starts Google's Cloud SQL connector in each
process before it opens the database. The connector opens a TLS tunnel to the
instance's private IP and listens on a Unix socket. The database URL names that
directory as its host, for example
`postgres://<user>@/postgres?host=/tmp/cloudsql`.

| Process        | How it signs in                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| API and worker | IAM database authentication as their service identities, so their URLs carry no password                              |
| Migration job  | A built-in schema-owner user with a password. It creates the runtime role and adds `DRAFT_LOOP_RUNTIME_MEMBERS` to it |

## Model routes

The stack sets no model routes, so its runs use fixtures and call no provider.
Without routes the worker knows no provider key, so a provider call fails
rather than reading a key from the environment. A deployment chooses one of
two routes, and may add local models beside either.

### Vertex routes (hosted)

Values come from the deployment's configuration, never from this repository.

| Variable                          | Meaning                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- |
| `DRAFT_LOOP_VERTEX_PROJECT_ID`    | The project that serves Claude on Vertex AI; setting it turns routes on     |
| `DRAFT_LOOP_VERTEX_LOCATION`      | `eu` (default) or a `europe-*` region; any other location is refused        |
| `DRAFT_LOOP_VERTEX_PRICE_FACTOR`  | The location's price factor over first-party rates, at least 1              |
| `DRAFT_LOOP_OPENAI_KEY_SECRET`    | The Secret Manager version holding the critic's OpenAI EU project key       |
| `DRAFT_LOOP_OPENAI_ENDPOINT`      | `eu` (default) or `global`, OpenAI's endpoint outside the EU                |
| `DRAFT_LOOP_ANTHROPIC_FALLBACK`   | `true` allows the direct Claude API as a recorded fallback; default `false` |
| `DRAFT_LOOP_ANTHROPIC_KEY_SECRET` | The Secret Manager version holding the Claude API key; fallback only        |

- **Author:** calls Claude on Vertex AI with the worker's service identity, so
  no Claude key exists unless the fallback is on. The fallback processes
  material outside the EU, which is why it is off by default.
- **Critic:** calls `https://eu.api.openai.com/v1` with a key from an
  EU-residency project. `global` processes material outside the EU; the worker
  logs its routes at every start.
- **Keys:** read from Secret Manager at call time and kept in memory for five
  minutes.

### Direct routes (self-hosted)

`DRAFT_LOOP_MODEL_ROUTES=direct` uses the operator's own keys and refuses the
Vertex and Secret Manager settings above.

| Variable                     | Meaning                                                                        |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `DRAFT_LOOP_MODEL_ROUTES`    | `vertex` (default when a Vertex project is set) or `direct`                    |
| `DRAFT_LOOP_SECRETS_DIR`     | The directory holding `anthropic_api_key` and `openai_api_key`; `/run/secrets` |
| `DRAFT_LOOP_OPENAI_ENDPOINT` | `global` (default with `direct`) or `eu` for an EU-residency project           |

- Claude runs through the Claude API with prompt caching, and the critic
  through OpenAI. Both process material outside the EU, under the operator's
  provider terms.
- A key file other users can read is refused, so keep each one `chmod 600`. A
  provider with no file has no key, and a new file is read on the next call.

### Local models

Local models run on an OpenAI-compatible endpoint the deployment declares, such
as Ollama or LM Studio.

| Variable                          | Read by | Meaning                                                      |
| --------------------------------- | ------- | ------------------------------------------------------------ |
| `DRAFT_LOOP_LOCAL_MODELS`         | API     | Model names the endpoint serves, separated by commas         |
| `DRAFT_LOOP_LOCAL_MODEL_ENDPOINT` | worker  | The endpoint, such as `http://host.docker.internal:11434/v1` |

The catalog lists the names as `localModels`, and a workspace may pick one as
writer or reviewer. Another local name is refused with `model_not_offered`. A
workspace never names an endpoint. Local models are unpriced and have not
passed the quality gate.

### The screener's route

The API calls a model only for `DRAFT_LOOP_SCREENING=rules+model`, using Claude
Haiku:

- **Vertex:** reads the three `DRAFT_LOOP_VERTEX_*` project, location and price
  settings and uses its own service identity, with no direct fallback.
- **Direct:** calls the Claude API with `anthropic_api_key` from
  `DRAFT_LOOP_SECRETS_DIR`. A stack with no Claude key keeps `rules`, since a
  screener that cannot answer leaves material quarantined.

### Check the routes by hand

With synthetic data only: set the same variables, sign in with an identity
that may call Vertex AI and read the secrets, then run:

```sh
DRAFT_LOOP_LIVE_CRITIC_MODEL=gpt-5.6-luna pnpm test:gateway:live
```

Replace `gpt-5.6-luna` with the critic's OpenAI model. The check makes one
Vertex call and one OpenAI EU call, and prints each route, model, token count
and cost. `DRAFT_LOOP_LIVE_AUTHOR_MODEL` picks the Claude model, default
`claude-haiku-5-5`. It never runs in CI.

In CI, `pnpm test:postgres` drives one run through the same routes against
scripted Vertex AI, OpenAI and Secret Manager endpoints. It checks each call's
recorded route and cost, and that the usage routes report the run's whole
cost.

## Tests against the stack

`pnpm server:test` runs `docker compose up --detach --wait --build`, then three
suites with the stack's addresses in the environment:

| Suite                    | Target variables                                               | What it covers                  |
| ------------------------ | -------------------------------------------------------------- | ------------------------------- |
| `pnpm test:postgres`     | `DRAFT_LOOP_TEST_POSTGRES_URL`                                 | Storage and the in-process flow |
| `pnpm test:gcs`          | `DRAFT_LOOP_TEST_GCS_URL`                                      | Blob storage                    |
| `pnpm test:server-smoke` | `DRAFT_LOOP_TEST_API_URL`, `_OIDC_API_URL`, `_OIDC_ISSUER_URL` | End-to-end and sign-in smokes   |

To run one suite alone, set its variables yourself.

### End-to-end smoke

The smoke takes a run from setup to a downloaded CV through the API only, with
synthetic data and no database seeding:

1. **Setup:** create a fixture-mode workspace and a knowledge base, upload and
   select one Markdown source, then create, edit and review a job brief.
2. **Draft:** begin a run and wait for the worker to draft it to review.
3. **Review and approve:** accept every finding and approve, with an override
   rationale when the final checks block approval.
4. **Export:** export a DOCX, list the run's exports, download it and check its
   size and SHA-256 against the export record.

A second run takes one revision round with a candidate direction before the
same review, approval and export.

### Sign-in smoke

The sign-in smoke creates two organisations with the operator token and signs
`ada` and `ben` in through Keycloak. It checks that:

- each lands in their own organisation
- `ben` gets 404 for a workspace `ada` created
- the operator route refuses a member's token
- an invited person whose email is not verified gets 403

### In CI

CI does not use the Compose file. Its `Server storage` job starts the Postgres
and emulator images as its own containers and runs the first two suites.

`pnpm test:postgres` drives the same flow in-process against Postgres. It runs
the API's routes and the worker's job handler over one database, with exports
in a local folder in place of the bucket. A second in-process test takes the
flow through the web screen's typed client, so a screen call that drifts from
the API fails there.

## Next steps

Cloud deployment is described in
[Deploying the hosted service](server-deploy.md). Its Terraform and workflow
live in a private infrastructure repository (ADR 0011, D2).
