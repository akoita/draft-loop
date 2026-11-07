import { createHash } from "node:crypto";
import {
  workJournalNoteInputSchema,
  workJournalNoteListItemSchema,
  workJournalNoteStatuses,
} from "@draft-loop/schemas/work-journal";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { type ApplicationsApi, registerApplicationTools } from "./applications.js";
import { type WorkJournalApi, WorkJournalApiError } from "./client.js";

/**
 * The DraftLoop MCP server (ADR 0011 D17, #2023, #2440). A host agent records notable work it
 * helped ship as a note the candidate reviews in DraftLoop, lists what it recorded, and, where
 * its token's scopes allow, lists job applications, adds one from pasted job text and follows a
 * run. Decisions stay in DraftLoop. The rule of what to record travels with the server, in the tool description,
 * the guide resource, the prompt and the instructions.
 */

export const serverVersion = "0.2.0";

export const serverInstructions = [
  "DraftLoop keeps the candidate's career evidence; record_work files a note about notable work you just helped ship, which waits for the candidate's review and never becomes a CV claim by itself.",
  "Call it after a merge or release that a hiring manager would care about, never for routine fixes, and never include secrets, customer data or anything the candidate asked you to keep private.",
  "Read draftloop://work-journal/guide when unsure, and use list_work to avoid recording the same work twice.",
  "list_applications, get_application and get_run_status show the candidate's job applications and where their CV runs stand; add_job adds an application from a job description the candidate pasted.",
  "Approving a draft, deciding findings, exporting and every setting stay with the candidate in DraftLoop: say what waits for them instead of trying.",
  "A refusal that names a missing scope means the candidate must create a token with it under Coding agents in DraftLoop's Workspace settings.",
].join(" ");

export const recordWorkDescription = `File a note about notable work you just helped the candidate ship, for their career evidence. The note waits in DraftLoop's Work journal until the candidate approves, edits or discards it.

Record when: a feature, integration or migration was merged or released; a named technology was adopted (for example a payments provider, a database, a protocol); a measured improvement landed (latency, cost, error rate), with how it was measured.
Never record: typo fixes, formatting, dependency bumps, refactors without an outcome, work still in progress, or work the candidate did not take part in.
Never include: keys, tokens, passwords, connection strings, customer or personal data, or text from private documents. Links are stored and never fetched; a private project's repository is withheld from model providers.
candidate_role says what the candidate did: designed, implemented, directed or reviewed. Do not overstate it.
Use amends with a note id to correct a pending note, and dry_run to check a note without storing it.`;

export const listWorkDescription =
  "List the work journal notes already recorded, by title, dates, technologies and status, so you can avoid recording the same work twice or amend a pending note. It never returns summaries, links or metrics.";

export const guideText = `# DraftLoop work journal: what to record

Record notable work that a hiring manager would ask about, once it has shipped. A note is evidence for the candidate to review, never a CV claim.

## Record

1. "Added card payments with a hosted checkout and webhooks" after the pull request merged: category payments, technologies Stripe and TypeScript, role implemented.
2. "Moved session storage from Redis to Postgres with no downtime" after the release: category migration, a metric only if it was measured, with how_measured.
3. "Designed the event schema the three services now share" after the design was accepted and built: category design, role designed.

## Do not record

1. A typo fix, a lint fix or a dependency bump.
2. Work that is still on a branch, or that was reverted.
3. Anything the candidate only watched, or a role larger than what they did.

## Never include

Keys, tokens, passwords, connection strings, customer data, personal data or private document text. Links are stored, never fetched. For a private project, set visibility to private: its repository and links stay out of model input.
`;

export const logNotableWorkPrompt = `Look at what was merged or released in this session. If any of it is notable work by the record rule of draftloop://work-journal/guide, call list_work for the project first, then record_work once per piece of work that is not already recorded. Ask the candidate when their role or the project's visibility is unclear. If nothing is notable, record nothing and say so.`;

/**
 * What the agent is told when a call fails: the code, one sentence, and whether trying again later
 * can help (#2263). An unexpected failure inside this server is not retryable: the same call would
 * fail the same way.
 */
function failure(error: unknown) {
  const refusal =
    error instanceof WorkJournalApiError
      ? {
          code: error.code,
          message: error.message,
          fields: error.fields,
          retryable: error.retryable,
        }
      : {
          code: "internal_error",
          message: "The DraftLoop MCP server failed.",
          fields: [],
          retryable: false,
        };
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: refusal }) }],
  };
}

/** The same note sent twice in one session replays the first answer instead of recording again. */
function idempotencyKey(note: unknown): string {
  return `mcp-${createHash("sha256").update(JSON.stringify(note)).digest("hex").slice(0, 48)}`;
}

const recordOutputSchema = z.object({
  note_id: z.string().optional(),
  status: z.enum(["pending", "amended", "duplicate", "previously_discarded", "validated"]),
  duplicate_of: z.string().optional(),
  possible_duplicate_of: z.array(z.string()),
  screening: z.enum(["clear", "flagged", "unscreened"]).optional(),
  review_url: z.string().optional(),
  message: z.string(),
});

const listInputSchema = z.object({
  project: z.string().trim().min(1).max(120).optional().describe("Exact project name."),
  since: z.iso
    .datetime({ offset: true })
    .optional()
    .describe("Notes recorded at or after this time."),
  status: z.enum(workJournalNoteStatuses).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const listOutputSchema = z.object({ notes: z.array(workJournalNoteListItemSchema) });

export function createWorkJournalMcpServer(
  api: WorkJournalApi,
  applications?: ApplicationsApi,
): McpServer {
  const server = new McpServer(
    { name: "draftloop", version: serverVersion },
    { instructions: serverInstructions },
  );

  server.registerTool(
    "record_work",
    {
      title: "Record notable work",
      description: recordWorkDescription,
      inputSchema: workJournalNoteInputSchema,
      outputSchema: recordOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (note) => {
      try {
        const result = await api.record(note, idempotencyKey(note));
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

  server.registerTool(
    "list_work",
    {
      title: "List recorded work",
      description: listWorkDescription,
      inputSchema: listInputSchema,
      outputSchema: listOutputSchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (query) => {
      try {
        const notes = [...(await api.list(query))];
        return {
          structuredContent: { notes },
          content: [{ type: "text", text: JSON.stringify({ notes }) }],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  if (applications !== undefined) registerApplicationTools(server, applications, failure);

  server.registerResource(
    "work-journal-guide",
    "draftloop://work-journal/guide",
    {
      title: "What to record in the work journal",
      description: "The record and never-record rule, with three examples of each.",
      mimeType: "text/markdown",
    },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: guideText }] }),
  );

  server.registerPrompt(
    "log-notable-work",
    {
      title: "Log notable work",
      description: "Review this session's merged or released work and record what is notable.",
    },
    async () => ({
      messages: [{ role: "user", content: { type: "text", text: logNotableWorkPrompt } }],
    }),
  );

  return server;
}
