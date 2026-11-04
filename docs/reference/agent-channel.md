# Agent channel: the work journal

The candidate's coding agent can record notable work it helped ship, such as a
payments integration or a database migration, as a note in DraftLoop's work
journal. A note is evidence for review, never a CV claim: it waits as pending
until the candidate approves it on the Career evidence page or from the CLI.
The design is [ADR 0011, D17](../adr/0011-client-server-version.md#d17-agent-channel-an-mcp-server).

The channel is `draftloop-mcp`, a stdio MCP server that calls the
[self-hosted server](../operations/self-hosted.md)'s API with an agent token.
An agent token reaches only the work journal of one workspace: it can file
notes and list their titles, and every other route refuses it.
Candidate data stays on your machine. Without the self-hosted stack, there is
nothing for it to call: the CLI-only path is not served.

A real Claude Code session was walked through this setup on 2026-11-04; the
[walk record](../evaluation/work-journal-walk.md) lists what passed and the
open defects.

## Set it up

1. Run the self-hosted server, and turn on **Accept notes from coding agents**
   in the Work journal panel of its Career evidence page. The server refuses
   notes while it is off.
2. Put `draftloop-mcp` on your `PATH` from a clone of this repository. Run the
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

3. In the project whose work you want to record, run `init` for your agent,
   with the owner token for that one command only:

   ```text
   DRAFT_LOOP_SERVER_TOKEN="$(draft-loop-server token)" draftloop-mcp init --host claude-code
   ```

   Use `--host codex` or `--host generic` for the other hosts, and add
   `--hook` for Claude Code's Stop hook. `init` writes the project's files,
   asks the server for an agent token and saves it in your configuration
   folder, then prints `issued: agent token dlat_..., saved to ...`.

4. Start the agent from a shell without the owner token. `draftloop-mcp`
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

The owner lists and revokes agent tokens through the API; a revoked token is
refused at once and the others keep working:

```text
export DRAFT_LOOP_SERVER_TOKEN="$(draft-loop-server token)"
curl -s -H "authorization: Bearer $DRAFT_LOOP_SERVER_TOKEN" http://127.0.0.1:8080/v1/workspaces/owner/agent-tokens
curl -s -X DELETE -H "authorization: Bearer $DRAFT_LOOP_SERVER_TOKEN" http://127.0.0.1:8080/v1/workspaces/owner/agent-tokens/dlat_ID
```

Replace `dlat_ID` with the id the list shows. Run `init` again to issue a new
one.

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
