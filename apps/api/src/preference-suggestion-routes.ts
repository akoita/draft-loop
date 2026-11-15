import {
  type PreferenceSuggestion,
  type PreferenceSuggestions,
  preferenceSuggestionIdPattern,
} from "@draft-loop/application/preference-suggestions";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiErrorSchema } from "./errors.js";

export interface PreferenceSuggestionRoutesOptions {
  readonly suggestions: PreferenceSuggestions;
  readonly workspaceRoot: (workspaceId: string) => string;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "Expected a safe identifier.");
const workspaceParams = z.strictObject({ workspaceId: identifierSchema });
const suggestionParams = workspaceParams.extend({
  suggestionId: z.string().regex(preferenceSuggestionIdPattern, "Expected a suggestion id."),
});

const preferenceSuggestionSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["forbidden-term", "section-order"]),
    term: z.string().optional().describe("The word to forbid, for a forbidden-term suggestion."),
    sectionOrder: z
      .array(z.string())
      .optional()
      .describe("The section kinds in order, for a section-order suggestion."),
    occurrences: z.number().int().describe("How many drafts showed the pattern."),
    applications: z.number().int().describe("How many applications those drafts belong to."),
    reason: z.string().describe("Why DraftLoop suggests it, in words the person can check."),
  })
  .meta({ id: "PreferenceSuggestion" });

// The source run ids stay off the route until the History tab shows them (#2670).
const view = ({ runIds: _runIds, ...suggestion }: PreferenceSuggestion) =>
  suggestion.kind === "forbidden-term"
    ? { ...suggestion }
    : { ...suggestion, sectionOrder: [...suggestion.sectionOrder] };

/**
 * Writing-policy preferences suggested from the person's review choices (#2253). DraftLoop
 * suggests; the person decides. Accepting saves a new writing-policy version; dismissing means
 * the suggestion is never offered again.
 */
export function registerPreferenceSuggestionRoutes(
  parent: FastifyInstance,
  options: PreferenceSuggestionRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { suggestions, workspaceRoot } = options;

  app.get(
    "/v1/workspaces/:workspaceId/preference-suggestions",
    {
      schema: {
        summary: "List writing preferences suggested from review choices",
        description:
          "Patterns from the person's own review edits and approvals that the writing policy does not hold yet. Nothing changes until the person accepts one.",
        params: workspaceParams,
        response: {
          200: z.object({ suggestions: z.array(preferenceSuggestionSchema) }),
          400: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => ({
      suggestions: (await suggestions.list(workspaceRoot(request.params.workspaceId))).map(view),
    }),
  );

  app.post(
    "/v1/workspaces/:workspaceId/preference-suggestions/:suggestionId/accept",
    {
      schema: {
        summary: "Accept a suggested writing preference",
        description:
          "Adds the preference to the writing policy as a new version, which the workspace's next runs follow.",
        params: suggestionParams,
        response: {
          200: z.object({ accepted: preferenceSuggestionSchema }),
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const { workspaceId, suggestionId } = request.params;
      return { accepted: view(await suggestions.accept(workspaceRoot(workspaceId), suggestionId)) };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/preference-suggestions/:suggestionId/dismiss",
    {
      schema: {
        summary: "Dismiss a suggested writing preference",
        description: "The suggestion is never offered again. The writing policy does not change.",
        params: suggestionParams,
        response: {
          200: z.object({ dismissed: z.string() }),
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request) => {
      const { workspaceId, suggestionId } = request.params;
      await suggestions.dismiss(workspaceRoot(workspaceId), suggestionId);
      return { dismissed: suggestionId };
    },
  );
}
