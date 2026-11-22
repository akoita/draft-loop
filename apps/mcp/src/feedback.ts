import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { WorkspaceApiCall } from "./client.js";

/**
 * The agent channel's feedback tool (#2843): passes the candidate's own note about Redakloop to
 * the people who run it, as if sent from the header menu. Needs the token's `journal` scope.
 */

export type FeedbackCategory = "bug" | "idea" | "other";

export interface SentFeedback {
  readonly note_id: string;
  readonly sent_at: string;
  readonly next_step: string;
}

export interface FeedbackApi {
  send(text: string, category?: FeedbackCategory): Promise<SentFeedback>;
}

interface NoteBody {
  readonly noteId: string;
  readonly sentAt: string;
}

export function createFeedbackApi(call: WorkspaceApiCall): FeedbackApi {
  return {
    send: async (text, category) => {
      const body = (await call("/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          screen: "agent",
          ...(category === undefined ? {} : { category }),
        }),
      })) as NoteBody;
      return {
        note_id: body.noteId,
        sent_at: body.sentAt,
        next_step: "Sent. The people who run Redakloop read it; there is no reply in Redakloop.",
      };
    },
  };
}

export const sendFeedbackDescription =
  "Send the candidate's own feedback about Redakloop (a bug, an idea, anything else) to the people who run it. Send only what the candidate asked you to pass on, in their words, at most 2,000 characters; never include secrets or other people's data. Needs the journal scope.";

type Failure = (error: unknown) => {
  isError: boolean;
  content: { type: "text"; text: string }[];
};

/** Registers send_feedback on the server. */
export function registerFeedbackTools(server: McpServer, api: FeedbackApi, failure: Failure): void {
  server.registerTool(
    "send_feedback",
    {
      title: "Send feedback about Redakloop",
      description: sendFeedbackDescription,
      inputSchema: z.object({
        text: z.string().trim().min(1).max(2_000).describe("The candidate's note, in their words."),
        category: z.enum(["bug", "idea", "other"]).optional(),
      }),
      outputSchema: z.object({ note_id: z.string(), sent_at: z.string(), next_step: z.string() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ text, category }) => {
      try {
        const structured = { ...(await api.send(text, category)) };
        return {
          structuredContent: structured,
          content: [{ type: "text" as const, text: JSON.stringify(structured) }],
        };
      } catch (error) {
        return failure(error);
      }
    },
  );
}
