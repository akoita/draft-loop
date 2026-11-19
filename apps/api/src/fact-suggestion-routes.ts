import type { ApplicationService, HostedKnowledgeIntake } from "@draft-loop/application";
import {
  type CandidateStatementReference,
  createFactSuggestionDecisions,
  type FactSuggestionDecider,
  FactSuggestionDecisionError,
} from "@draft-loop/application/fact-suggestion-decisions";
import type { FactUsageService } from "@draft-loop/application/fact-usage";

import {
  factSuggestionStatuses,
  maximumFactSuggestionBatch,
} from "@draft-loop/domain/fact-suggestion";
import {
  factSuggestionChangeSchema,
  factSuggestionIdSchema,
  factSuggestionSchema,
} from "@draft-loop/schemas/fact-suggestion";
import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";
import {
  type FactSuggestionStore,
  FactSuggestionStoreError,
} from "@draft-loop/storage/fact-suggestions";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { ContentScreeningHooks } from "./content-screening-routes.js";
import { apiError, apiErrorSchema } from "./errors.js";
import { refusingProfileRules } from "./profile-errors.js";

/**
 * Suggested career profile updates (#3069): list a profile's suggestions, accept a batch or reject
 * one. Accepting and rejecting are a person's decisions, so agent tokens never reach them. Logs
 * and audit lines hold ids and counts only, never a quote or a proposed value.
 */
export interface FactSuggestionRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly store: FactSuggestionStore;
  /** Where the candidate-statement source is saved; accepting a change that cites it needs it. */
  readonly intake?: Pick<HostedKnowledgeIntake, "addFileSource" | "ensureStore">;
  readonly factUsage?: FactUsageService;
  readonly screening?: Pick<ContentScreeningHooks, "screenUpload">;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const profileParams = z.strictObject({
  workspaceId: identifierSchema,
  profileId: identifierSchema,
});
const suggestionParams = profileParams.extend({ suggestionId: factSuggestionIdSchema });

const listQuery = z.strictObject({
  status: z.enum(factSuggestionStatuses).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const suggestionListSchema = z
  .object({
    suggestions: z.array(factSuggestionSchema),
    pending: z.number().int().describe("Pending suggestions of the profile, whatever the filter."),
  })
  .meta({ id: "FactSuggestionList" });

const acceptBody = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: factSuggestionIdSchema,
        edit: factSuggestionChangeSchema
          .optional()
          .describe("The change as the person edited it; it keeps the suggestion's kind."),
      }),
    )
    .min(1)
    .max(maximumFactSuggestionBatch),
});

const acceptResultSchema = z
  .object({
    applied: z.array(z.string()),
    stale: z
      .array(z.string())
      .describe("Suggestions whose fact changed first; they were not applied."),
    profile: z
      .object({
        version: z.number().int(),
        status: z.enum(["draft", "reviewed"]),
      })
      .optional()
      .describe("The saved profile version, when an accepted change touched its facts."),
  })
  .meta({ id: "FactSuggestionAcceptResult" });

const errorResponses = {
  400: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  422: apiErrorSchema,
};

const statementMediaType = "text/markdown";

/** The person deciding: the signed-in member, or the owner on a single-owner deployment. */
function deciderOf(request: FastifyRequest): FactSuggestionDecider {
  const caller = request.caller;
  return { role: "candidate", memberId: caller?.kind === "member" ? caller.memberId : "owner" };
}

/** The knowledge base most of the profile's citations come from, where the statement belongs. */
function statementKnowledgeBase(
  record: CanonicalCandidateProfileVersionRecord,
): string | undefined {
  const counts = new Map<string, number>();
  for (const fact of record.profile.facts) {
    for (const reference of fact.provenance) {
      counts.set(reference.knowledgeBaseId, (counts.get(reference.knowledgeBaseId) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

class StatementUnavailableError extends Error {
  override readonly name = "StatementUnavailableError";
}

async function refused(reply: FastifyReply, error: unknown) {
  if (error instanceof FactSuggestionDecisionError) {
    const status =
      error.code === "suggestion_not_found" || error.code === "profile_not_found" ? 404 : 422;
    return reply.code(status).send(apiError(error.code, error.message));
  }
  if (error instanceof FactSuggestionStoreError && error.code === "suggestion_conflict") {
    return reply
      .code(409)
      .send(apiError("suggestion_conflict", "The suggestion was decided already."));
  }
  if (error instanceof StatementUnavailableError) {
    return reply.code(409).send(apiError("statement_unavailable", error.message));
  }
  throw error;
}

export function registerFactSuggestionRoutes(
  parent: FastifyInstance,
  options: FactSuggestionRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, store, intake, factUsage, screening } = options;

  const decisionsFor = (workspaceId: string, request: FastifyRequest) => {
    const root = workspaceRoot(workspaceId);
    return createFactSuggestionDecisions({
      store,
      profile: {
        latest: (profileId) => service.getCanonicalCandidateProfile({ root, profileId }),
        edit: (profileId, expectedVersion, patch) =>
          refusingProfileRules(
            service.editCanonicalCandidateProfile({ root, profileId, expectedVersion, patch }),
          ),
        review: (profileId, expectedVersion) =>
          refusingProfileRules(
            service.reviewCanonicalCandidateProfile({ root, profileId, expectedVersion }),
          ),
      },
      publishStatement: async ({ displayName, markdown }) => {
        const profileId = (request.params as { profileId: string }).profileId;
        const latest = await service.getCanonicalCandidateProfile({ root, profileId });
        const knowledgeBaseId = latest === undefined ? undefined : statementKnowledgeBase(latest);
        if (intake === undefined || knowledgeBaseId === undefined) {
          throw new StatementUnavailableError(
            "This profile has no career evidence to save the statement next to.",
          );
        }
        const bytes = new TextEncoder().encode(markdown);
        const added = await intake.addFileSource({
          knowledgeBaseId,
          displayName,
          mediaType: statementMediaType,
          bytes,
        });
        if (added.created && screening !== undefined) {
          await screening.screenUpload(request, {
            knowledgeBaseId,
            sourceId: added.source.id,
            sourceVersionId: added.latestVersion.id,
            name: added.source.displayName,
            mediaType: added.latestVersion.mediaType,
            bytes,
          });
        }
        const storeId = (await intake.ensureStore()).id;
        return {
          storeId,
          knowledgeBaseId: added.source.knowledgeBaseId,
          sourceId: added.source.id,
          versionId: added.latestVersion.id,
        } as unknown as CandidateStatementReference;
      },
      setFactUsage: async (key, level) => {
        if (factUsage === undefined) {
          throw new StatementUnavailableError("Usage levels are not available on this server.");
        }
        await factUsage.change(root, { kind: "fact", key, level });
      },
      audit: async (event) => {
        request.log.info(
          {
            workspaceId,
            profileId: event.profileId,
            suggestionIds: event.suggestionIds,
            deciderRole: event.deciderRole,
            applied: event.applied,
            stale: event.stale,
            ...(event.profileVersion === undefined ? {} : { profileVersion: event.profileVersion }),
          },
          `fact suggestions ${event.action}`,
        );
      },
    });
  };

  app.get(
    "/v1/workspaces/:workspaceId/profiles/:profileId/suggestions",
    {
      schema: {
        summary: "List a career profile's suggested updates",
        description:
          "Newest first. Each suggestion quotes what was said, who said it and where; pending ones wait for the person.",
        params: profileParams,
        querystring: listQuery,
        response: { 200: suggestionListSchema, ...errorResponses },
      },
    },
    async (request) => {
      const { workspaceId, profileId } = request.params;
      const { status, limit } = request.query;
      return {
        suggestions: [
          ...(await store.list(workspaceId, {
            profileId,
            limit,
            ...(status === undefined ? {} : { status }),
          })),
        ],
        pending: await store.countPending(workspaceId, profileId),
      };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/profiles/:profileId/suggestions/accept",
    {
      schema: {
        summary: "Accept suggested career profile updates",
        description:
          "Saves the quotes as a dated candidate-statement source and one new profile version whose changed facts cite it, with no model call. A reviewed profile stays reviewed. A suggestion whose fact changed first is marked stale instead. People only.",
        params: profileParams,
        body: acceptBody,
        response: { 200: acceptResultSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const { workspaceId, profileId } = request.params;
      try {
        const result = await decisionsFor(workspaceId, request).accept({
          workspaceId,
          profileId,
          items: request.body.items.map((item) => ({
            suggestionId: item.id,
            ...(item.edit === undefined ? {} : { edit: item.edit }),
          })),
          decider: deciderOf(request),
        });
        return {
          applied: [...result.applied],
          stale: [...result.stale],
          ...(result.profile === undefined
            ? {}
            : {
                profile: {
                  version: result.profile.profile.version,
                  status: result.profile.profile.status,
                },
              }),
        };
      } catch (error) {
        return refused(reply, error);
      }
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/profiles/:profileId/suggestions/:suggestionId/reject",
    {
      schema: {
        summary: "Reject a suggested career profile update",
        description: "Records the decision; the same change is not suggested again. People only.",
        params: suggestionParams,
        response: { 204: z.null(), ...errorResponses },
      },
    },
    async (request, reply) => {
      const { workspaceId, profileId, suggestionId } = request.params;
      try {
        await decisionsFor(workspaceId, request).reject({
          workspaceId,
          profileId,
          suggestionId,
          decider: deciderOf(request),
        });
        return reply.code(204).send(null);
      } catch (error) {
        return refused(reply, error);
      }
    },
  );
}
