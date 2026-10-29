# Self-hosted server

DraftLoop's hosted service runs on your own machine with one command: the same
API, worker, page fetcher, Postgres and web screen as the cloud, with your own
provider keys or a local model, and files kept on your disk (ADR 0011, D15).
It is the full local option while the desktop app is in maintenance mode.

For development and tests, use the [local server stack](local-server-stack.md)
instead: it emulates Cloud Storage, runs Keycloak and makes no provider calls.

## What you need

- Docker with the Compose plugin. Docker Desktop works on macOS and Windows.
- A clone of this repository. The images are built from it, so no Node or
  pnpm install is needed unless you use the `pnpm` shortcuts below.
- A few gigabytes of disk for the images, which include the embedding model.
- A Claude API key and an OpenAI API key, or a local model server such as
  Ollama or LM Studio.

## Start

1. Put each key in its own file in `deploy/local/keys/`:
   `anthropic_api_key` and `openai_api_key`. Git ignores every file there.
2. From the repository root, run `pnpm self-hosted:up`, or
   `docker compose --file deploy/local/compose.yaml up --detach --wait --build`.
3. Open <http://127.0.0.1:8080> and sign in with the owner token that
   `pnpm self-hosted:token` prints.

The first start builds the images and creates a random owner token and
database passwords. Later starts keep them, run any new database migrations
and copy the current key files again.

`pnpm self-hosted:down` stops the stack and keeps its data.

## Settings

Set these in your shell or in `deploy/local/.env`, which Git ignores:

| Variable                          | Default  | Meaning                                                        |
| --------------------------------- | -------- | -------------------------------------------------------------- |
| `DRAFT_LOOP_PORT`                 | `8080`   | The port on `127.0.0.1` where the web screen and API listen    |
| `DRAFT_LOOP_LOCAL_MODELS`         | none     | Local model names the stack offers, separated by commas        |
| `DRAFT_LOOP_LOCAL_MODEL_ENDPOINT` | none     | The OpenAI-compatible endpoint that serves them                |
| `DRAFT_LOOP_OPENAI_ENDPOINT`      | `global` | `eu` for an OpenAI project created with EU data residency      |
| `DRAFT_LOOP_SCREENING`            | `rules`  | `rules+model` also asks Claude Haiku to screen uploads         |
| `DRAFT_LOOP_RUN_MAX_COST_USD`     | `3`      | The most one run may spend on provider calls                   |
| `DRAFT_LOOP_RUN_MAX_ROUNDS`       | `5`      | The most revision rounds one run may take                      |

The full list of server settings is in the
[local server stack](local-server-stack.md) guide.

## Keys

- Add, replace or remove a key file, then run `pnpm self-hosted:up` again.
- The keys are copied into a volume that only the API and the worker read. They
  never appear in logs, settings or error messages.
- A provider with no key file has no key, so a run that needs it fails before
  any call reaches that provider.

## Local models

A local model may be the writer, the reviewer or both. Until one passes
DraftLoop's quality check, the start dialog and the model setup warn when a
local model writes the CV.

To use Ollama beside the stack:

1. Pull a model, for example `ollama pull llama3.1:8b`.
2. Set `DRAFT_LOOP_LOCAL_MODELS=llama3.1:8b` and
   `DRAFT_LOOP_LOCAL_MODEL_ENDPOINT=http://host.docker.internal:11434/v1`.
3. Run `pnpm self-hosted:up`, then choose the model in the model setup.

On Linux, Ollama listens on `127.0.0.1` by default, which the containers cannot
reach. Start it with `OLLAMA_HOST=0.0.0.0` and keep port 11434 closed to the
network with your firewall.

## Privacy

- Your career material stays on this machine, in the Postgres and file
  volumes, until a run sends approved material to a model.
- With your own keys, Claude and OpenAI process that material outside the EU,
  under your own provider terms. A local model keeps everything on your
  machine.
- The stack has one workspace and no sign-in beyond the owner token, and it
  serves plain HTTP. Keep the port on `127.0.0.1`; do not publish it to a
  network.

## Back up and restore

Back up the database and the files while the stack runs. From the repository
root, these write two files to your home folder:

```sh
docker compose --file deploy/local/compose.yaml exec postgres \
  pg_dump --username=postgres --format=custom draft_loop > ~/draft-loop.dump
docker compose --file deploy/local/compose.yaml run --rm --no-deps \
  --volume "$HOME:/backup" --entrypoint tar init \
  czf /backup/draft-loop-files.tgz -C / blobs secrets postgres-secrets
```

Keep both files private: they hold your career material and the stack's
passwords. To restore on a new machine, unpack the archive into the same
volumes with a `tar xzf` through the `init` service, start the stack, then load
the dump with `pg_restore --clean --if-exists --dbname=draft_loop`.

## Update and erase

- To update, pull the repository and run `pnpm self-hosted:up`. The images are
  rebuilt and the migrations run before the API and the worker start.
- To erase everything, run
  `docker compose --file deploy/local/compose.yaml down --volumes`. This deletes
  the database, the files, the generated secrets and the copied keys.
