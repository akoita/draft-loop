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

## Services

| Service    | What it is                                    | Local address                                           |
| ---------- | --------------------------------------------- | ------------------------------------------------------- |
| `postgres` | `pgvector/pgvector:0.8.0-pg16`                | `postgres://postgres:postgres@127.0.0.1:55432/postgres` |
| `gcs`      | `fsouza/fake-gcs-server:1.56.1`               | `http://127.0.0.1:4443`                                 |
| `api`      | `apps/api/Dockerfile`, the `/v1` HTTP API     | `http://127.0.0.1:58080`                                |
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
- The API and the worker connect as `draft_loop_app`, serve one tenant,
  `local`, and keep blobs in the emulator. Every credential in `compose.yaml`
  is a fixed local-only value; the API's owner token is
  `local-stack-owner-token-not-a-secret`.
- Data lives in the named volumes `postgres-data` and `gcs-data`.

## Images

Both images are built from the repository root on `node:24.22.1-bookworm-slim`.
Each installs only its app's production dependency graph from the lockfile and
runs the TypeScript sources with `tsx`, so there is no separate build step. The
worker image also runs the migration job (`src/migrate.ts`).

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
| `DRAFT_LOOP_TENANT_ID`                  | API, worker    | The one tenant the deployment serves                            |
| `DRAFT_LOOP_BLOB_BUCKET`                | API, worker    | The Cloud Storage bucket                                        |
| `DRAFT_LOOP_GCS_ENDPOINT`               | API, worker    | An emulator; unset in a deployment                              |
| `DRAFT_LOOP_API_OWNER_TOKEN`            | API            | The owner's bearer token, at least 32 characters                |
| `PORT`                                  | API            | Listening port, default 8080                                    |
| `DRAFT_LOOP_MAX_SOURCE_BYTES`           | API            | Largest candidate source upload, default 10485760 (10 MiB), at most 30 MiB |
| `DRAFT_LOOP_ALLOW_PROVIDER_DATA`        | worker         | `true` lets runs send approved material to providers; default `false` |
| `DRAFT_LOOP_WORKER_READY_FILE`          | worker         | Touched once the worker claims jobs, for a health check         |
| `DRAFT_LOOP_RUN_MAX_ROUNDS`             | API, worker    | Required ceiling on a run's rounds                              |
| `DRAFT_LOOP_RUN_MAX_COST_USD`           | API, worker    | Required ceiling on a run's estimated cost, in US dollars       |
| `DRAFT_LOOP_RUN_MAX_DURATION_MS`        | API, worker    | Required ceiling on a run's duration, in milliseconds           |
| `DRAFT_LOOP_MIGRATION_DATABASE_URL`     | migration job  | The schema owner's connection                                   |
| `DRAFT_LOOP_RUNTIME_ROLE`               | migration job  | The role the API and the worker connect as                      |

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
| `DRAFT_LOOP_ANTHROPIC_FALLBACK`   | `true` allows the direct Claude API as a recorded fallback; default `false`      |
| `DRAFT_LOOP_ANTHROPIC_KEY_SECRET` | The Secret Manager version holding the Claude API key; only with the fallback on |

- The author calls Claude on Vertex AI with the worker's service identity, so
  no Claude key exists unless the fallback is on. The direct Claude API
  processes material outside the EU, which is why the fallback is off by
  default.
- The critic calls OpenAI's EU endpoint, `https://eu.api.openai.com/v1`, with
  a key from a project created with EU data residency.
- Keys are read from Secret Manager at call time and kept in memory for five
  minutes.

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
   `DRAFT_LOOP_TEST_API_URL`.

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

A second run takes one revision round with a candidate direction before the
same review, approval and export.

`pnpm test:postgres` drives the same flow in-process against Postgres, without
the containers, so the CI `Server storage` job covers it too. That test runs
the API's routes and the worker's job handler over one database, with exports
in a local folder in place of the bucket.

To run one suite, set its variables yourself. CI does not use this file: its
`Server storage` job starts the Postgres and emulator images as its own
containers and runs the first two suites.

Cloud deployment is described in [Deploying the hosted service](server-deploy.md);
its Terraform and workflow live in a private infrastructure repository
(ADR 0011, D2).
