import type { ApplicationService, RunReview } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import { runView, runViewSchema } from "./views.js";

export interface ReviewRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");
const runParams = z.strictObject({ workspaceId: identifierSchema, runId: identifierSchema });

const findingDecisionSchema = z.enum(["pending", "accepted", "rejected", "deferred", "overridden"]);

const reviewDraftSchema = z
  .object({
    id: z.string(),
    version: z.number().int(),
    createdAt: z.string(),
    sections: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        kind: z.string(),
        blocks: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            text: z.string().describe("The candidate's latest edit when edited, else the draft's."),
            edited: z.boolean(),
            claimIds: z.array(z.string()),
          }),
        ),
      }),
    ),
    claims: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        status: z.string(),
        substantive: z.boolean(),
        evidence: z.array(
          z.object({ sourcePath: z.string(), locator: z.string().optional(), excerpt: z.string() }),
        ),
      }),
    ),
  })
  .meta({ id: "ReviewDraft" });

const reviewFindingSchema = z
  .object({
    id: z.string().describe("The id a finding decision names; scoped to the reviewed draft."),
    code: z.string(),
    category: z.string(),
    severity: z.string(),
    message: z.string(),
    decision: findingDecisionSchema,
    claimId: z.string().optional(),
    sectionId: z.string().optional(),
    requirement: z.object({ id: z.string(), text: z.string().optional() }).optional(),
  })
  .meta({ id: "ReviewFinding" });

export const runReviewSchema = z
  .object({
    run: runViewSchema,
    draft: reviewDraftSchema.nullable().describe("Null until the author has drafted."),
    findings: z.array(reviewFindingSchema),
    independentReview: z
      .object({
        authorLineage: z.string(),
        criticLineage: z.string(),
        lineagesDistinct: z.boolean(),
        required: z.boolean(),
        overrideRationale: z.string().optional(),
      })
      .nullable(),
    readiness: z
      .object({
        status: z.string(),
        ready: z.boolean(),
        stopReason: z.string(),
        scores: z.array(
          z.object({
            dimension: z.string(),
            score: z.number(),
            threshold: z.number(),
            meets: z.boolean(),
          }),
        ),
      })
      .nullable()
      .describe("The latest round's readiness evaluation; null before the first critique."),
    approvalCheck: z
      .object({ applicationReady: z.boolean(), blockers: z.array(z.string()) })
      .nullable()
      .describe("What the last approval attempt found; approving past blockers needs a rationale."),
    candidateDirection: z.string().nullable(),
  })
  .meta({ id: "RunReview" });

export function runReviewView(review: RunReview): z.infer<typeof runReviewSchema> {
  const { snapshot, ...rest } = review;
  // The review's arrays are readonly; the response schema still checks every field it sends.
  return { run: runView(snapshot), ...rest } as z.infer<typeof runReviewSchema>;
}

const notFound = (what: string) => apiError("not_found", `No such ${what}.`);
const errorResponses = { 400: apiErrorSchema, 404: apiErrorSchema, 422: apiErrorSchema };

/**
 * The review of a hosted run (ADR 0011, D9): what the person reads before deciding findings and
 * approving. The service builds the review; these routes only address the run and project it.
 */
export function registerReviewRoutes(parent: FastifyInstance, options: ReviewRoutesOptions): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot } = options;

  app.get(
    "/v1/workspaces/:workspaceId/runs/:runId/review",
    {
      schema: {
        summary: "Read a run's review: the draft, its findings and its readiness",
        params: runParams,
        response: { 200: runReviewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const review = await service.readRunReview?.({
        root: workspaceRoot(request.params.workspaceId),
        runId: request.params.runId,
      });
      if (review === undefined) return reply.code(404).send(notFound("run"));
      return runReviewView(review);
    },
  );
}
