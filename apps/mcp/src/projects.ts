import { createHash } from "node:crypto";
import { projectCardInputSchema } from "@draft-loop/schemas/project-card";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { WorkspaceApiCall } from "./client.js";

/**
 * The agent channel's project card tool (#2895): an agent that read a repository on the
 * candidate's machine files a short, cited card about it. The card waits in DraftLoop's Work
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

export const addProjectDescription = `File a project card about one code repository the candidate wrote or led, for their career evidence. The card waits in DraftLoop's Work journal until the candidate approves, edits or discards it. Needs the evidence:write scope.

Show the card to the candidate and get their yes before you call this tool.
Send card fields only. Never send source code, file contents, diffs, keys, tokens, passwords or customer data.
Read only: README, docs Markdown, manifests (package.json, pyproject.toml, go.mod, Cargo.toml, Dockerfiles, Terraform), release notes, and the candidate's own commit and pull request titles.
Count every number from git, never estimate: own_commits with git log --author for each of the candidate's commit emails, total_commits with git rev-list --count HEAD, first_commit and last_commit from the candidate's own commits, other_contributors as the count of other authors.
Never name or email another contributor. Never put any email address in the card, the candidate's included.
role is sole-author, lead or contributor, as the candidate confirms. Each highlight cites the file or pull request it was read from.
For a private repository set visibility private and send no repository_url, live_url or release_url.
Use dry_run to check a card without storing it. Read draftloop://projects/guide for the full steps.`;

export const projectGuideText = `# DraftLoop project cards: how to file one

A project card is a short, cited summary of one repository. It is evidence for the candidate to review, never code and never a CV claim on its own.

## Steps

1. Ask the candidate which emails they commit with, their role (sole author, lead or contributor) and whether the repository is public or private.
2. Count, for each email: \`git log --author=<email> --format=%H | sort -u | wc -l\` for own commits, and \`git log --author=<email> --format=%as\` for the first and last dates. Total: \`git rev-list --count HEAD\`. Other contributors: the distinct author emails minus the candidate's, as a count only.
3. Read only the allowed files: README, docs Markdown, manifests, Dockerfiles, Terraform, release notes, and the candidate's own commit and pull request titles.
4. Draft the card: name, a one-line purpose, a summary a hiring manager reads (the problem, what it does, its scale), the stack from the manifests, scale signals (releases, stars, CI, tests) and up to eight highlights, each citing its source file or pull request.
5. Show the card to the candidate, apply their changes, then call add_project.

## Never

- Read or send source code, file contents or diffs.
- Estimate a number. If git cannot count it, leave the field out.
- Name or email another contributor, or put any email in the card.
- Send links for a private repository.
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
