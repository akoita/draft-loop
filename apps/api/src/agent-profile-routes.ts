import type { ApplicationService } from "@draft-loop/application";
import {
  AgentProfileSuggestionError,
  agentProfileView,
  fileAgentProfileSuggestion,
  latestReviewedProfile,
  listAgentProfileSuggestions,
} from "@draft-loop/application/agent-profile-suggestions";
import type { FactUsageService } from "@draft-loop/application/fact-usage";
import { canonicalCandidateProfileFactCategories } from "@draft-loop/domain";
import { factSuggestionLimits, factSuggestionStatuses } from "@draft-loop/domain/fact-suggestion";
import { emptyFactUsageSettings } from "@draft-loop/domain/fact-usage";
import { factSuggestionChangeSchema } from "@draft-loop/schemas/fact-suggestion";
import type { FactSuggestionStore } from "@draft-loop/storage/fact-suggestions";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

/**
 * The career profile over the agent channel (#3072): an agent reads the reviewed profile and
 * files suggested updates, which wait for the person on the Career profile page. Accepting and
 * rejecting stay people-only (`fact-suggestion-routes.ts`). Logs hold ids and codes only.
 */
export interface AgentProfileRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly store: FactSuggestionStore;
  readonly factUsage?: FactUsageService;
}

const params = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

const factSchema = z.object({
  id: z.string(),
  category: z.enum(canonicalCandidateProfileFactCategories),
  subjectId: z.string().optional(),
  field: z.string(),
  value: z.string(),
  usage: z
    .enum(["cv", "interview-only"])
    .describe("cv: any output may use it. interview-only: interview preparation only."),
});

const viewSchema = z
  .object({
    profileId: z.string(),
    version: z.number().int(),
    reviewedAt: z.string().optional(),
    facts: z.array(factSchema),
    withheld: z
      .number()
      .int()
      .describe("Facts left out because the candidate marked them never-say."),
  })
  .meta({ id: "AgentProfileView" });

const suggestionBody = z.strictObject({
  factId: z
    .string()
    .min(1)
    .max(factSuggestionLimits.idMax)
    .optional()
    .describe("The fact a correct, retire, set-usage or confirm changes; no factId for an add."),
  change: factSuggestionChangeSchema,
  quote: z
    .string()
    .trim()
    .min(factSuggestionLimits.quoteMin)
    .max(factSuggestionLimits.quoteMax)
    .describe("The words behind the change, as read or as the candidate said them."),
  speaker: z
    .enum(["agent", "candidate"])
    .describe("agent: the agent read it somewhere. candidate: the candidate stated it."),
});

const suggestionResultSchema = z
  .object({
    suggestionId: z.string(),
    status: z.enum(["pending", "duplicate", "previously_rejected"]),
    message: z.string(),
  })
  .meta({ id: "AgentProfileSuggestionResult" });

const listQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const listSchema = z
  .object({
    suggestions: z.array(
      z.object({
        id: z.string(),
        factId: z.string().optional(),
        change: factSuggestionChangeSchema,
        status: z.enum(factSuggestionStatuses),
        createdAt: z.string(),
      }),
    ),
  })
  .meta({ id: "AgentProfileSuggestionList" });

const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  422: apiErrorSchema,
  429: apiErrorSchema,
} as const;

/** Who filed it: the agent token, else the caller's credential as a fixed id. */
function filerOf(request: FastifyRequest): string {
  return request.agentToken?.id ?? "owner-token";
}

export function registerAgentProfileRoutes(
  parent: FastifyInstance,
  options: AgentProfileRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, store, factUsage } = options;

  const reviewed = async (workspaceId: string) => {
    const root = workspaceRoot(workspaceId);
    const versions = await service.listCanonicalCandidateProfileVersions({ root });
    const profile = latestReviewedProfile(versions.map((record) => record.profile));
    const usage = (await factUsage?.read(root)) ?? emptyFactUsageSettings;
    return { profile, usage };
  };

  app.get(
    "/v1/workspaces/:workspaceId/agent-profile",
    {
      schema: {
        summary: "Read the reviewed career profile as an agent sees it",
        description:
          "What the MCP tool get_profile reads: the newest reviewed profile's facts with their ids, without the facts the candidate marked never-say. 404 when no profile is reviewed yet.",
        params,
        response: { 200: viewSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { profile, usage } = await reviewed(request.params.workspaceId);
      if (profile === undefined) {
        return reply
          .code(404)
          .send(
            apiError("no_reviewed_profile", "The candidate has no reviewed career profile yet."),
          );
      }
      const view = agentProfileView(profile, usage);
      return { ...view, facts: [...view.facts] };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/agent-profile/suggestions",
    {
      bodyLimit: 16_384,
      schema: {
        summary: "Suggest an update to the reviewed career profile",
        description:
          "What the MCP tool suggest_profile_update sends: one change with the words behind it. It waits for the candidate, who accepts, edits or rejects it on the Career profile page; an agent never decides. Refusals: fact_not_found, target_required, target_not_allowed, secret_like_content, flagged_content (422), no_reviewed_profile (404), rate_limited (429). A repeat answers duplicate, a change the candidate rejected previously_rejected.",
        params,
        body: suggestionBody,
        response: { 200: suggestionResultSchema, 201: suggestionResultSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      const { profile, usage } = await reviewed(workspaceId);
      const agentTokenId = filerOf(request);
      try {
        const { factId, change, quote, speaker } = request.body;
        const result = await fileAgentProfileSuggestion({
          store,
          workspaceId,
          profile,
          usage,
          agentTokenId,
          input: { ...(factId === undefined ? {} : { factId }), change, quote, speaker },
        });
        request.log.info(
          {
            workspaceId,
            suggestionId: result.suggestionId,
            status: result.status,
            kind: change.kind,
            agentTokenId,
          },
          "agent profile suggestion filed",
        );
        return reply.code(result.status === "pending" ? 201 : 200).send(result);
      } catch (error) {
        if (!(error instanceof AgentProfileSuggestionError)) throw error;
        request.log.info(
          { workspaceId, code: error.code, agentTokenId },
          "agent profile suggestion refused",
        );
        const status =
          error.code === "no_reviewed_profile" ? 404 : error.code === "rate_limited" ? 429 : 422;
        return reply.code(status).send(apiError(error.code, error.message));
      }
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/agent-profile/suggestions",
    {
      schema: {
        summary: "List the profile suggestions this agent filed",
        description:
          "What the MCP tool list_profile_suggestions reads: this token's suggestions, newest first, with their status (pending, accepted, edited, rejected or stale).",
        params,
        querystring: listQuery,
        response: { 200: listSchema, ...errors },
      },
    },
    async (request) => ({
      suggestions: [
        ...(await listAgentProfileSuggestions({
          store,
          workspaceId: request.params.workspaceId,
          agentTokenId: filerOf(request),
          limit: request.query.limit,
        })),
      ],
    }),
  );
}
