# Agent channel: coding agents in DraftLoop

The candidate's coding agent can record notable work it helped ship, such as a
payments integration or a database migration, as a note in DraftLoop's work
journal. A note is evidence for review, never a CV claim: it waits as pending
until the candidate approves it on the Career evidence page or from the CLI.
The design is [ADR 0011, D17](../adr/0011-client-server-version.md#d17-agent-channel-an-mcp-server).

The channel is `draftloop-mcp`, a stdio MCP server that calls the
[self-hosted server](../operations/self-hosted.md)'s API with an agent token.
An agent token reaches one workspace, and only the scopes ticked when it was
created: `journal` (file notes and list their titles), `applications:read` and
`jobs:write`. Every other route refuses it.
Candidate data stays on your machine. Without the self-hosted stack, there is
nothing for it to call: the CLI-only path is not served.

Real Claude Code sessions walked this setup on 2026-11-04: the
[work journal walk](../evaluation/work-journal-walk.md) and the
[agent token walk](../evaluation/agent-token-walk.md) list what passed and the
open defects.

## Set it up

You need a running [self-hosted server](../operations/self-hosted.md) and
`draftloop-mcp` on your `PATH` (step 1 below). Then pick one way:

| Way                          | For                     | What it adds                                          |
| ---------------------------- | ----------------------- | ----------------------------------------------------- |
| The Claude Code plugin       | Claude Code             | The tools, `/log-work`, `/tailor-cv` and the Stop hook |
| A copied configuration       | Claude Code, Codex, any | The tools only                                        |
| `draftloop-mcp init`         | Claude Code, Codex      | The tools, `/log-work` and the hook, in one project   |

The Coding agents section of Workspace settings on Home shows the first two;
the Work journal panel links to it.

1. Put `draftloop-mcp` on your `PATH` from a clone of this repository. Run the
   link from inside `apps/mcp`: `pnpm --dir apps/mcp link --global` links the
   root package instead.

   ```text
   pnpm install
   cd apps/mcp
   pnpm link --global
   draftloop-mcp --help
   ```

   If pnpm answers `ERR_PNPM_NO_GLOBAL_BIN_DIR`, run `pnpm setup`, open a new
   shell, and link again. The last command prints the tool's usage.

2. In the Work journal panel, turn on **Accept notes from coding agents**; the
   server refuses notes while intake is off. Then, under **Coding agents** in
   Workspace settings, open **Connect a coding agent**, tick what the agent
   may do and select **Create agent token**.
3. Pick your agent's tab and copy what it shows:

   | Tab                     | What to do                                                             |
   | ----------------------- | ---------------------------------------------------------------------- |
   | Claude Code plugin      | Run the two `/plugin` lines in Claude Code, then `draftloop-mcp save-token` in a terminal and paste the token |
   | Claude Code             | Run the `claude mcp add --scope user` command, which holds the token, in a terminal |
   | Codex                   | Add the table, which holds the token, to `~/.codex/config.toml`        |
   | Other MCP agents (JSON) | Add the entry, which holds the token, to the agent's `mcpServers` file |

   `save-token` reads the token from standard input, so it stays out of your
   shell history, and keeps it in `~/.config/draftloop/agent-token`
   (`%APPDATA%\draftloop\agent-token` on Windows). The
   plugin's server reads it there and calls `http://127.0.0.1:8080` unless
   `DRAFT_LOOP_SERVER_URL` names another address.

The token is shown once. Keep it in your user settings, never in a project file
you commit. The section lists the active tokens with their scopes and revokes
each one.

The desktop client shows its server's screens, so it offers the same steps when
connected to a self-hosted server. On the hosted service, signed-in accounts
get no agent token yet, so the section says so and links here.

### Set it up with `init`

`init` writes the project's files, including the `/log-work` skill and, for
Claude Code, the Stop hook. With `draftloop-mcp` on your `PATH` and intake on:

1. In the project whose work you want to record, run `init` for your agent,
   with the owner token for that one command only:

   ```text
   DRAFT_LOOP_SERVER_TOKEN="$(draft-loop-server token)" draftloop-mcp init --host claude-code
   ```

   Use `--host codex` or `--host generic` for the other hosts, and add
   `--hook` for Claude Code's Stop hook. `init` writes the project's files,
   asks the server for an agent token and saves it in your configuration
   folder, then prints `issued: agent token dlat_..., saved to ...`.

2. Start the agent from a shell without the owner token. `draftloop-mcp`
   sends the saved agent token.

`init` merges into existing files, and running it again changes nothing in
them; it issues a new agent token each time. The files hold only names: no
token and no path of your machine is written.

If `init` prints `No agent token issued`, follow the line it prints. A server
older than `server-v0.15.0` issues none: upgrade it, or keep the owner token
in `DRAFT_LOOP_SERVER_TOKEN` as before, which still works.

| Host            | Server entry         | Instructions | Skill                              |
| --------------- | -------------------- | ------------ | ---------------------------------- |
| Claude Code     | `.mcp.json`          | `CLAUDE.md`  | `.claude/skills/log-work/SKILL.md` |
| Codex           | `.codex/config.toml` | `AGENTS.md`  | `.agents/skills/log-work/SKILL.md` |
| Other MCP hosts | `.mcp.json`          | `AGENTS.md`  | `.agents/skills/log-work/SKILL.md` |

Codex reads a project's `.codex/config.toml` only in a trusted project; copy
the marked block into `~/.codex/config.toml` otherwise.

The server reads its token, in order, from `DRAFT_LOOP_SERVER_TOKEN_FILE`, the
saved agent token, then `DRAFT_LOOP_SERVER_TOKEN`. The saved token is in
`$XDG_CONFIG_HOME/draftloop/agent-token`, by default
`~/.config/draftloop/agent-token`, or `%APPDATA%\draftloop\agent-token` on
Windows.

| Variable                      | Default                 | Meaning                                                                      |
| ----------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| `DRAFT_LOOP_SERVER_URL`       | `http://127.0.0.1:8080` | The self-hosted server's address                                             |
| `DRAFT_LOOP_SERVER_TOKEN`     | none                    | For `init`, the owner token; for the server, a token used when none is saved |
| `DRAFT_LOOP_SERVER_WORKSPACE` | `owner`                 | The workspace that receives the notes                                        |

### Revoke an agent token

An agent token expires 90 days after it is issued; create a new one under
Coding agents or run `init` again. A workspace holds at most 20 active tokens. Revoke
one under **Show and revoke** in Coding agents; a revoked token is refused at once
and the others keep working. From a terminal, the owner lists and revokes them
through the API:

```text
export DRAFT_LOOP_SERVER_TOKEN="$(draft-loop-server token)"
curl -s -H "authorization: Bearer $DRAFT_LOOP_SERVER_TOKEN" http://127.0.0.1:8080/v1/workspaces/owner/agent-tokens
curl -s -X DELETE -H "authorization: Bearer $DRAFT_LOOP_SERVER_TOKEN" http://127.0.0.1:8080/v1/workspaces/owner/agent-tokens/dlat_ID
```

Replace `dlat_ID` with the id the list shows; `active` is false once a token
is revoked or expired. Each note names the agent token that filed it.
To review everything one token filed or amended, such as after revoking it:

```text
curl -s -H "authorization: Bearer $DRAFT_LOOP_SERVER_TOKEN" "http://127.0.0.1:8080/v1/workspaces/owner/work-journal/notes?fields=summary&agent_token_id=dlat_ID"
```

Run `init` again to issue a new one. The
[agent token audit](../security/agent-token-audit.md) lists every rule.

### The `/log-work` skill and the Stop hook

- **`/log-work`** takes an optional date range, lists what was merged on the
  default branch from the local git history, and records each notable piece
  once, after `list_work` shows it is not already recorded.
- **The Stop hook** (Claude Code only, with `--hook`) adds one advisory line
  when a turn pushed or merged without calling `record_work`. It never blocks
  the turn, and nothing calls the tool by itself.

## What the agent records

The tools are `record_work`, which files a note, and `list_work`, which lists
notes by title, dates, technologies and status, never summaries or links. The
rule travels with the server, in the tool description, the
`draftloop://work-journal/guide` resource and the `log-notable-work` prompt.

- **Record** shipped work a hiring manager would ask about: a merged feature,
  integration or migration, an adopted technology, or a measured improvement
  with how it was measured.
- **Never record** typo fixes, formatting, dependency bumps, refactors without
  an outcome, work in progress, or work the candidate did not take part in.
- **Never include** keys, tokens, passwords, connection strings, customer or
  personal data, or private document text. The server refuses a note that
  looks like it holds a secret.
- **The role is stated as it was:** designed, implemented, directed or
  reviewed.

### When a tool call fails

A failed call answers `isError` with one JSON object:
`{"error": {"code", "message", "fields", "retryable"}}`. The message is one
sentence, and `fields` names the note fields to fix.

| `retryable` | When                                                                                       | What the agent does              |
| ----------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| `true`      | The server is unreachable, or answers 408, 425, 429, 500, 502, 503 or 504                  | Tries the same call again later  |
| `false`     | Validation, permission, not found, conflict, no token (`not_signed_in`), or `internal_error` | Fixes the input or asks the user |

## Job applications and runs

With the matching scopes, the agent can also see the candidate's job
applications and add one. Each tool returns names, status and run state only,
never a draft, career evidence or job text.

| Tool                | Scope               | What it does                                                               |
| ------------------- | ------------------- | -------------------------------------------------------------------------- |
| `list_applications` | `applications:read` | Lists applications with status, folder and latest run; archived on request |
| `get_application`   | `applications:read` | Reads one application by id                                                |
| `get_run_status`    | `applications:read` | Says where a CV run stands and what waits for the candidate                |
| `add_job`           | `jobs:write`        | Adds an application from a job description pasted as text                  |

`add_job` refuses a job page address, because fetching a page needs the
candidate's approval in DraftLoop. The job text is screened like an upload
when its requirements are extracted. Approving a draft, deciding findings,
exporting and every setting stay with the candidate in DraftLoop. A token
without the scope a tool needs is refused with a message naming that scope.

`init` asks for scopes with `--scope`, repeated:

```text
draftloop-mcp init --host claude-code --hook --scope applications:read --scope jobs:write
```

## How the candidate reviews

Each pending note shows its title, period, project, technologies, role, links,
summary and screening result. The candidate can:

- **Approve** it into a knowledge base. It becomes a Markdown source of the
  `work-journal` evidence kind, so runs can cite it like any other source.
- **Edit** any field first. The edit is checked and screened again.
- **Merge** it with a likely duplicate shown beside it. Links and technologies
  are combined, the period is widened and one summary is kept.
- **Discard** it. A discarded note's text is forgotten after 30 days, and the
  same work is not recorded again.

A pending note's review link, `/#work-journal`, opens this panel, and the
workspace home shows how many notes wait. The same review runs from the CLI
with `draft-loop work-journal`; see the
[self-hosted server](../operations/self-hosted.md#work-journal) guide.

## Privacy lines

- **Duplicates.** The same pull request in the same repository, or the same
  title in the same project, is recorded once. A note about the same project
  over overlapping dates with shared technologies or links is recorded and
  shown as a likely duplicate.
- **Screening.** Each note is screened for instructions to a model, like an
  upload. A held note cannot be approved until an edit screens clear.
- **Default tiers.** An approved note from a public project is `normal`, and
  one from a private or unknown project is `sensitive`. The candidate can
  choose another tier at approval.
- **Repositories and links.** For a private or unknown project, the note's
  repository and links are `never-share`, so they never reach a model
  provider while the work itself stays usable.
- **What the agent sees.** Everything a tool returns reaches the agent's model
  provider, so `list_work` returns only titles, dates, technologies and
  status.
- **Limits.** The server takes up to 60 notes an hour per workspace and keeps
  up to 500 pending notes.
