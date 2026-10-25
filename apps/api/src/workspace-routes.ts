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

/** The companies the model gateway routes; local models and their endpoints are desktop-only. */
const hostedModelSchema = z.strictObject({
  company: z.enum(["anthropic", "openai"]),
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
    ...Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)),
    authorCompany: author.company,
    authorModel: author.model,
    criticCompany: critic.company,
    criticModel: critic.model,
  };
}

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

  app.put(
    "/v1/workspaces/:workspaceId",
    {
      schema: {
        summary: "Create a workspace",
        description:
          "Creates the workspace with its language, models, run limits and execution mode. Only Anthropic and OpenAI models are routed by the hosted service; a side left out gets the default preset of `GET /v1/model-catalog` (Claude Sonnet as the author). An existing workspace is never overwritten: creating it again answers 409. In sign-in mode each workspace is a candidate record and takes one of the plan's record slots: 409 plan_limit_reached (limit candidateRecords) when none is left, 403 plan_required when the organisation has no plan.",
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
      return reply.code(201).send(workspaceView(descriptor));
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
          "Replaces the selection; it applies from the next run. Each knowledge base must be ready: active, with every source's file held.",
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
      return workspaceView(descriptor);
    },
  );
}
