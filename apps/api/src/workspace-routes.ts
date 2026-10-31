import {
  type ApplicationService,
  type HostedKnowledgeIntake,
  type InitializeWorkspaceCommand,
  type RunBudgetCeiling,
  runBudgetCeilingMessage,
  runBudgetCeilingViolation,
} from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";
import { hostedDefaultModelPair } from "./hosted-model-catalog.js";
import type { PlanLimits } from "./plan-limits.js";
import { workspaceView, workspaceViewSchema } from "./views.js";

export interface WorkspaceRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
  /** The deployment's limit per run; a new workspace's budget must fit inside it. */
  readonly budgetCeiling: RunBudgetCeiling;
  /** Holds new candidate records to the plan; absent in owner-token mode, where nothing is limited. */
  readonly planLimits?: PlanLimits;
  /** The models the deployment's local endpoint serves; none unless it declares them. */
  readonly localModels?: readonly string[];
  /** The tenant's knowledge; without it workspaces cannot select any. */
  readonly knowledge?: {
    readonly intake: HostedKnowledgeIntake;
    readonly store: KnowledgeStoreAddress;
  };
}

/** How the driver addresses the tenant's knowledge store; the API never takes one from a client. */
export interface KnowledgeStoreAddress {
  readonly id: string;
  readonly reference: string;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const workspaceParams = z.strictObject({ workspaceId: identifierSchema });

/**
 * The companies the server routes: `local` only for a model the deployment declares, on its own
 * endpoint. A workspace never names an endpoint.
 */
const hostedModelSchema = z.strictObject({
  company: z.enum(["anthropic", "openai", "local"]),
  model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u, "must be a model id"),
});

const createWorkspaceBody = z.strictObject({
  language: z.string().min(2).max(35).optional(),
  instructions: z.string().min(1).max(4_000).optional(),
  truthfulnessPolicy: z.string().min(1).max(4_000).optional(),
  author: hostedModelSchema.optional(),
  critic: hostedModelSchema.optional(),
  maxRounds: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
  maxDurationMs: z.number().int().positive().optional(),
  maxWords: z.number().int().positive().optional(),
  maxCharacters: z.number().int().positive().optional(),
  requiredSections: z.array(z.string().min(1).max(100)).min(1).max(20).optional(),
  fixtureMode: z.boolean().optional(),
  autopilot: z.boolean().optional(),
});

type CreateWorkspaceBody = z.infer<typeof createWorkspaceBody>;

/** The domain's limit for a reason to accept one lineage on both sides. */
const maximumIndependenceRationaleCharacters = 500;

const changeModelsBody = z.strictObject({
  author: hostedModelSchema,
  critic: hostedModelSchema,
  independenceOverrideRationale: z
    .string()
    .trim()
    .min(1)
    .max(maximumIndependenceRationaleCharacters)
    .optional()
    .describe("Required only when the author and critic descend from the same weights."),
});

const autopilotBody = z.strictObject({ enabled: z.boolean() });

/** The run limits a workspace gives its next runs; one left out falls back to the ceiling. */
const runBudgetBody = z.strictObject({
  maxRounds: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
  maxDurationMs: z.number().int().positive().optional(),
});

const knowledgeSelectionBody = z
  .strictObject({
    knowledgeBaseIds: z
      .array(identifierSchema)
      .min(1)
      .max(10)
      .refine((ids) => new Set(ids).size === ids.length, "must not repeat a knowledge base"),
    combinationApproved: z
      .boolean()
      .optional()
      .describe("Required to combine several knowledge bases in one workspace's runs."),
  })
  .refine(
    (body) => body.knowledgeBaseIds.length === 1 || body.combinationApproved === true,
    "combining several knowledge bases needs combinationApproved",
  );

/**
 * The hosted round limit when the request sets none. Two rounds matched the local three-round
 * draft in hosted parity at lower cost, so the hosted default is lower than the local one.
 */
const defaultMaxRounds = 2;

/**
 * A hosted workspace has no job file or source folder: job briefs and knowledge come through the
 * API. The driver still records the two settings, so they are fixed names that address nothing.
 * A side the request leaves out gets the hosted default preset's model, not the desktop's.
 */
function initializeCommand(root: string, body: CreateWorkspaceBody): InitializeWorkspaceCommand {
  const defaults = hostedDefaultModelPair();
  const { author = defaults.author, critic = defaults.critic, ...settings } = body;
  return {
    root,
    jobDescription: "job.md",
    sources: "sources",
    maxRounds: defaultMaxRounds,
    // A hosted run revises through the critic's blocking findings up to its round limit, as the
    // round limit promises, and still pauses for a disputed claim (#1969).
    autopilot: true,
    ...Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)),
    authorCompany: author.company,
    authorModel: author.model,
    criticCompany: critic.company,
    criticModel: critic.model,
  };
}

/** The side naming a local model the deployment does not serve, if any. */
function undeclaredLocalModel(
  sides: readonly (z.infer<typeof hostedModelSchema> | undefined)[],
  localModels: readonly string[],
): string | undefined {
  return sides.find((side) => side?.company === "local" && !localModels.includes(side.model))
    ?.model;
}

const localModelRefusal = (model: string) =>
  apiError(
    "model_not_offered",
    `This service has no local model named ${model}; choose one from GET /v1/model-catalog.`,
  );

async function workspaceExists(service: ApplicationService, root: string): Promise<boolean> {
  try {
    await service.readWorkspace(root);
    return true;
  } catch {
    return false;
  }
}

const silent = { write: () => undefined };

/** Workspace setup: the owner creates a hosted workspace before adding knowledge and briefs. */
export function registerWorkspaceRoutes(
  parent: FastifyInstance,
  options: WorkspaceRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, budgetCeiling } = options;
  const localModels = options.localModels ?? [];

  app.put(
    "/v1/workspaces/:workspaceId",
    {
      schema: {
        summary: "Create a workspace",
        description:
          "Creates the workspace with its language, models, run limits and execution mode. Anthropic and OpenAI models are routed, and local models only where the deployment lists them in `GET /v1/model-catalog` (else 422 model_not_offered); a side left out gets the default preset of `GET /v1/model-catalog` (Claude Sonnet as the author). An existing workspace is never overwritten: creating it again answers 409. In sign-in mode each workspace is a candidate record and takes one of the plan's record slots: 409 plan_limit_reached (limit candidateRecords) when none is left, 403 plan_required when the organisation has no plan.",
        params: workspaceParams,
        body: createWorkspaceBody,
        response: {
          201: workspaceViewSchema,
          400: apiErrorSchema,
          403: apiErrorSchema,
          409: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const root = workspaceRoot(request.params.workspaceId);
      const { body } = request;
      const undeclared = undeclaredLocalModel([body.author, body.critic], localModels);
      if (undeclared !== undefined) return reply.code(422).send(localModelRefusal(undeclared));
      // Checked before anything is saved, so a workspace never exists that cannot begin a run.
      const violation = runBudgetCeilingViolation(
        {
          maxRounds: body.maxRounds ?? defaultMaxRounds,
          maxCostUsd: body.maxCostUsd ?? budgetCeiling.maxCostUsd,
          maxDurationMs: body.maxDurationMs ?? budgetCeiling.maxDurationMs,
        },
        budgetCeiling,
      );
      if (violation !== undefined) {
        return reply
          .code(422)
          .send(apiError("budget_above_ceiling", runBudgetCeilingMessage(violation)));
      }
      if (await workspaceExists(service, root)) {
        return reply
          .code(409)
          .send(apiError("workspace_exists", "A workspace with this id already exists."));
      }
      const { caller } = request;
      if (caller?.kind === "member") await options.planLimits?.requireRecordRoom(caller.tenantId);
      const descriptor = await service.initialize(initializeCommand(root, body), silent);
      return reply.code(201).send(workspaceView(request.params.workspaceId, descriptor));
    },
  );

  app.patch(
    "/v1/workspaces/:workspaceId/models",
    {
      schema: {
        summary: "Change a workspace's author and critic models",
        description:
          "Applies from the next run; recorded runs keep the pair they ran with. Anthropic and OpenAI models are routed, and local models only where the deployment lists them (else 422 model_not_offered). A pair from one lineage answers 422 unless a reason is given, and a change while a run is executing answers 422.",
        params: workspaceParams,
        body: changeModelsBody,
        response: {
          200: workspaceViewSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const root = workspaceRoot(request.params.workspaceId);
      if (!(await workspaceExists(service, root))) {
        return reply.code(404).send(apiError("not_found", "No such workspace."));
      }
      const { author, critic, independenceOverrideRationale } = request.body;
      const undeclared = undeclaredLocalModel([author, critic], localModels);
      if (undeclared !== undefined) return reply.code(422).send(localModelRefusal(undeclared));
      const descriptor = await service.reconfigureModels(
        {
          root,
          authorCompany: author.company,
          authorModel: author.model,
          criticCompany: critic.company,
          criticModel: critic.model,
          ...(independenceOverrideRationale === undefined ? {} : { independenceOverrideRationale }),
        },
        silent,
      );
      return workspaceView(request.params.workspaceId, descriptor);
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/autopilot",
    {
      schema: {
        summary: "Turn a workspace's autopilot on or off",
        description:
          "With autopilot on, a run keeps revising through the critic's blocking findings up to its round limit and pauses early only when the draft is ready, a claim is disputed or a finding says the draft contradicts the candidate's materials. Applies from the next run action.",
        params: workspaceParams,
        body: autopilotBody,
        response: { 200: workspaceViewSchema, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const root = workspaceRoot(request.params.workspaceId);
      if (!(await workspaceExists(service, root))) {
        return reply.code(404).send(apiError("not_found", "No such workspace."));
      }
      const descriptor = await service.configureAutopilot?.(
        { root, enabled: request.body.enabled },
        silent,
      );
      if (descriptor === undefined) {
        return reply.code(404).send(apiError("not_found", "No such workspace."));
      }
      return workspaceView(request.params.workspaceId, descriptor);
    },
  );

  app.put(
    "/v1/workspaces/:workspaceId/budget",
    {
      schema: {
        summary: "Replace a workspace's run budget",
        description:
          "Sets the round, cost and duration limits the workspace's next runs get, checked against the deployment's ceiling like creation (422 budget_above_ceiling). A limit left out falls back to the ceiling. Use it when the deployment's ceiling drops below a budget the workspace stored at creation, which would otherwise refuse every new run. Recorded runs keep the budget they ran with.",
        params: workspaceParams,
        body: runBudgetBody,
        response: {
          200: workspaceViewSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const root = workspaceRoot(request.params.workspaceId);
      const { body } = request;
      const budget = {
        maxRounds: body.maxRounds ?? defaultMaxRounds,
        maxCostUsd: body.maxCostUsd ?? budgetCeiling.maxCostUsd,
        maxDurationMs: body.maxDurationMs ?? budgetCeiling.maxDurationMs,
      };
      const violation = runBudgetCeilingViolation(budget, budgetCeiling);
      if (violation !== undefined) {
        return reply
          .code(422)
          .send(apiError("budget_above_ceiling", runBudgetCeilingMessage(violation)));
      }
      if (!(await workspaceExists(service, root))) {
        return reply.code(404).send(apiError("not_found", "No such workspace."));
      }
      const descriptor = await service.configureRunBudget?.({ root, ...budget }, silent);
      if (descriptor === undefined) {
        return reply.code(404).send(apiError("not_found", "No such workspace."));
      }
      return workspaceView(request.params.workspaceId, descriptor);
    },
  );

  const { knowledge } = options;
  if (knowledge === undefined) return;

  app.put(
    "/v1/workspaces/:workspaceId/knowledge-selection",
    {
      schema: {
        summary: "Select the knowledge bases a workspace's runs use",
        description:
          "Replaces the selection; it applies from the next run. Each knowledge base must be ready: active, with at least one source and every source's file held. A base without a source answers 422 `knowledge_base_empty`.",
        params: workspaceParams,
        body: knowledgeSelectionBody,
        response: {
          200: workspaceViewSchema,
          400: apiErrorSchema,
          404: apiErrorSchema,
          422: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { knowledgeBaseIds, combinationApproved } = request.body;
      const known = new Set((await knowledge.intake.listKnowledgeBases()).map(({ id }) => id));
      if (knowledgeBaseIds.some((id) => !known.has(id))) {
        return reply
          .code(404)
          .send(apiError("knowledge_base_not_found", "No such knowledge base."));
      }
      for (const knowledgeBaseId of knowledgeBaseIds) {
        if ((await knowledge.intake.listSources(knowledgeBaseId)).length === 0) {
          return reply
            .code(422)
            .send(
              apiError(
                "knowledge_base_empty",
                "Add a source to the knowledge base before selecting it.",
              ),
            );
        }
      }
      const descriptor = await service.configureKnowledgeSelection(
        {
          root: workspaceRoot(request.params.workspaceId),
          entries: knowledgeBaseIds.map((knowledgeBaseId) => ({
            storeRoot: knowledge.store.reference,
            storeId: knowledge.store.id,
            knowledgeBaseId,
          })),
          ...(combinationApproved === true ? { combinationApproved } : {}),
        },
        silent,
      );
      return workspaceView(request.params.workspaceId, descriptor);
    },
  );
}
