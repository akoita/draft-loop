# Self-hosted stack

DraftLoop's hosted service on your own machine: the same API, worker, page fetcher and Postgres as
the cloud, with files on disk and your own provider keys. The full guide is
[docs/operations/self-hosted.md](../../docs/operations/self-hosted.md).

## Start

1. Put your keys in `keys/`, one file each: `anthropic_api_key` and `openai_api_key`. Git ignores
   every file there.
2. From the repository root, run `pnpm self-hosted:up`.
3. Open <http://127.0.0.1:8080> and sign in with the token from `pnpm self-hosted:token`.

## What it holds

| Piece | Where |
| --- | --- |
| `compose.yaml` | The services, with the API on `127.0.0.1` only. |
| `init/prepare.sh` | Creates the random owner token and database passwords at first start, and copies your keys into a volume only the API and the worker read. |
| `init/postgres-setup.sh` | Creates the database role the API and the worker use. |
| `init/with-secrets.sh` | Gives each service only the secrets it needs. |
| `keys/` | Your provider keys. Never commit them. |
