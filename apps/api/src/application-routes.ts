import {
  type ApplicationService,
  type OpportunitySourceInput,
  type RunBudgetCeiling,
  runBudgetCeilingMessage,
  runBudgetCeilingViolation,
} from "@draft-loop/application";
import { applicationIdSchema } from "@draft-loop/schemas/application";
import { opportunityDraftPatchSchema } from "@draft-loop/schemas/opportunity-draft-patch";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema, RunQueueUnavailableError } from "./errors.js";
import type { IdempotencyStore } from "./idempotency.js";
import {
  applicationView,
  applicationViewSchema,
  opportunityView,
  opportunityViewSchema,
  runView,
  runViewSchema,
  workspaceView,
  workspaceViewSchema,
} from "./views.js";

export interface ApplicationRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly idempotency: IdempotencyStore;
  /**
   * Hands a begun run to the workers. It must be safe to repeat: a retried request queues the run
   * again, and the queue keeps at most one waiting job per run.
   */
  readonly enqueueRun: (workspaceId: string, runId: string) => Promise<void>;
  /** The deployment's limit per run; the workspace's budget is checked against it before a run. */
  readonly budgetCeiling: RunBudgetCeiling;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const workspaceParams = z.strictObject({ workspaceId: identifierSchema });
const opportunityParams = workspaceParams.extend({ briefId: identifierSchema });
const applicationParams = workspaceParams.extend({ applicationId: applicationIdSchema });
const runParams = workspaceParams.extend({ runId: identifierSchema });

/** Pasted job text and candidate instructions only: no server file paths, and no URL fetching yet. */
const maximumSourceCharacters = 64 * 1024;
const opportunitySourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: identifierSchema,
    kind: z.literal("pasted-content"),
    classification: z.enum(["job-posting", "social-announcement", "company-context"]),
    capturedAt: z.iso.datetime().optional(),
    content: z.string().min(1).max(maximumSourceCharacters),
  }),
  z.strictObject({
    id: identifierSchema,
    kind: z.literal("candidate-input"),
    classification: z.literal("candidate-instruction"),
    capturedAt: z.iso.datetime().optional(),
    content: z.string().min(1).max(maximumSourceCharacters),
    instructions: z
      .strictObject({
        tone: z.string().max(200).optional(),
        applicationGoal: z.string().max(2_000).optional(),
        forbiddenLanguage: z.array(z.string().max(200)).max(50).optional(),
        focusAreas: z.array(z.string().max(200)).max(50).optional(),
      })
      .optional(),
  }),
]);

type OpportunitySourceBody = z.infer<typeof opportunitySourceSchema>;

/** Zod marks absent optional fields `undefined`; the service's inputs leave them out. */
function toOpportunitySource(source: OpportunitySourceBody): OpportunitySourceInput {
  const capturedAt = source.capturedAt === undefined ? {} : { capturedAt: source.capturedAt };
  if (source.kind === "pasted-content") {
    const { id, kind, classification, content } = source;
    return { id, kind, classification, content, ...capturedAt };
  }
  const { id, kind, classification, content, instructions } = source;
  return {
    id,
    kind,
    classification,
    content,
    ...capturedAt,
    ...(instructions === undefined
      ? {}
      : {
          instructions: Object.fromEntries(
            Object.entries(instructions).filter(([, value]) => value !== undefined),
          ),
        }),
  };
}

const createOpportunityBody = z.strictObject({
  sources: z.array(opportunitySourceSchema).min(1).max(10),
  applicationId: applicationIdSchema.optional(),
});

const reviewOpportunityBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
});

const editOpportunityBody = z.strictObject({
  expectedVersion: z.number().int().positive(),
  patch: opportunityDraftPatchSchema,
});

const opportunityVersionsSchema = z
  .object({
    versions: z.array(
      z.object({
        version: z.number().int(),
        status: z.string(),
        createdAt: z.string(),
        reviewedAt: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: "OpportunityVersions" });

/** Zod marks absent optional fields `undefined`; the service's patch leaves them out. */
function definedFields<Value extends object>(
  value: Value,
): { [Key in keyof Value]?: Exclude<Value[Key], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as {
    [Key in keyof Value]?: Exclude<Value[Key], undefined>;
  };
}

const versionQuery = z.strictObject({ version: z.coerce.number().int().positive().optional() });

const modelProfileReference = z.strictObject({
  id: identifierSchema,
  version: z.number().int().positive(),
});

const beginRunBody = z.strictObject({
  applicationId: applicationIdSchema.optional(),
  opportunityBrief: z
    .strictObject({ briefId: identifierSchema, version: z.number().int().positive() })
    .optional(),
  modelProfiles: z
    .strictObject({ author: modelProfileReference, critic: modelProfileReference })
    .optional()
    .describe(
      "Exact author and critic profile versions bound to this run, such as a preset's pair; their models replace the workspace's for this run. Without them the run uses provider-default runtime controls and unknown context windows.",
    ),
});

const idempotencyHeaders = z.object({
  "idempotency-key": z
    .string()
    .regex(/^[A-Za-z0-9._:-]{8,128}$/u, "must be 8 to 128 safe characters"),
});

const notFound = (what: string) => apiError("not_found", `No such ${what}.`);

const errorResponses = { 400: apiErrorSchema, 404: apiErrorSchema, 422: apiErrorSchema };

/**
 * The first `/v1` resources: thin translations from HTTP to `ApplicationService` commands. The
 * service decides; these routes only validate, address the workspace and project the result.
 */
export function registerApplicationRoutes(
  parent: FastifyInstance,
  options: ApplicationRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, idempotency, enqueueRun, budgetCeiling } = options;

  app.get(
    "/v1/workspaces/:workspaceId",
    {
      schema: {
        summary: "Read a workspace's configuration",
        params: workspaceParams,
        response: { 200: workspaceViewSchema, ...errorResponses },
      },
    },
    async (request) =>
      workspaceView(await service.readWorkspace(workspaceRoot(request.params.workspaceId))),
  );

  app.post(
    "/v1/workspaces/:workspaceId/opportunities",
    {
      schema: {
        summary: "Create a job brief from pasted sources",
        params: workspaceParams,
        body: createOpportunityBody,
        response: { 201: opportunityViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const record = await service.createOpportunity({
        root: workspaceRoot(request.params.workspaceId),
        sources: request.body.sources.map(toOpportunitySource),
        ...(request.body.applicationId === undefined
          ? {}
          : { applicationId: request.body.applicationId }),
      });
      return reply.code(201).send(opportunityView(record));
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/opportunities/:briefId",
    {
      schema: {
        summary: "Read a job brief, latest or at one version",
        params: opportunityParams,
        querystring: versionQuery,
        response: { 200: opportunityViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const record = await service.getOpportunity({
        root: workspaceRoot(request.params.workspaceId),
        briefId: request.params.briefId,
        ...(request.query.version === undefined ? {} : { version: request.query.version }),
      });
      if (record === undefined) return reply.code(404).send(notFound("job brief"));
      return opportunityView(record);
    },
  );

  app.patch(
    "/v1/workspaces/:workspaceId/opportunities/:briefId",
    {
      schema: {
        summary: "Edit a job brief, saving a new draft version",
        description:
          "Replaces the patch's fields on the latest version and saves the result as a new draft. A stale expectedVersion answers 409, so an edit never overwrites one the client has not seen.",
        params: opportunityParams,
        body: editOpportunityBody,
        response: { 200: opportunityViewSchema, 409: apiErrorSchema, ...errorResponses },
      },
    },
    async (request) =>
      opportunityView(
        await service.editOpportunity({
          root: workspaceRoot(request.params.workspaceId),
          briefId: request.params.briefId,
          expectedVersion: request.body.expectedVersion,
          patch: definedFields(request.body.patch),
        }),
      ),
  );

  app.get(
    "/v1/workspaces/:workspaceId/opportunities/:briefId/versions",
    {
      schema: {
        summary: "List a job brief's versions, oldest first",
        params: opportunityParams,
        response: { 200: opportunityVersionsSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const records = await service.listOpportunityVersions({
        root: workspaceRoot(request.params.workspaceId),
        briefId: request.params.briefId,
      });
      if (records.length === 0) return reply.code(404).send(notFound("job brief"));
      return {
        versions: records.map(({ brief }) => ({
          version: brief.version,
          status: brief.status,
          createdAt: brief.createdAt,
          reviewedAt: brief.reviewedAt,
        })),
      };
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/opportunities/:briefId/review",
    {
      schema: {
        summary: "Mark a job brief version as reviewed",
        params: opportunityParams,
        body: reviewOpportunityBody,
        response: { 200: opportunityViewSchema, 409: apiErrorSchema, ...errorResponses },
      },
    },
    async (request) =>
      opportunityView(
        await service.reviewOpportunity({
          root: workspaceRoot(request.params.workspaceId),
          briefId: request.params.briefId,
          expectedVersion: request.body.expectedVersion,
        }),
      ),
  );

  app.get(
    "/v1/workspaces/:workspaceId/applications",
    {
      schema: {
        summary: "List a workspace's job applications, the default one first",
        params: workspaceParams,
        response: {
          200: z.object({ applications: z.array(applicationViewSchema) }),
          ...errorResponses,
        },
      },
    },
    async (request) => ({
      applications: (
        await service.listApplications({ root: workspaceRoot(request.params.workspaceId) })
      ).map(applicationView),
    }),
  );

  app.get(
    "/v1/workspaces/:workspaceId/applications/:applicationId",
    {
      schema: {
        summary: "Read one job application",
        params: applicationParams,
        response: { 200: applicationViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const view = await service.getApplication({
        root: workspaceRoot(request.params.workspaceId),
        applicationId: request.params.applicationId,
      });
      if (view === undefined) return reply.code(404).send(notFound("application"));
      return applicationView(view);
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/runs",
    {
      schema: {
        summary: "Begin a run; a worker executes it",
        description:
          "Persists the run and its context without calling a provider, then queues it for a worker. A retry with the same Idempotency-Key returns the same run and queues it again if it is not already waiting.",
        params: workspaceParams,
        headers: idempotencyHeaders,
        body: beginRunBody,
        response: {
          201: runViewSchema,
          409: apiErrorSchema,
          503: apiErrorSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId } = request.params;
      // The budget comes from the workspace's settings; one above the ceiling is refused, never
      // silently lowered, so the owner sees which limit to change.
      const workspace = await service.readWorkspace(workspaceRoot(workspaceId));
      const violation = runBudgetCeilingViolation(workspace, budgetCeiling);
      if (violation !== undefined) {
        return reply
          .code(422)
          .send(apiError("budget_above_ceiling", runBudgetCeilingMessage(violation)));
      }
      const command = {
        root: workspaceRoot(workspaceId),
        ...(request.body.applicationId === undefined
          ? {}
          : { applicationId: request.body.applicationId }),
        ...(request.body.opportunityBrief === undefined
          ? {}
          : { opportunityBrief: { ...request.body.opportunityBrief } }),
        ...(request.body.modelProfiles === undefined
          ? {}
          : {
              modelProfiles: {
                author: { ...request.body.modelProfiles.author },
                critic: { ...request.body.modelProfiles.critic },
              },
            }),
      };
      const snapshot = await idempotency.once(
        `runs:${workspaceId}`,
        request.headers["idempotency-key"],
        request.body,
        () => service.begin(command),
      );
      // Outside the replay cache on purpose: a run saved by a request whose queueing failed is
      // queued by the retry, and repeated queueing collapses in the queue.
      try {
        await enqueueRun(workspaceId, snapshot.runId);
      } catch (error) {
        throw new RunQueueUnavailableError({ cause: error });
      }
      return reply.code(201).send(runView(snapshot));
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/runs/:runId",
    {
      schema: {
        summary: "Read a run's state",
        params: runParams,
        response: { 200: runViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const snapshot = await service.status({
        root: workspaceRoot(request.params.workspaceId),
        runId: request.params.runId,
      });
      if (snapshot === undefined) return reply.code(404).send(notFound("run"));
      return runView(snapshot);
    },
  );
}
