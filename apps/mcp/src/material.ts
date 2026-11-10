import { applicationMaterialGuidanceSchema } from "@draft-loop/schemas/saved-application-material";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { WorkJournalApiError, type WorkspaceApiCall } from "./client.js";

/**
 * The agent channel's drafting tools (#2601): a cover letter or interview questions for one job
 * application, written by DraftLoop from the candidate's career facts on the default model. Each
 * draft reserves its cost cap against the agent token's monthly spend cap (`runs:start`). The
 * candidate reviews, edits and keeps the draft in DraftLoop.
 */

export type MaterialKind = "cover-letter" | "interview-questions";

export interface MaterialGuidance {
  readonly emphasis?: string | undefined;
  readonly tone?: string | undefined;
  readonly length?: string | undefined;
  readonly addressee?: string | undefined;
}

export interface AgentDraft {
  readonly application_id: string;
  readonly material_id: string | null;
  readonly kind: MaterialKind;
  readonly created_at: string | null;
  readonly items: readonly { readonly question: string; readonly text: string }[];
  readonly next_step: string;
}

export interface MaterialApi {
  draft(
    applicationId: string,
    kind: MaterialKind,
    guidance?: MaterialGuidance,
  ): Promise<AgentDraft>;
}

interface DraftBody {
  readonly id?: string;
  readonly created_at?: string;
  readonly kind: MaterialKind;
  readonly items: readonly { readonly question: string; readonly text: string }[];
}

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u;

function pathId(id: string): string {
  if (!idPattern.test(id)) {
    throw new WorkJournalApiError("invalid_id", "That is not a DraftLoop application id.", [
      "application_id",
    ]);
  }
  return encodeURIComponent(id);
}

/** A spent cap waits for next month, not a moment: the agent tells the candidate instead. */
function capFinal(error: unknown): never {
  if (error instanceof WorkJournalApiError && error.code === "agent_spend_cap_reached") {
    throw new WorkJournalApiError(error.code, error.message, error.fields, false);
  }
  throw error;
}

export function createMaterialApi(call: WorkspaceApiCall): MaterialApi {
  return {
    draft: async (applicationId, kind, guidance) => {
      const body = (await call(`/applications/${pathId(applicationId)}/material`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, ...(guidance === undefined ? {} : { guidance }) }),
      }).catch(capFinal)) as DraftBody;
      return {
        application_id: applicationId,
        material_id: body.id ?? null,
        kind: body.kind,
        created_at: body.created_at ?? null,
        // Citations stay out, as get_material leaves them: they are career facts, not the draft.
        items: body.items.map((item) => ({ question: item.question, text: item.text })),
        next_step:
          body.id === undefined
            ? "This server keeps no drafts: show the draft to the candidate now."
            : "The draft is saved in DraftLoop, where the candidate reviews and edits it.",
      };
    },
  };
}

const spendLine =
  "It spends money: draft only when the candidate asked, and once per request. It reserves one draft's cost cap against this token's monthly cap and is refused past it. Needs the runs:start scope.";

export const draftCoverLetterDescription = `Draft a cover letter for one job application from the candidate's career facts and the job's reviewed requirements, on DraftLoop's default model, and save it in DraftLoop. Pass the candidate's own wishes as guidance; never invent facts. ${spendLine}`;

export const draftInterviewPrepDescription = `Draft interview questions for one job application, each with a talking point from the candidate's career facts, on DraftLoop's default model, and save them in DraftLoop. Pass the candidate's own wishes as guidance. ${spendLine}`;

type Failure = (error: unknown) => {
  isError: boolean;
  content: { type: "text"; text: string }[];
};

function answer<T extends Record<string, unknown>>(structured: T) {
  return {
    structuredContent: structured,
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
  };
}

const outputSchema = z.object({
  application_id: z.string(),
  material_id: z.string().nullable(),
  kind: z.enum(["cover-letter", "interview-questions"]),
  created_at: z.string().nullable(),
  items: z.array(z.object({ question: z.string(), text: z.string() })),
  next_step: z.string(),
});

const annotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Registers the drafting tools on the server. */
export function registerMaterialTools(server: McpServer, api: MaterialApi, failure: Failure): void {
  for (const [name, kind, title, description] of [
    ["draft_cover_letter", "cover-letter", "Draft a cover letter", draftCoverLetterDescription],
    [
      "draft_interview_prep",
      "interview-questions",
      "Draft interview questions",
      draftInterviewPrepDescription,
    ],
  ] as const) {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: z.object({
          application_id: z.string().min(1).max(192),
          guidance: applicationMaterialGuidanceSchema
            .optional()
            .describe("The candidate's wishes on emphasis, tone, length and addressee."),
        }),
        outputSchema,
        annotations,
      },
      async ({ application_id, guidance }) => {
        try {
          return answer({ ...(await api.draft(application_id, kind, guidance)) });
        } catch (error) {
          return failure(error);
        }
      },
    );
  }
}
