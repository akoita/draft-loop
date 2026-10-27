import {
  type ApplicationService,
  type OpportunitySourceInput,
  type RunBudgetCeiling,
  runBudgetCeilingMessage,
  runBudgetCeilingViolation,
} from "@draft-loop/application";
import type { UrlFetcher } from "@draft-loop/ingestion";
import { applicationIdSchema } from "@draft-loop/schemas/application";
import { opportunityDraftPatchSchema } from "@draft-loop/schemas/opportunity-draft-patch";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { type BriefExtractions, queueLiveBriefExtraction } from "./brief-extraction.js";
import type { ContentScreeningHooks } from "./content-screening-routes.js";
import type { EntitlementGate } from "./entitlement-gate.js";
import { apiError, apiErrorSchema, RunQueueUnavailableError } from "./errors.js";
import type { IdempotencyStore } from "./idempotency.js";
import {
  assertApprovedJobPage,
  fetchApprovedJobPage,
  jobPageFetch,
  keepJobPage,
  screenedSources,
} from "./job-page-brief.js";
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
  /** Injection screening of a brief's sources, and the run gate on quarantined material. */
  readonly screening?: Pick<ContentScreeningHooks, "screenOpportunity" | "assertRunMaterialClear">;
  /**
   * Sign-in mode's plan and credit gate on starting a run; absent in owner-token mode, where
   * nothing is refused or metered.
   */
  readonly entitlementGate?: EntitlementGate;
  /** The worker's extraction of live briefs; without it a live brief is left for the person. */
  readonly briefExtractions?: BriefExtractions;
  /** Replaces the pinned job page fetcher, for tests; it must keep the same address checks. */
  readonly jobPageFetcher?: UrlFetcher;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const workspaceParams = z.strictObject({ workspaceId: identifierSchema });
const opportunityParams = workspaceParams.extend({ briefId: identifierSchema });
const applicationParams = workspaceParams.extend({ applicationId: applicationIdSchema });
const runParams = workspaceParams.extend({ runId: identifierSchema });

/**
 * Pasted job text, candidate instructions, and the application's approved job page: never a server
 * file path, and never a page the application was not created with.
 */
const maximumSourceCharacters = 64 * 1024;
const opportunitySourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: identifierSchema,
    kind: z.literal("approved-url"),
    classification: z.literal("job-posting"),
    capturedAt: z.iso.datetime().optional(),
    url: z.url({ protocol: /^https$/u }),
    approved: z
      .literal(true)
      .describe("The approval recorded with the application; the page is fetched once, now."),
  }),
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
  if (source.kind === "approved-url") {
    const { id, kind, classification, url, approved } = source;
    return { id, kind, classification, url, approved, ...capturedAt };
  }
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
  candidateProfile: z
    .strictObject({ profileId: identifierSchema, version: z.number().int().positive() })
    .optional()
    .describe(
      "A reviewed career profile version bound to this run, as the shared screens choose it. It must be bound to the workspace's current knowledge selection.",
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
  const { service, workspaceRoot, idempotency, enqueueRun, budgetCeiling, screening } = options;
  const { entitlementGate, briefExtractions, jobPageFetcher } = options;

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
      workspaceView(
        request.params.workspaceId,
        await service.readWorkspace(workspaceRoot(request.params.workspaceId)),
      ),
  );

  app.post(
    "/v1/workspaces/:workspaceId/opportunities",
    {
      schema: {
        summary: "Create a job brief from pasted sources",
        description:
          "Saves the brief, then screens each source for prompt injection. The answer's screening shows each source's verdict and signal codes, never a quote; a flagged or unscreened source is quarantined and a run on the brief is refused (409 material_quarantined) until an owner or admin releases it. Absent when screening is off. In a live workspace, a brief made from an application's job text is saved without extraction; once screening clears that text, the worker extracts it and saves the next draft version, and the answer's extraction says pending.",
        params: workspaceParams,
        body: createOpportunityBody,
        response: { 201: opportunityViewSchema, ...errorResponses },
      },
    },
    async (request, reply) => {
      const sources = request.body.sources.map(toOpportunitySource);
      const { applicationId } = request.body;
      const root = workspaceRoot(request.params.workspaceId);
      // The application's approved job page is fetched once, now, and only that page (#1812).
      const fetchesPage = await assertApprovedJobPage({ service, root, applicationId, sources });
      const pageFetch = jobPageFetch(jobPageFetcher);
      if (fetchesPage) await fetchApprovedJobPage(pageFetch, sources, request.log);
      const record = await service.createOpportunity({
        root,
        sources,
        ...(applicationId === undefined ? {} : { applicationId }),
        ...(fetchesPage ? { ingestUrl: pageFetch.ingest } : {}),
      });
      const page = pageFetch.page();
      if (page !== undefined && applicationId !== undefined) {
        // Kept before the extraction is queued, so the worker reads the text of this one fetch.
        await keepJobPage(service, { root, applicationId, page });
      }
      // After the brief is saved, so its source ids exist; a screener's failure is the result's
      // verdict, never this request's.
      const screened = await screening?.screenOpportunity(
        request,
        record,
        screenedSources(sources, page),
      );
      const extraction =
        briefExtractions === undefined
          ? undefined
          : await queueLiveBriefExtraction({
              extractions: briefExtractions,
              workspaceId: request.params.workspaceId,
              workspace: await service.readWorkspace(workspaceRoot(request.params.workspaceId)),
              applicationId,
              record,
              screening: screened,
              log: request.log,
            });
      return reply.code(201).send({
        ...opportunityView(record),
        ...(screened === undefined ? {} : { screening: screened }),
        ...(extraction === undefined ? {} : { extraction }),
      });
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
      const extraction = await briefExtractions?.state({
        workspaceId: request.params.workspaceId,
        briefId: record.brief.id,
        version: record.brief.version,
      });
      return { ...opportunityView(record), ...(extraction === undefined ? {} : { extraction }) };
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
          "Persists the run and its context without calling a provider, then queues it for a worker. A retry with the same Idempotency-Key returns the same run and queues it again if it is not already waiting. In sign-in mode the candidate record needs a current provider transmission consent naming every provider the workspace's models use (409 transmission_consent_required). A run on a brief whose job source, or on a knowledge source the workspace selects, is quarantined by injection screening and not released answers 409 material_quarantined and lists the stored results to release. With screening on, a run on material that has no stored screening result, such as a brief saved while screening was off or whose result failed to save, answers 409 material_unscreened and lists the brief sources and knowledge source versions to screen by ids only; save the brief again or upload the file again to screen it. In sign-in mode the organisation's plan then has to allow the run: 403 plan_required without a plan, 422 model_tier_unknown when a model's tier cannot be determined, 403 model_tier_not_in_plan (with role and tier) for a tier the plan lacks, 429 run_cap_reached (with cap and limit) at the plan's concurrent or daily run cap, and 402 credits_insufficient (with estimate and remaining) when the balance does not cover the run's estimate. The estimate is reserved before the run is saved; a retry with the same Idempotency-Key reserves nothing more, and a run that cannot be saved gives its credits back.",
        params: workspaceParams,
        headers: idempotencyHeaders,
        body: beginRunBody,
        response: {
          201: runViewSchema,
          402: apiErrorSchema,
          403: apiErrorSchema,
          409: apiErrorSchema,
          429: apiErrorSchema,
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
      await screening?.assertRunMaterialClear({
        workspaceId,
        workspace,
        opportunityBrief: request.body.opportunityBrief,
      });
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
        ...(request.body.candidateProfile === undefined
          ? {}
          : { candidateProfile: { ...request.body.candidateProfile } }),
      };
      const snapshot = await idempotency.once(
        `runs:${workspaceId}`,
        request.headers["idempotency-key"],
        request.body,
        () =>
          request.caller?.kind === "member" && entitlementGate !== undefined
            ? // Inside the key's one execution, so a replay never reserves again.
              entitlementGate.begin(
                {
                  tenantId: request.caller.tenantId,
                  root: command.root,
                  workspace,
                  applicationId: request.body.applicationId,
                  modelProfiles: command.modelProfiles,
                },
                request.log,
                (runId) => service.begin({ ...command, runId }),
              )
            : service.begin(command),
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
