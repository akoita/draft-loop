import { createHash } from "node:crypto";
import { projectCardInputSchema } from "@draft-loop/schemas/project-card";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { WorkspaceApiCall } from "./client.js";

/**
 * The agent channel's project card tool (#2895): an agent that read a repository on the
 * candidate's machine files a short, cited card about it. The card waits in Redakloop's Work
 * journal until the candidate approves it. Needs the token's `evidence:write` scope.
 */

export interface ProjectCardResult {
  readonly card_id?: string;
  readonly status: "pending" | "duplicate" | "previously_discarded" | "validated";
  readonly duplicate_of?: string;
  readonly possible_duplicate_of: readonly string[];
  readonly screening?: "clear" | "flagged" | "unscreened";
  readonly review_url?: string;
  readonly message: string;
}

export interface ProjectsApi {
  add(card: unknown, idempotencyKey?: string): Promise<ProjectCardResult>;
}

export function createProjectsApi(call: WorkspaceApiCall): ProjectsApi {
  return {
    add: async (card, idempotencyKey) =>
      (await call("/work-journal/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
        },
        body: JSON.stringify(card),
      })) as ProjectCardResult,
  };
}

export const addProjectDescription = `File a project card about one code repository the candidate wrote or led, for their career evidence. The card waits in Redakloop's Work journal until the candidate approves, edits or discards it. Needs the evidence:write scope.

Show the card to the candidate and get their yes before you call this tool.
Send card fields only. Never send source code, file contents, diffs, keys, tokens, passwords or customer data.
Read only: README, docs Markdown, manifests (package.json, pyproject.toml, go.mod, Cargo.toml, Dockerfiles, Terraform), release notes, and the candidate's own commit and pull request titles.
Count every number from git, never estimate: run draft-loop evidence add-repo when it is installed, else count non-merge commits with git log --no-merges: own_commits for the candidate's commit emails, total_commits for all authors, first_commit and last_commit from the candidate's own commits, other_contributors as the count of other author emails.
Never name or email another contributor. Never put any email address in the card, the candidate's included.
role is sole-author, lead or contributor, as the candidate confirms. Each highlight cites the file or pull request it was read from.
For a private repository set visibility private and send no repository_url, live_url or release_url.
Use dry_run to check a card without storing it. Read draftloop://projects/guide for the full steps.`;

export const projectGuideText = `# Redakloop project cards: how to file one

A project card is a short, cited summary of one repository. It is evidence for the candidate to review, never code and never a CV claim on its own.

## Steps

1. Ask the candidate which emails they commit with, their role (sole author, lead or contributor) and whether the repository is public or private.
2. Count: run \`draft-loop evidence add-repo . --email <email>...\` when the CLI is installed; it prints the counted fields as JSON with no model call. Otherwise list \`git log --no-merges --format="%ae %as" HEAD\`: own commits are the lines with one of the candidate's emails, the total is every line, the dates are the candidate's first and last, and other contributors are the other distinct emails, as a count only.
3. Read only the allowed files: README, docs Markdown, manifests, Dockerfiles, Terraform, release notes, and the candidate's own commit and pull request titles.
4. Draft the card: name, a one-line purpose, a summary a hiring manager reads (the problem, what it does, its scale), the stack from the manifests, scale signals (releases, stars, CI, tests) and up to eight highlights, each citing its source file or pull request.
5. Show the card to the candidate, apply their changes, then call add_project.

## Never

- Read or send source code, file contents or diffs.
- Estimate a number. If git cannot count it, leave the field out.
- Name or email another contributor, or put any email in the card.
- Send links for a private repository.
`;

/** The plugin's and \`init\`'s \`/add-project\` skill: the guide as steps the agent follows. */
export const addProjectSkill = `---
name: add-project
description: Turn the current code repository into a Redakloop project card the candidate reviews before it is sent.
---

# Add this repository as a project card

Use this when the candidate asks to add the current repository to their career evidence.

1. Ask for the candidate's commit emails, their role (sole author, lead or contributor) and whether the repository is public or private. Ask for its public address and live site only when public.
2. Count the numbers. Run \`draft-loop evidence add-repo . --email <email>...\` when it is installed. Otherwise count from \`git log --no-merges --format="%ae %as" HEAD\`: own commits, total commits, the candidate's first and last commit dates, and other contributors as a count. Never estimate a number.
3. Read only the README, Markdown under docs, manifests (package.json, pyproject.toml, go.mod, Cargo.toml and similar), Dockerfiles, Terraform files, release notes, and the candidate's own commit and pull request titles. Never open source files.
4. Draft the card: a one-line purpose, a summary a hiring manager reads (the problem, what it does, its scale), the stack, scale signals, and up to eight highlights, each citing the file or pull request it came from.
5. Show the whole card to the candidate and apply their changes. Send nothing until they say yes.
6. Call \`add_project\` with the card. Never include code, file contents, keys, or any email address, and send no links for a private repository.
7. Say that the card waits for the candidate's approval in Redakloop's Work journal.
`;

/** The same card sent twice in one session replays the first answer instead of filing again. */
function idempotencyKey(card: unknown): string {
  return `mcp-card-${createHash("sha256").update(JSON.stringify(card)).digest("hex").slice(0, 40)}`;
}

const outputSchema = z.object({
  card_id: z.string().optional(),
  status: z.enum(["pending", "duplicate", "previously_discarded", "validated"]),
  duplicate_of: z.string().optional(),
  possible_duplicate_of: z.array(z.string()),
  screening: z.enum(["clear", "flagged", "unscreened"]).optional(),
  review_url: z.string().optional(),
  message: z.string(),
});

type Failure = (error: unknown) => {
  isError: boolean;
  content: { type: "text"; text: string }[];
};

/** Registers add_project and its guide on the server. */
export function registerProjectTools(server: McpServer, api: ProjectsApi, failure: Failure): void {
  server.registerTool(
    "add_project",
    {
      title: "Add a project card",
      description: addProjectDescription,
      inputSchema: projectCardInputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (card) => {
      try {
        const result = await api.add(card, idempotencyKey(card));
        const structured = { ...result, possible_duplicate_of: [...result.possible_duplicate_of] };
        return {
          structuredContent: structured,
          content: [{ type: "text", text: JSON.stringify(structured) }],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerResource(
    "project-card-guide",
    "draftloop://projects/guide",
    {
      title: "How to file a project card",
      description: "The steps, the files an agent may read, and what never goes in a card.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: projectGuideText }],
    }),
  );
}
