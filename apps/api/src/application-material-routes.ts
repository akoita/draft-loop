import { randomBytes } from "node:crypto";

import { type ApplicationService, catalogModelPricing } from "@draft-loop/application";
import {
  ApplicationMaterialError,
  type ApplicationMaterialFact,
  type ApplicationMaterialRequirement,
  applicationMaterialKinds,
  boundedApplicationMaterialGuidance,
  draftApplicationMaterial,
} from "@draft-loop/application/application-material";
import {
  applicationMaterialDefaultModelId,
  applicationMaterialEconomyModelId,
  applicationMaterialPromptVersion,
  createModelApplicationMaterialWriter,
} from "@draft-loop/application/application-material-model";
import { guardCallCost } from "@draft-loop/application/call-cost-guard";
import type { FactUsageService } from "@draft-loop/application/fact-usage";
import { writingTells } from "@draft-loop/application/writing-tells";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import { CallCostBudgetError } from "@draft-loop/orchestrator";
import { applicationIdSchema } from "@draft-loop/schemas/application";
import {
  applicationMaterialGuidanceSchema,
  type SavedApplicationMaterial,
  savedApplicationMaterialIdSchema,
} from "@draft-loop/schemas/saved-application-material";
import {
  type ConsentLedger,
  type ConsentState,
  permitsTransmission,
} from "@draft-loop/storage/consent-ledger";
import {
  type SavedApplicationMaterialStore,
  savedApplicationMaterialListLimit,
} from "@draft-loop/storage/saved-application-material";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { consentRecordId } from "./consent-routes.js";
import type { ContentScreeningHooks } from "./content-screening-routes.js";
import { apiError, apiErrorSchema } from "./errors.js";

/** What drafting application material needs from a deployment (#2216). */
export interface ApplicationMaterialParts {
  /** The API's Claude route, present with `rules+model` screening; without it the route answers 503. */
  readonly route?: AnthropicRouteBuilder | undefined;
  /** The deployment's ceiling on sending candidate material to a provider. */
  readonly allowProviderData: boolean;
  /** The most one request may spend across its attempts, in US dollars. */
  readonly maxCostUsd?: number;
}

export interface ApplicationMaterialRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly material: ApplicationMaterialParts;
  readonly consents?: ConsentLedger;
  readonly screening?: Pick<ContentScreeningHooks, "assertRunMaterialClear">;
  /** Where each fact may be used (#2260); without it every fact may be used, as before. */
  readonly factUsage?: Pick<FactUsageService, "read">;
  /** Where drafts are kept (#2477); without it a draft is returned and not stored, as before. */
  readonly drafts?: SavedApplicationMaterialStore;
  /** The clock a saved draft's time comes from; the system clock by default. */
  readonly now?: () => Date;
}

/** The default cap on one request: two Sonnet calls with a full context stay well below it. */
export const defaultApplicationMaterialMaxCostUsd = 0.5;

const params = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
  applicationId: applicationIdSchema,
});

/** The models that may write application material: the default first, then the economy one. */
export const applicationMaterialModelIds = [
  applicationMaterialDefaultModelId,
  applicationMaterialEconomyModelId,
] as const;

/** A typical draft's tokens, for the estimate the panel shows beside each model. */
const typicalDraftTokens = { input: 6_000, output: 2_000 } as const;

const body = z
  .strictObject({
    kind: z.enum(applicationMaterialKinds),
    model: z
      .enum(applicationMaterialModelIds)
      .optional()
      .describe("The model that writes the draft; the default model when absent."),
    guidance: applicationMaterialGuidanceSchema
      .optional()
      .describe(
        "The candidate's guidance on emphasis, tone, length and addressee; it steers the writing and is never cited as a fact.",
      ),
  })
  .meta({ id: "ApplicationMaterialRequest" });

const draftView = z
  .object({
    id: savedApplicationMaterialIdSchema
      .optional()
      .describe("The saved draft's id; absent when this server keeps no drafts."),
    created_at: z.string().optional().describe("When the draft was written and saved."),
    kind: z.enum(applicationMaterialKinds),
    guidance: applicationMaterialGuidanceSchema
      .optional()
      .describe("The guidance the draft was written with, as the model received it."),
    items: z.array(
      z.object({
        question: z
          .string()
          .describe("Empty for a cover letter paragraph; the interview question otherwise."),
        text: z.string().describe("The paragraph, or the talking point for the question."),
        citations: z
          .array(z.object({ fact_id: z.string(), text: z.string() }))
          .describe("The career record facts the item relies on, as the candidate stored them."),
      }),
    ),
    model: z.object({ provider: z.string(), model: z.string() }),
    tells: z
      .array(
        z.object({
          code: z.enum([
            "stock_phrase",
            "heavy_dashes",
            "list_of_three",
            "mirrored_openings",
            "word_count",
          ]),
          paragraph: z.number().int().optional(),
          sentence: z.string().optional(),
          match: z.string().optional(),
        }),
      )
      .optional()
      .describe(
        "For a cover letter: sentences with machine-writing tells, from a deterministic check. Not an AI detector.",
      ),
    prompt_version: z.string(),
    cost_usd: z.number().describe("The provider cost recorded for this draft's calls."),
  })
  .meta({ id: "ApplicationMaterialDraft" });

const draftList = z
  .strictObject({
    drafts: z
      .array(draftView)
      .describe(
        `The application's saved drafts, newest first, at most ${savedApplicationMaterialListLimit}.`,
      ),
  })
  .meta({ id: "ApplicationMaterialDraftList" });

const listQuery = z.strictObject({ kind: z.enum(applicationMaterialKinds).optional() });

const draftParams = params.extend({ materialId: savedApplicationMaterialIdSchema });

/** A saved draft as the API shows it: its stored fields without the workspace and application. */
function viewOf(draft: SavedApplicationMaterial): z.infer<typeof draftView> {
  const { workspace_id: _workspace, application_id: _application, ...view } = draft;
  return withTells(view);
}

/** A cover letter's view with its machine-writing tells, computed on read and never stored. */
function withTells<View extends Pick<z.infer<typeof draftView>, "kind" | "items">>(
  view: View,
): View & { tells?: ReturnType<typeof writingTells> } {
  if (view.kind !== "cover-letter") return view;
  return { ...view, tells: writingTells(view.items.map((item) => item.text)) };
}

function newMaterialId(): string {
  return `amd_${randomBytes(12).toString("base64url")}`;
}

const errors = {
  400: apiErrorSchema,
  403: apiErrorSchema,
  404: apiErrorSchema,
  409: apiErrorSchema,
  422: apiErrorSchema,
  502: apiErrorSchema,
  503: apiErrorSchema,
} as const;

function permitsAnthropic(state: ConsentState): boolean {
  return permitsTransmission(state, {
    author: { company: "anthropic" },
    critic: { company: "anthropic" },
  });
}

/** The newest career profile's facts, which were extracted under the sensitivity tiers. */
async function careerFacts(
  service: ApplicationService,
  root: string,
): Promise<ApplicationMaterialFact[]> {
  const profiles = await service.listCanonicalCandidateProfileVersions({ root });
  const newest = [...profiles].sort((left, right) =>
    right.profile.updatedAt.localeCompare(left.profile.updatedAt),
  )[0];
  return (newest?.profile.facts ?? []).map((fact) => ({
    id: fact.id,
    category: fact.category,
    ...(fact.subjectId === undefined ? {} : { subjectId: fact.subjectId }),
    field: fact.field,
    value: fact.value,
  }));
}

/**
 * Drafts a cover letter or interview questions for one application (#2216), under the career
 * interview's rules: the record's consent names Anthropic, the job's text passed screening, the
 * deployment has a Claude route, and a cost guard caps and records the spend. With a draft store
 * the draft is saved as a new version (#2477) and can be listed and deleted. Logs carry ids, kinds,
 * models and costs, never the draft.
 */
export function registerApplicationMaterialRoutes(
  parent: FastifyInstance,
  options: ApplicationMaterialRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, material, consents, screening, drafts } = options;
  const now = options.now ?? (() => new Date());
  const selectionOf = (modelId: (typeof applicationMaterialModelIds)[number]) =>
    ({
      company: "anthropic",
      modelId,
      role: "author",
      promptTemplateVersion: applicationMaterialPromptVersion,
    }) as const;
  const maxCostUsd = material.maxCostUsd ?? defaultApplicationMaterialMaxCostUsd;

  app.post(
    "/v1/workspaces/:workspaceId/applications/:applicationId/material",
    {
      schema: {
        summary: "Draft a cover letter or interview questions for an application",
        description:
          "Drafts from the career record's facts (identity and contact withheld) and the application's newest brief requirements, and returns the draft with each item's citations. A server that keeps drafts saves it as a new version and returns its id; nothing is saved when drafting fails. Needs the record's consent to send career material to Anthropic (403 consent_required) and a server Claude route (503 material_model_unavailable). A brief whose job source is quarantined or unscreened answers 409 material_quarantined or material_unscreened, as a run would. 409 no_citable_facts when the record holds no fact to cite, 422 invalid_draft when the model's draft breaks the citation rules twice, 409 cost_cap_reached when the next call could pass the request's cost cap, and 502 material_model_failed when the model's answer cannot be used, such as one cut off at its output limit.",
        params,
        body,
        response: { 200: draftView, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      const root = workspaceRoot(workspaceId);
      const workspace = await service.readWorkspace(root);
      const application = await service.getApplication({ root, applicationId });
      if (application === undefined) {
        return reply.code(404).send(apiError("not_found", "There is no such application."));
      }
      if (material.route === undefined || !material.allowProviderData) {
        return reply
          .code(503)
          .send(
            apiError(
              "material_model_unavailable",
              "This server has no model route for drafting application material.",
            ),
          );
      }
      const recordId = await consentRecordId(service, workspaceRoot, workspaceId);
      if (consents === undefined || !permitsAnthropic(await consents.current(recordId))) {
        return reply
          .code(403)
          .send(
            apiError(
              "consent_required",
              "Allow sending career material to Anthropic in this record's consent to draft application material.",
            ),
          );
      }
      const brief = application.briefs.at(-1);
      if (brief !== undefined) {
        await screening?.assertRunMaterialClear({
          workspaceId,
          workspace,
          opportunityBrief: { briefId: brief.briefId, version: brief.latestVersion },
        });
      }
      const opportunity =
        brief === undefined
          ? undefined
          : await service.getOpportunity({ root, briefId: brief.briefId });
      const requirements: ApplicationMaterialRequirement[] = (
        opportunity?.brief.requirements ?? []
      ).map((requirement) => ({
        id: requirement.id,
        text: requirement.text,
        priority: requirement.priority,
      }));
      const facts = await careerFacts(service, root);
      const usage = await options.factUsage?.read(root);

      const model = selectionOf(request.body.model ?? applicationMaterialDefaultModelId);
      const pricing = catalogModelPricing(model);
      let spentUsd = 0;
      const routed = material.route({
        configuredModel: model,
        ...(pricing === undefined ? {} : { pricing }),
      });
      const recording = {
        execute: async (modelRequest: Parameters<typeof routed.execute>[0]) => {
          const response = await routed.execute(modelRequest);
          const cost = response.cost.estimatedUsd ?? 0;
          spentUsd += cost;
          request.log.info(
            {
              workspaceId,
              applicationId,
              model: response.modelId,
              inputTokens: response.usage.inputTokens,
              outputTokens: response.usage.outputTokens,
              costUsd: cost,
            },
            "application material model call",
          );
          return response;
        },
      };
      const writer = createModelApplicationMaterialWriter({
        executor: guardCallCost(recording, maxCostUsd) as never,
        model,
        dataPolicy: {
          allowTransmission: true,
          allowedCompanies: ["anthropic"],
          sensitiveData: true,
          sensitiveDataAcknowledged: true,
        },
        applicationId,
      });
      try {
        const guidance = boundedApplicationMaterialGuidance(
          request.body.kind,
          request.body.guidance,
        );
        const draft = await draftApplicationMaterial(writer, {
          kind: request.body.kind,
          ...(guidance === undefined ? {} : { guidance }),
          facts,
          requirements,
          ...(usage === undefined ? {} : { usage }),
          language: application.language ?? workspace.language,
        });
        const byId = new Map(facts.map((fact) => [fact.id, fact]));
        request.log.info(
          {
            workspaceId,
            applicationId,
            kind: draft.kind,
            items: draft.items.length,
            guided: guidance !== undefined,
            spentUsd,
          },
          "application material drafted",
        );
        const view = {
          kind: draft.kind,
          ...(guidance === undefined ? {} : { guidance }),
          items: draft.items.map((item) => ({
            question: item.question,
            text: item.text,
            citations: item.factIds.map((id) => {
              const fact = byId.get(id) as ApplicationMaterialFact;
              return { fact_id: id, text: `${fact.category} ${fact.field}: ${fact.value}` };
            }),
          })),
          model: draft.model ?? { provider: model.company, model: model.modelId },
          prompt_version: applicationMaterialPromptVersion,
          cost_usd: spentUsd,
        };
        if (drafts === undefined) return reply.send(withTells(view));
        const saved: SavedApplicationMaterial = {
          id: newMaterialId(),
          workspace_id: workspaceId,
          application_id: applicationId,
          created_at: now().toISOString(),
          ...view,
        };
        await drafts.insert(saved);
        request.log.info(
          { workspaceId, applicationId, materialId: saved.id, kind: saved.kind },
          "application material saved",
        );
        return reply.send(viewOf(saved));
      } catch (error) {
        if (error instanceof ApplicationMaterialError) {
          request.log.info(
            {
              workspaceId,
              applicationId,
              code: error.code,
              violations: error.violations.map((violation) => violation.code),
              spentUsd,
            },
            "application material refused",
          );
          return error.code === "no_facts"
            ? reply.code(409).send(apiError("no_citable_facts", error.message))
            : reply.code(422).send(apiError("invalid_draft", error.message));
        }
        if (error instanceof CallCostBudgetError) {
          request.log.info({ workspaceId, applicationId, spentUsd }, "application material capped");
          return reply
            .code(409)
            .send(
              apiError(
                "cost_cap_reached",
                "Drafting this material could pass the server's cost cap for one request.",
              ),
            );
        }
        const failure = providerFailureOf(error);
        if (failure !== undefined) {
          request.log.warn(
            { workspaceId, applicationId, ...failure, spentUsd },
            "application material model failed",
          );
          return reply
            .code(502)
            .send(
              apiError(
                "material_model_failed",
                "The model's answer could not be used. Nothing was saved; try again.",
              ),
            );
        }
        throw error;
      }
    },
  );

  app.get(
    "/v1/application-material/models",
    {
      schema: {
        summary: "List the models that can write application material",
        description:
          "The models a cover letter or interview questions can be drafted with, the default first, each with the estimated cost of a typical draft from the catalog's prices. An estimate is absent when the catalog has no price for the model.",
        response: {
          200: z
            .strictObject({
              models: z.array(
                z.strictObject({
                  model_id: z.enum(applicationMaterialModelIds),
                  default: z.boolean(),
                  estimated_cost_usd: z.number().optional(),
                }),
              ),
            })
            .meta({ id: "ApplicationMaterialModels" }),
        },
      },
    },
    async (_request, reply) =>
      reply.send({
        models: applicationMaterialModelIds.map((modelId) => {
          const price = catalogModelPricing(selectionOf(modelId));
          const estimate =
            price === undefined
              ? undefined
              : (typicalDraftTokens.input * price.inputUsdPerMillionTokens +
                  typicalDraftTokens.output * price.outputUsdPerMillionTokens) /
                1_000_000;
          return {
            model_id: modelId,
            default: modelId === applicationMaterialDefaultModelId,
            ...(estimate === undefined ? {} : { estimated_cost_usd: Number(estimate.toFixed(4)) }),
          };
        }),
      }),
  );

  if (drafts === undefined) return;

  app.get(
    "/v1/workspaces/:workspaceId/applications/:applicationId/material",
    {
      schema: {
        summary: "List an application's saved cover letters and interview questions",
        description:
          "Returns the application's saved drafts, newest first, each with its citations, model and cost. `kind` keeps one kind. Served only by a server that keeps drafts; 404 when there is no such application.",
        params,
        querystring: listQuery,
        response: { 200: draftList, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      const root = workspaceRoot(workspaceId);
      if ((await service.getApplication({ root, applicationId })) === undefined) {
        return reply.code(404).send(apiError("not_found", "There is no such application."));
      }
      const { kind } = request.query;
      const saved = await drafts.list(
        workspaceId,
        applicationId,
        kind === undefined ? {} : { kind },
      );
      return reply.send({ drafts: saved.map(viewOf) });
    },
  );

  app.delete(
    "/v1/workspaces/:workspaceId/applications/:applicationId/material/:materialId",
    {
      schema: {
        summary: "Delete one saved cover letter or interview question set",
        description:
          "Deletes one saved draft of the application for good. 404 when the application has no such draft.",
        params: draftParams,
        response: { 204: z.null(), 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId, materialId } = request.params;
      const saved = await drafts.get(workspaceId, materialId);
      if (saved === undefined || saved.application_id !== applicationId) {
        return reply.code(404).send(apiError("not_found", "There is no such saved draft."));
      }
      await drafts.delete(workspaceId, materialId);
      request.log.info({ workspaceId, applicationId, materialId }, "application material deleted");
      return reply.code(204).send(null);
    },
  );
}

/** A provider adapter's failure, named by its code and diagnostics, never by its text. */
function providerFailureOf(
  error: unknown,
): { readonly code: string; readonly diagnostics: readonly string[] } | undefined {
  if (!(error instanceof Error) || !("diagnostics" in error) || !("code" in error)) {
    return undefined;
  }
  const { code, diagnostics } = error as { code: unknown; diagnostics: unknown };
  if (typeof code !== "string" || !Array.isArray(diagnostics)) return undefined;
  return {
    code,
    diagnostics: diagnostics.flatMap((item: { code?: unknown }) =>
      typeof item?.code === "string" ? [item.code] : [],
    ),
  };
}
