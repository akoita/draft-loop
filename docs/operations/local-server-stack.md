# Local server stack

The client-server version's storage runs locally with Docker Compose: Postgres
16 with `pgvector`, and a Cloud Storage emulator. It needs no cloud account and
makes no provider calls (ADR 0011, D15). The desktop and the CLI do not use it.

You need Docker with the Compose plugin, plus the repository's usual Node and
pnpm versions.

## Commands

From the repository root:

```sh
pnpm server:up     # start both services and wait until they are healthy
pnpm server:test   # run the Postgres and Cloud Storage suites against them
pnpm server:down   # stop the services and keep their data
```

To also delete the stored data, run `docker compose down --volumes`.

## Services

| Service    | Image                            | Local address                                         |
| ---------- | -------------------------------- | ----------------------------------------------------- |
| `postgres` | `pgvector/pgvector:0.8.0-pg16`   | `postgres://postgres:postgres@127.0.0.1:55432/postgres` |
| `gcs`      | `fsouza/fake-gcs-server:1.56.1`  | `http://127.0.0.1:4443`                               |

- Both services listen on `127.0.0.1` only. The Postgres port is 55432, so it
  does not clash with a Postgres server already on 5432.
- Data lives in the named volumes `postgres-data` and `gcs-data`.
- `pnpm server:test` sets `DRAFT_LOOP_TEST_POSTGRES_URL` and
  `DRAFT_LOOP_TEST_GCS_URL` to these addresses, then runs `pnpm test:postgres`
  and `pnpm test:gcs`. To run one suite, set its variable yourself.

CI does not use this file. Its `Server storage` job starts the same images as
its own containers.

## What joins later

The API and one worker join this stack in sprint 1c, when `apps/api` and
`apps/worker` exist. Cloud deployment is not part of this repository: it lives
in a private infrastructure repository (ADR 0011, D2).
