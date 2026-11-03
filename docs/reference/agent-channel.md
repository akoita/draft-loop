# Agent channel: the work journal

The candidate's coding agent can record notable work it helped ship, such as a
payments integration or a database migration, as a note in DraftLoop's work
journal. A note is evidence for review, never a CV claim: it waits as pending
until the candidate approves it on the Career evidence page or from the CLI.
The design is [ADR 0011, D17](../adr/0011-client-server-version.md#d17-agent-channel-an-mcp-server).

The channel is `draftloop-mcp`, a stdio MCP server that calls the
[self-hosted server](../operations/self-hosted.md)'s API with its owner token.
Candidate data stays on your machine. Without the self-hosted stack, there is
nothing for it to call: the CLI-only path is not served.

## Set it up

1. Run the self-hosted server, and turn on **Accept notes from coding agents**
   in the Work journal panel of its Career evidence page. The server refuses
   notes while it is off.
2. Put `draftloop-mcp` on your `PATH` from a clone of this repository:

   ```text
   pnpm install
   pnpm --dir apps/mcp link --global
   ```

3. In the project whose work you want to record, run `init` for your agent:

   ```text
   draftloop-mcp init --host claude-code [--hook]
   draftloop-mcp init --host codex
   draftloop-mcp init --host generic
   ```

4. Export the owner token, which `draft-loop-server token` prints, in the
   shell that starts the agent:

   ```text
   export DRAFT_LOOP_SERVER_TOKEN=<token>
   ```

`init` merges into existing files, and running it again changes nothing. The
files hold only names: the token stays in the environment, and no path of your
machine is written.

| Host | Server entry | Instructions | Skill |
| --- | --- | --- | --- |
| Claude Code | `.mcp.json` | `CLAUDE.md` | `.claude/skills/log-work/SKILL.md` |
| Codex | `.codex/config.toml` | `AGENTS.md` | `.agents/skills/log-work/SKILL.md` |
| Other MCP hosts | `.mcp.json` | `AGENTS.md` | `.agents/skills/log-work/SKILL.md` |

Codex reads a project's `.codex/config.toml` only in a trusted project; copy
the marked block into `~/.codex/config.toml` otherwise.

The server reads three settings from its environment:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DRAFT_LOOP_SERVER_URL` | `http://127.0.0.1:8080` | The self-hosted server's address |
| `DRAFT_LOOP_SERVER_TOKEN` | none | The owner token; `DRAFT_LOOP_SERVER_TOKEN_FILE` reads it from a file instead |
| `DRAFT_LOOP_SERVER_WORKSPACE` | `owner` | The workspace that receives the notes |

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

The same review runs from the CLI with `draft-loop work-journal`; see the
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
