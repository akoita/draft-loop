import { type ApplicationService, catalogModelPricing } from "@draft-loop/application";
import { researchCompanyFacts } from "@draft-loop/application/application-material-company";
import { applicationMaterialRecordInput } from "@draft-loop/application/application-material-input";
import { failedCallCostUsd, guardCallCost } from "@draft-loop/application/call-cost-guard";
import { billedCallUsage } from "@draft-loop/application/career-interview-usage";
import { CoverLetterKitError, draftCoverLetterKit } from "@draft-loop/application/cover-letter-kit";
import {
  coverLetterKitMaxCostUsd,
  coverLetterKitModelId,
  coverLetterKitPromptVersion,
  createModelCoverLetterKitWriter,
} from "@draft-loop/application/cover-letter-kit-model";
import type { FactUsageService } from "@draft-loop/application/fact-usage";
import type { WritingSamplesService } from "@draft-loop/application/writing-samples";
import { CallCostBudgetError } from "@draft-loop/orchestrator";
import type { SavedApplicationMaterial } from "@draft-loop/schemas/saved-application-material";
import type { ConsentLedger } from "@draft-loop/storage/consent-ledger";
import type { ResearchBriefStore } from "@draft-loop/storage/research-briefs";
import type { SavedApplicationMaterialStore } from "@draft-loop/storage/saved-application-material";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  type ApplicationMaterialParts,
  careerProfileField,
  draftView,
  errors,
  newMaterialId,
  params,
  permitsAnthropic,
  providerFailureOf,
  viewOf,
} from "./application-material-routes.js";
import { consentRecordId } from "./consent-routes.js";
import type { ContentScreeningHooks } from "./content-screening-routes.js";
import { apiError } from "./errors.js";

/**
 * A cover letter writing kit for one application (#3278): the requirements to answer with the
 * approved facts that prove them, opening angles and a four-paragraph outline as notes, dated
 * employer facts and phrases to avoid, so the candidate writes the letter in their own words.
 * One Haiku call under the material route's consent, screening and cost rules; the kit is saved
 * with the application as a `cover-letter-kit` version.
 */

export interface CoverLetterKitRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly material: Pick<ApplicationMaterialParts, "route" | "allowProviderData" | "maxCostUsd">;
  readonly consents?: ConsentLedger;
  readonly screening?: Pick<ContentScreeningHooks, "assertRunMaterialClear">;
  readonly factUsage?: Pick<FactUsageService, "read">;
  /** Supplies the candidate's forbidden terms for the avoid list. */
  readonly writingSamples?: Pick<WritingSamplesService, "read">;
  /** Where kits are kept; without it a kit is returned and not stored. */
  readonly drafts?: SavedApplicationMaterialStore;
  readonly researchBriefs?: Pick<ResearchBriefStore, "list">;
  readonly now?: () => Date;
}

export const coverLetterKitPath =
  "/v1/workspaces/:workspaceId/applications/:applicationId/cover-letter-kit";

export function registerCoverLetterKitRoutes(
  parent: FastifyInstance,
  options: CoverLetterKitRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, material, consents, screening, drafts } = options;
  const now = options.now ?? (() => new Date());

  app.post(
    coverLetterKitPath,
    {
      schema: {
        summary: "Prepare a writing kit for an application's cover letter",
        description: `Returns the material for the candidate to write their own letter, never a letter: the three requirements to answer (fewer when the brief lists fewer), each with one or two approved career facts; two or three opening angles and a four-paragraph outline as short notes; up to two dated facts about the employer from the newest research brief; and phrases to avoid. Every fact cites a career record fact id or a finding id, and a note is refused when it reads as a sentence. One call on ${coverLetterKitModelId}, capped at US$${coverLetterKitMaxCostUsd} across its retry. A server that keeps drafts saves it as a \`cover-letter-kit\` version. Errors as the material route: 403 consent_required, 503 material_model_unavailable, 409 material_quarantined, material_unscreened, no_citable_facts or cost_cap_reached, 502 material_model_failed; 409 no_requirements when the brief lists none, 422 invalid_kit when the answer breaks the kit's rules twice.`,
        params,
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
              "Allow sending career material to Anthropic in this record's consent to prepare a writing kit.",
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
      const record = await applicationMaterialRecordInput({
        service,
        root,
        briefId: brief?.briefId,
        writingSamples: options.writingSamples,
        factUsage: options.factUsage,
      });
      const [research] = (await options.researchBriefs?.list(workspaceId, applicationId)) ?? [];
      const companyFacts = research === undefined ? [] : researchCompanyFacts(research);

      const model = {
        company: "anthropic",
        modelId: coverLetterKitModelId,
        role: "author",
        promptTemplateVersion: coverLetterKitPromptVersion,
      } as const;
      const price = catalogModelPricing(model);
      const routed = material.route({
        configuredModel: model,
        ...(price === undefined ? {} : { pricing: price }),
      });
      let spentUsd = 0;
      const recording = {
        execute: async (modelRequest: Parameters<typeof routed.execute>[0]) => {
          const response = await routed.execute(modelRequest).catch((error: unknown) => {
            // A rejected answer, such as one cut off at its output limit, was billed too.
            const failedUsd = failedCallCostUsd(error);
            spentUsd += failedUsd;
            const billed = billedCallUsage(error);
            request.log.warn(
              {
                workspaceId,
                applicationId,
                model: modelRequest.model.modelId,
                inputTokens: billed?.inputTokens ?? 0,
                outputTokens: billed?.outputTokens ?? 0,
                costUsd: failedUsd,
                failed: true,
              },
              "cover letter kit model call",
            );
            throw error;
          });
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
            "cover letter kit model call",
          );
          return response;
        },
      };
      const maxCostUsd = Math.min(
        coverLetterKitMaxCostUsd,
        material.maxCostUsd ?? Number.POSITIVE_INFINITY,
      );
      const writer = createModelCoverLetterKitWriter({
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
        const draft = await draftCoverLetterKit(writer, {
          facts: record.facts,
          requirements: record.requirements,
          ...(record.usage === undefined ? {} : { usage: record.usage }),
          ...(record.voice === undefined ? {} : { voice: record.voice }),
          language: application.language ?? workspace.language,
          ...(companyFacts.length === 0 ? {} : { companyFacts }),
        });
        const view = {
          kind: "cover-letter-kit" as const,
          items: [],
          kit: draft.kit,
          ...(draft.kit.employer_facts.length > 0 && research !== undefined
            ? { research_brief_id: research.id }
            : {}),
          model: draft.model ?? { provider: model.company, model: model.modelId },
          prompt_version: coverLetterKitPromptVersion,
          cost_usd: spentUsd,
        };
        request.log.info(
          {
            workspaceId,
            applicationId,
            requirements: draft.kit.requirements.length,
            angles: draft.kit.angles.length,
            employerFacts: draft.kit.employer_facts.length,
            spentUsd,
          },
          "cover letter kit prepared",
        );
        if (drafts === undefined) {
          return reply.send({ ...view, ...careerProfileField(record.profile) });
        }
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
        return reply.send({ ...viewOf(saved), ...careerProfileField(record.profile) });
      } catch (error) {
        if (error instanceof CoverLetterKitError) {
          request.log.info(
            {
              workspaceId,
              applicationId,
              code: error.code,
              violations: error.violations.map((violation) => violation.code),
              spentUsd,
            },
            "cover letter kit refused",
          );
          if (error.code === "no_facts") {
            return reply.code(409).send(apiError("no_citable_facts", error.message));
          }
          if (error.code === "no_requirements") {
            return reply.code(409).send(apiError("no_requirements", error.message));
          }
          return reply.code(422).send(apiError("invalid_kit", error.message));
        }
        if (error instanceof CallCostBudgetError) {
          request.log.info({ workspaceId, applicationId, spentUsd }, "cover letter kit capped");
          return reply
            .code(409)
            .send(
              apiError(
                "cost_cap_reached",
                "Preparing this kit could pass the server's cost cap for one kit.",
              ),
            );
        }
        const failure = providerFailureOf(error);
        if (failure !== undefined) {
          request.log.warn(
            { workspaceId, applicationId, ...failure, spentUsd },
            "cover letter kit model failed",
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
}
