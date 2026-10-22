# Deploying the hosted service

The hosted service runs on Google Cloud in `europe-west1` (ADR 0011, D14). This
repository holds the code and the images; a private infrastructure repository
holds the Terraform, the deploy workflow and every cloud identifier (D2). No
project id, service account, pool id or bucket name belongs here.

## Releasing a server version

1. **Tag.** Tag a commit of `main` whose CI gate passed with `server-vX.Y.Z`.
   Server tags are independent of the desktop's `v*` tags, and
   `pnpm release:preflight` stays the rule for desktop releases only.
2. **Staging.** The deploy workflow in the infrastructure repository checks
   out the tag, builds the API and worker images from their Dockerfiles, pushes
   them by digest, runs the migration job and deploys staging.
3. **Smoke.** The workflow runs the synthetic smoke
   (`pnpm test:server-smoke`, the same one as on the local stack) against
   staging. A failure stops the release.
4. **Production.** A second, manual run of the workflow deploys the same image
   digests to production, migrates, and runs the smoke there.

The workflow signs in to Google Cloud through Workload Identity Federation, so
no long-lived service account key exists.

## What runs where

| Part       | Runs as                                     | Notes                                                                          |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| API        | Cloud Run service                           | Scales to zero; serves its Cloud Run address behind the owner token in phase 1 |
| Worker     | Cloud Run job                               | Drains the queue, then exits (D4)                                              |
| Migrations | Cloud Run job, from the worker image        | Runs before each deploy as the schema owner                                    |
| Database   | Cloud SQL for PostgreSQL 16 with `pgvector` | Private IP only, backups and point-in-time recovery                            |
| Objects    | One Cloud Storage bucket per environment    | Encrypted with a customer-managed key                                          |
| Secrets    | Secret Manager in `europe-west1`            | Owner token, the critic's OpenAI EU key, migration login                       |

Each part has its own service account with only the access it needs. The
worker may reach Google APIs and the OpenAI EU endpoint and nothing else; the
API has no internet egress.

## Settings

The images read the settings listed in
[the local server stack](local-server-stack.md): the database, the tenant, the
bucket, the owner token, the run ceilings and the model routes. A deployment
sets them from its infrastructure. Unlike the local stack, it:

- leaves `DRAFT_LOOP_GCS_ENDPOINT` unset;
- sets `DRAFT_LOOP_CLOUD_SQL_INSTANCE`, so the services reach the database
  through the Cloud SQL connector with no runtime password, and lists their IAM
  database users in the migration job's `DRAFT_LOOP_RUNTIME_MEMBERS`;
- sets `DRAFT_LOOP_ALLOW_PROVIDER_DATA` and the model routes on the worker.
