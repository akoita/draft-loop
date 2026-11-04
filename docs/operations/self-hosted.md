# Self-hosted server

DraftLoop's hosted service runs on your own machine with one command: the same
API, worker, page fetcher, Postgres and web screen as the cloud, with your own
provider keys or a local model, and files kept on your disk (ADR 0011, D15).
It is the full local option, and the server the new desktop client connects to.

For development and tests, use the [local server stack](local-server-stack.md)
instead: it emulates Cloud Storage, runs Keycloak and makes no provider calls.

`pnpm self-hosted:test` checks this stack the way a person installs it. It
builds the images from your clone, installs them with `draft-loop-server` under
a separate project name and port, and puts the worker on its offline fixtures.
It runs the hosted smoke from an upload to an exported DOCX, imports a fictional
desktop workspace and career evidence backup through the CLI, backs the stack up,
erases and restores it, checks that the records, files and owner token came
back, and runs the smoke again. The **Self-hosted stack** CI job runs it on
every pull request.

## What you need

- Docker with the Compose plugin. Docker Desktop works on macOS and Windows.
- A few gigabytes of disk for the images, which include the embedding model.
- A Claude API key and an OpenAI API key, or a local model server such as
  Ollama or LM Studio.

## Install

The `draft-loop-server` script installs a published release with Docker only:
no clone, no Node and no build. Copy it from
[`deploy/local/bin`](../../deploy/local/bin) (`draft-loop-server` for Linux and
macOS, `draft-loop-server.ps1` for Windows PowerShell) to a temporary place,
not your home folder, where `install` creates the `draft-loop-server` folder.
The [README](../../README.md#quick-install-with-docker) has the commands. Then:

1. Run `draft-loop-server install 0.14.0`. It downloads that release's stack
   into `~/draft-loop-server`, or into the folder you name after the version.
2. Put each key in its own file in the folder's `keys/`: `anthropic_api_key`
   and `openai_api_key`.
3. Run `~/draft-loop-server/bin/draft-loop-server up`. The first start pulls
   the images and creates a random owner token and database passwords. When
   the stack is up, it prints the address, the token command and where to get
   the desktop app.
4. Open <http://127.0.0.1:8080> and sign in with the token that
   `draft-loop-server token` prints.

The installed folder holds its own copy of the script. A downloaded copy outside
any stack, such as `/tmp/draft-loop-server`, works on `~/draft-loop-server`; set
`DRAFT_LOOP_SERVER_HOME` to name another folder. The other commands are
`down`, `status`, `logs [service]` and `upgrade <version>`, which switches to a
newer release, keeps your keys and settings, and restarts the stack. Later
starts keep the generated secrets, run any new database migrations and copy the
current key files again.

## From a clone

To build the images from source instead, put the keys in `deploy/local/keys/`
and run `pnpm self-hosted:up` from the repository root, or
`docker compose --file deploy/local/compose.yaml --file deploy/local/compose.build.yaml up --detach --wait --build`.
`pnpm self-hosted:token` prints the owner token, and `pnpm self-hosted:down`
stops the stack and keeps its data.

## Settings

Set these in the installed folder's `.env`, or in `deploy/local/.env` in a
clone, which Git ignores:

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

For changes beyond these settings, such as an extra volume, add a
`compose.override.yaml` beside `compose.yaml` in the installed folder. The script
passes it to Docker Compose, and `upgrade` never changes it.

## Keys

- Add, replace or remove a key file, then run `draft-loop-server up` (or
  `pnpm self-hosted:up` in a clone) again.
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
3. Run `draft-loop-server up`, then choose the model in the model setup.

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

`draft-loop-server backup [file]` writes one archive while the stack runs. It
holds a dump of the database, your uploaded and exported files, and the
stack's generated owner token and passwords. Your provider keys stay in
`keys/` and are not included.

Keep the archive private: it holds your career material and the stack's
passwords.

To restore, for example on a new machine:

1. Run `draft-loop-server install <version>` with the backup's version or a
   newer one, and put your keys in `keys/`. Do not start the stack yet.
2. Run `draft-loop-server restore <file>`. It loads the files and secrets, then
   the database, and starts the stack with the same owner token.

Restore refuses a stack that already holds data, and an archive from a newer
server version than the one installed.

## Coming from the desktop app

The v0.8 desktop alpha ran its own local engine and is retired. Its installed
copies keep their files on disk, so you can still move them. The `draft-loop` CLI copies its career evidence, applications and
run history into this server, and never changes the desktop's files. From a
clone of this repository, run the CLI as `pnpm start -- <command>`.

1. Write a portable backup of the desktop's career evidence. The desktop keeps
   it in the `candidate-knowledge` folder of its data folder:
   `%LOCALAPPDATA%\DraftLoop` on Windows, `~/Library/Application Support/DraftLoop`
   on macOS and `~/.local/share/draft-loop` on Linux.
2. Open the server's web screen once and finish its setup, so its workspace
   exists.
3. Check what the import would send. It prints counts and sends nothing.
4. Send it with the owner token, which `draft-loop-server token` prints. Name
   each desktop workspace folder with its own `--workspace`.

```text
draft-loop knowledge store backup <candidate-knowledge folder> <backup> --yes
draft-loop server import <backup> --workspace <folder>
DRAFT_LOOP_SERVER_TOKEN=<token> draft-loop server import <backup> --workspace <folder> --approve
```

What the import brings:

- **Career evidence.** Each active knowledge base becomes a knowledge base on
  the server, with the latest version of each source. Each file goes through
  the same upload, screening and quarantine as a file added on the Career
  evidence page.
- **Applications.** Each application of a workspace arrives with its job, its
  job briefs and its runs, so it shows on Home and its runs open for review.
  The job text is screened against each imported brief.

What it leaves behind:

- **Files the server does not take,** retired sources and archived bases. The
  server takes PDF, Word, Markdown and plain text.
- **Exported files.** Export the imported runs again on the server.
- **Sensitivity choices** made on the desktop. Set them again on the server.
- **An application whose job text cannot be read,** such as a moved job file.
  The import counts it.

Running it again is safe. Files and applications already on the server are not
written again, so an interrupted import resumes. A run or job brief id the
server already holds elsewhere refuses that application.

`--server` names another server than `http://127.0.0.1:8080`, and
`--token-file` reads the token from a file. Only a self-hosted server signed in
with its owner token takes applications.

## Work journal

Coding agents can record notable work you shipped as notes in a work journal
(ADR 0011, D17). Notes wait as pending until you review them, and only an
approved note becomes career evidence.

- **Turn it on** with "Accept notes from coding agents" in the Work journal
  panel of the Career evidence page. The server refuses notes while it is off.
- **Review on the web** in the same panel: approve a note into a knowledge
  base, edit it, merge it with a likely duplicate shown beside it, or discard
  it.
- **Review from the CLI** with the owner token:

```text
draft-loop work-journal list
draft-loop work-journal show <note>
draft-loop work-journal approve <note> [--knowledge-base <id>] [--tier sensitive]
draft-loop work-journal merge <note> --into <note> [--keep-summary this]
draft-loop work-journal discard <note>
```

Coding agents reach the server through `draftloop-mcp`, which reads the owner
token from `DRAFT_LOOP_SERVER_TOKEN` and the address from
`DRAFT_LOOP_SERVER_URL`. The [agent channel](../reference/agent-channel.md)
reference covers its setup per agent and what it records.

Screening holds a note that looks like it carries instructions to a model; it
cannot be approved until an edit screens clear. A private project's repository
and links stay out of model input. The work journal needs the owner token for
now, so the web shows it only on a server signed in with it.

## Update and erase

- To update an installed folder, run `draft-loop-server upgrade <version>`.
  In a clone, pull and run `pnpm self-hosted:up`. Either way the migrations run
  before the API and the worker start.
- To erase everything, run
  `docker compose --file deploy/local/compose.yaml down --volumes`. This deletes
  the database, the files, the generated secrets and the copied keys.
