import { factSuggestionChangeSchema } from "@draft-loop/schemas/fact-suggestion";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { WorkspaceApiCall } from "./client.js";

/**
 * The agent channel's career profile tools (#3072): read the reviewed profile and suggest
 * updates to it. A suggestion waits for the candidate on the Career profile page; accepting and
 * rejecting stay with people. Needs the token's `profile:suggest` scope, which no token gets
 * unless the candidate ticks it.
 */

const factSchema = z.object({
  id: z.string(),
  category: z.string(),
  subjectId: z.string().optional(),
  field: z.string(),
  value: z.string(),
  usage: z.enum(["cv", "interview-only"]),
});

const profileSchema = z.object({
  profileId: z.string(),
  version: z.number().int(),
  reviewedAt: z.string().optional(),
  facts: z.array(factSchema),
  withheld: z.number().int(),
});

export type AgentProfile = z.infer<typeof profileSchema>;

const suggestionInputSchema = z.object({
  factId: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe("The fact's id from get_profile, for correct, retire, set-usage or confirm."),
  change: factSuggestionChangeSchema.describe(
    "add: a new fact (category, field, value). correct: a new value for the fact. retire: the fact no longer holds. set-usage: cv, interview-only or never-say. confirm: the fact is right.",
  ),
  quote: z
    .string()
    .trim()
    .min(1)
    .max(1_000)
    .describe("The words behind the change, exactly as read or as the candidate said them."),
  speaker: z
    .enum(["agent", "candidate"])
    .describe("agent: you read it somewhere. candidate: the candidate told you."),
});

const suggestionResultSchema = z.object({
  suggestionId: z.string(),
  status: z.enum(["pending", "duplicate", "previously_rejected"]),
  message: z.string(),
});

export type AgentProfileSuggestionResult = z.infer<typeof suggestionResultSchema>;

const listInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
});

const listOutputSchema = z.object({
  suggestions: z.array(
    z.object({
      id: z.string(),
      factId: z.string().optional(),
      change: factSuggestionChangeSchema,
      status: z.enum(["pending", "accepted", "edited", "rejected", "stale"]),
      createdAt: z.string(),
    }),
  ),
});

export type AgentProfileSuggestionList = z.infer<typeof listOutputSchema>;

export interface ProfileApi {
  get(): Promise<AgentProfile>;
  suggest(input: z.infer<typeof suggestionInputSchema>): Promise<AgentProfileSuggestionResult>;
  list(limit?: number): Promise<AgentProfileSuggestionList>;
}

export function createProfileApi(call: WorkspaceApiCall): ProfileApi {
  return {
    get: async () => (await call("/agent-profile", { method: "GET" })) as AgentProfile,
    suggest: async (input) =>
      (await call("/agent-profile/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      })) as AgentProfileSuggestionResult,
    list: async (limit) =>
      (await call(`/agent-profile/suggestions${limit === undefined ? "" : `?limit=${limit}`}`, {
        method: "GET",
      })) as AgentProfileSuggestionList,
  };
}

export const getProfileDescription = `Read the candidate's reviewed career profile: each fact with its id, category, field, value and usage (cv: any output; interview-only: interview preparation only). Facts the candidate marked never to say are left out and counted in withheld. Needs the profile:suggest scope.

Use the fact ids with suggest_profile_update. Never repeat a fact outside the conversation with the candidate.`;

export const suggestProfileUpdateDescription = `Suggest one update to the candidate's reviewed career profile. It waits for the candidate, who accepts, edits or rejects it in Redakloop; you never decide. Needs the profile:suggest scope.

Suggest only what you read in the candidate's own material or what the candidate told you, and quote those words. Set speaker to candidate when they said it, agent when you read it.
change.kind: add (a new fact, no factId), correct (a new value), retire (no longer true), set-usage (cv, interview-only or never-say) or confirm (the fact is right). Every kind but add names the factId from get_profile.
Never invent a fact, a date, an employer or a number. Never send keys, tokens or passwords.
A repeat answers duplicate; a change the candidate rejected answers previously_rejected, so do not suggest it again.`;

export const listProfileSuggestionsDescription = `List the profile updates you suggested, newest first, with their status: pending, accepted, edited, rejected or stale (the fact changed first). Needs the profile:suggest scope.`;

type Failure = (error: unknown) => {
  isError: boolean;
  content: { type: "text"; text: string }[];
};

function structured<T extends object>(value: T) {
  return {
    structuredContent: value,
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

/** Registers get_profile, suggest_profile_update and list_profile_suggestions. */
export function registerProfileTools(server: McpServer, api: ProfileApi, failure: Failure): void {
  server.registerTool(
    "get_profile",
    {
      title: "Read the career profile",
      description: getProfileDescription,
      outputSchema: profileSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        return structured(await api.get());
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "suggest_profile_update",
    {
      title: "Suggest a career profile update",
      description: suggestProfileUpdateDescription,
      inputSchema: suggestionInputSchema,
      outputSchema: suggestionResultSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      try {
        return structured(await api.suggest(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "list_profile_suggestions",
    {
      title: "List your profile suggestions",
      description: listProfileSuggestionsDescription,
      inputSchema: listInputSchema,
      outputSchema: listOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ limit }) => {
      try {
        return structured(await api.list(limit));
      } catch (error) {
        return failure(error);
      }
    },
  );
}
