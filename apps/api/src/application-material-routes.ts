import { type ApplicationService, catalogModelPricing } from "@draft-loop/application";
import {
  ApplicationMaterialError,
  type ApplicationMaterialFact,
  type ApplicationMaterialRequirement,
  applicationMaterialKinds,
  draftApplicationMaterial,
} from "@draft-loop/application/application-material";
import {
  applicationMaterialDefaultModelId,
  applicationMaterialPromptVersion,
  createModelApplicationMaterialWriter,
} from "@draft-loop/application/application-material-model";
import { guardCallCost } from "@draft-loop/application/call-cost-guard";
import type { FactUsageService } from "@draft-loop/application/fact-usage";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import { CallCostBudgetError } from "@draft-loop/orchestrator";
import { applicationIdSchema } from "@draft-loop/schemas/application";
import {
  type ConsentLedger,
  type ConsentState,
  permitsTransmission,
} from "@draft-loop/storage/consent-ledger";
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
}

/** The default cap on one request: two Sonnet calls with a full context stay well below it. */
export const defaultApplicationMaterialMaxCostUsd = 0.5;

const params = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
  applicationId: applicationIdSchema,
});

const body = z
  .strictObject({ kind: z.enum(applicationMaterialKinds) })
  .meta({ id: "ApplicationMaterialRequest" });

const draftView = z
  .object({
    kind: z.enum(applicationMaterialKinds),
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
    prompt_version: z.string(),
    cost_usd: z.number().describe("The provider cost recorded for this draft's calls."),
  })
  .meta({ id: "ApplicationMaterialDraft" });

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
 * deployment has a Claude route, and a cost guard caps and records the spend. The draft is
 * returned, never stored. Logs carry ids, kinds, models and costs, never the draft.
 */
export function registerApplicationMaterialRoutes(
  parent: FastifyInstance,
  options: ApplicationMaterialRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, material, consents, screening } = options;
  const model = {
    company: "anthropic",
    modelId: applicationMaterialDefaultModelId,
    role: "author",
    promptTemplateVersion: applicationMaterialPromptVersion,
  } as const;
  const pricing = catalogModelPricing(model);
  const maxCostUsd = material.maxCostUsd ?? defaultApplicationMaterialMaxCostUsd;

  app.post(
    "/v1/workspaces/:workspaceId/applications/:applicationId/material",
    {
      schema: {
        summary: "Draft a cover letter or interview questions for an application",
        description:
          "Drafts from the career record's facts (identity and contact withheld) and the application's newest brief requirements, and returns the draft with each item's citations; nothing is stored. Needs the record's consent to send career material to Anthropic (403 consent_required) and a server Claude route (503 material_model_unavailable). A brief whose job source is quarantined or unscreened answers 409 material_quarantined or material_unscreened, as a run would. 409 no_citable_facts when the record holds no fact to cite, 422 invalid_draft when the model's draft breaks the citation rules twice, and 409 cost_cap_reached when the next call could pass the request's cost cap.",
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
        const draft = await draftApplicationMaterial(writer, {
          kind: request.body.kind,
          facts,
          requirements,
          ...(usage === undefined ? {} : { usage }),
        });
        const byId = new Map(facts.map((fact) => [fact.id, fact]));
        request.log.info(
          { workspaceId, applicationId, kind: draft.kind, items: draft.items.length, spentUsd },
          "application material drafted",
        );
        return reply.send({
          kind: draft.kind,
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
        });
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
        throw error;
      }
    },
  );
}
