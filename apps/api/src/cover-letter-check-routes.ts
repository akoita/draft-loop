import { type ApplicationService, catalogModelPricing } from "@draft-loop/application";
import { researchCompanyFacts } from "@draft-loop/application/application-material-company";
import { applicationMaterialRecordInput } from "@draft-loop/application/application-material-input";
import { failedCallCostUsd, guardCallCost } from "@draft-loop/application/call-cost-guard";
import { billedCallUsage } from "@draft-loop/application/career-interview-usage";
import {
  type CoverLetterCheckInput,
  checkCoverLetterText,
  coverLetterCheckBriefTargets,
} from "@draft-loop/application/cover-letter-check";
import {
  coverLetterClaimCheckModelId,
  coverLetterClaimCheckPromptVersion,
  createModelCoverLetterClaimChecker,
} from "@draft-loop/application/cover-letter-claims-model";
import type { FactUsageService } from "@draft-loop/application/fact-usage";
import { CallCostBudgetError } from "@draft-loop/orchestrator";
import {
  type CoverLetterCheckSkipReason,
  coverLetterCheckRequestSchema,
  coverLetterCheckSchema,
} from "@draft-loop/schemas/cover-letter-check";
import type { ConsentLedger } from "@draft-loop/storage/consent-ledger";
import type { ResearchBriefStore } from "@draft-loop/storage/research-briefs";
import type { SavedApplicationMaterialStore } from "@draft-loop/storage/saved-application-material";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";

import {
  type ApplicationMaterialParts,
  errors,
  params,
  permitsAnthropic,
  providerFailureOf,
} from "./application-material-routes.js";
import { applicationJob } from "./application-lifecycle-routes.js";
import { consentRecordId } from "./consent-routes.js";
import type { ContentScreeningHooks } from "./content-screening-routes.js";
import { apiError } from "./errors.js";
import type { ModelCallSwitch } from "./model-call-switch.js";

/**
 * Check my letter (#3280): the candidate's own cover letter, checked without a rewrite. The
 * claim check reuses the free-form letter's Haiku linker (#2585); the requirement and wording
 * checks run without a model. The letter reaches the model only on this request and is never
 * stored: the route returns the findings and keeps nothing but one more in the day's count of
 * checks (#3282), a date and a number for the quality digest.
 */

/** The day's count of checks across the deployment; it never holds the letter. */
export interface CoverLetterCheckTally {
  readonly count: (now: Date) => Promise<void>;
}

export interface CoverLetterCheckRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly material: Pick<ApplicationMaterialParts, "route" | "allowProviderData" | "maxCostUsd">;
  readonly consents?: ConsentLedger;
  readonly screening?: Pick<ContentScreeningHooks, "assertRunMaterialClear">;
  readonly factUsage?: Pick<FactUsageService, "read">;
  /** Where the application's writing kits are; without it the brief gives the requirements. */
  readonly drafts?: Pick<SavedApplicationMaterialStore, "list">;
  readonly researchBriefs?: Pick<ResearchBriefStore, "list">;
  /** The global model call switch: while paused the claim check is skipped. */
  readonly paused?: ModelCallSwitch;
  /** Counts each answered check for the quality digest; without it nothing is counted. */
  readonly tally?: CoverLetterCheckTally;
}

export const coverLetterCheckPath =
  "/v1/workspaces/:workspaceId/applications/:applicationId/cover-letter-check";

/** The most one check spends, across its batches. */
export const coverLetterCheckMaxCostUsd = 0.05;

export function registerCoverLetterCheckRoutes(
  parent: FastifyInstance,
  options: CoverLetterCheckRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, material, consents, screening } = options;

  app.post(
    coverLetterCheckPath,
    {
      schema: {
        summary: "Check a cover letter the candidate wrote",
        description: `Checks the letter in \`text\` (at most 8,000 characters) and returns three groups, never a rewrite: \`claims\`, sentences the approved career record does not support, each with the closest approved fact; \`requirements\`, the latest writing kit's requirements (else the brief's top three) no sentence answers; and \`wording\`, job-ad echoes, empty superlatives and the writing-tells rules. Only the claim check calls a model, ${coverLetterClaimCheckModelId}, capped at US$${coverLetterCheckMaxCostUsd}. It is skipped, and \`claims.reason\` says why, while model calls are paused, without a model route, without consent to send career material to Anthropic, or when no fact is allowed. The letter is not stored. Errors: 409 material_quarantined, material_unscreened or cost_cap_reached, 502 material_model_failed.`,
        params,
        body: coverLetterCheckRequestSchema,
        response: { 200: coverLetterCheckSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      // A failed count is logged and never fails the check.
      const countCheck = async () => {
        try {
          await options.tally?.count(new Date());
        } catch (error) {
          request.log.warn({ err: error }, "cover letter check count failed");
        }
      };
      const root = workspaceRoot(workspaceId);
      const workspace = await service.readWorkspace(root);
      const application = await service.getApplication({ root, applicationId });
      if (application === undefined) {
        return reply.code(404).send(apiError("not_found", "There is no such application."));
      }
      const brief = application.briefs.at(-1);
      const record = await applicationMaterialRecordInput({
        service,
        root,
        briefId: brief?.briefId,
        factUsage: options.factUsage,
      });
      const opportunity =
        brief === undefined
          ? undefined
          : await service.getOpportunity({ root, briefId: brief.briefId });
      const job = opportunity?.brief;
      const jobTexts = [
        job?.role?.value,
        ...(job?.responsibilities ?? []).map((entry) => entry.text),
        ...(job?.requirements ?? []).map((entry) => entry.text),
        ...(job?.priorities ?? []).map((entry) => entry.text),
      ].filter((text): text is string => typeof text === "string" && text !== "");
      const [kit] =
        (await options.drafts?.list(workspaceId, applicationId, {
          kind: "cover-letter-kit",
          limit: 1,
        })) ?? [];
      const targets: CoverLetterCheckInput["targets"] =
        kit?.kit !== undefined
          ? {
              source: "kit",
              kitId: kit.id,
              items: kit.kit.requirements.map((entry) => ({
                requirement_id: entry.requirement_id,
                text: entry.text,
                facts: entry.facts,
              })),
            }
          : record.requirements.length > 0
            ? { source: "brief", items: coverLetterCheckBriefTargets(record.requirements) }
            : { source: "none", items: [] };
      const [research] = (await options.researchBriefs?.list(workspaceId, applicationId)) ?? [];
      const input: CoverLetterCheckInput = {
        letter: request.body.text,
        facts: record.facts,
        ...(record.usage === undefined ? {} : { usage: record.usage }),
        ...(research === undefined ? {} : { companyFacts: researchCompanyFacts(research) }),
        requirements: record.requirements,
        targets,
        jobTexts,
        // Words the job ad asked AI tools to add, from its text and what its page hid (#3337).
        plantedWords: [
          ...new Set(
            (applicationJob(application).aiInstructions?.instructions ?? []).flatMap(
              (instruction) => instruction.words,
            ),
          ),
        ],
      };

      let skip: CoverLetterCheckSkipReason | undefined;
      if ((await options.paused?.()) === true) {
        request.log.warn(
          { event: "model_calls_paused", path: "cover-letter-check" },
          "model call paused",
        );
        skip = "model_calls_paused";
      } else if (material.route === undefined || !material.allowProviderData) {
        skip = "model_unavailable";
      } else {
        const recordId = await consentRecordId(service, workspaceRoot, workspaceId);
        if (consents === undefined || !permitsAnthropic(await consents.current(recordId))) {
          skip = "consent_required";
        }
      }
      if (skip !== undefined) {
        const findings = await checkCoverLetterText(input, { skip });
        request.log.info(
          { workspaceId, applicationId, skipped: skip, wording: findings.wording.length },
          "cover letter checked",
        );
        await countCheck();
        return reply.send({ ...findings, model: null, prompt_version: null, cost_usd: 0 });
      }
      if (brief !== undefined) {
        await screening?.assertRunMaterialClear({
          workspaceId,
          workspace,
          opportunityBrief: { briefId: brief.briefId, version: brief.latestVersion },
        });
      }

      const model = {
        company: "anthropic",
        modelId: coverLetterClaimCheckModelId,
        role: "author",
        promptTemplateVersion: coverLetterClaimCheckPromptVersion,
      } as const;
      const price = catalogModelPricing(model);
      const buildRoute = material.route as NonNullable<typeof material.route>;
      const routed = buildRoute({
        configuredModel: model,
        ...(price === undefined ? {} : { pricing: price }),
      });
      let spentUsd = 0;
      // Logs the model, tokens and cost of each call, never the letter.
      const recording = {
        execute: async (modelRequest: Parameters<typeof routed.execute>[0]) => {
          const response = await routed.execute(modelRequest).catch((error: unknown) => {
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
              "cover letter check model call",
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
            "cover letter check model call",
          );
          return response;
        },
      };
      const checker = createModelCoverLetterClaimChecker({
        executor: guardCallCost(
          recording,
          Math.min(coverLetterCheckMaxCostUsd, material.maxCostUsd ?? Number.POSITIVE_INFINITY),
        ) as never,
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
        const findings = await checkCoverLetterText(input, checker);
        request.log.info(
          {
            workspaceId,
            applicationId,
            sentences: findings.claims.checked_sentences,
            claims: findings.claims.findings.length,
            unanswered: findings.requirements.unanswered.length,
            wording: findings.wording.length,
            spentUsd,
          },
          "cover letter checked",
        );
        await countCheck();
        return reply.send({
          ...findings,
          model:
            findings.claims.status === "checked"
              ? { provider: model.company, model: model.modelId }
              : null,
          prompt_version:
            findings.claims.status === "checked" ? coverLetterClaimCheckPromptVersion : null,
          cost_usd: spentUsd,
        });
      } catch (error) {
        if (error instanceof CallCostBudgetError) {
          request.log.info({ workspaceId, applicationId, spentUsd }, "cover letter check capped");
          return reply
            .code(409)
            .send(
              apiError(
                "cost_cap_reached",
                "Checking this letter could pass the server's cost cap for one check.",
              ),
            );
        }
        const failure = providerFailureOf(error);
        if (failure !== undefined) {
          request.log.warn(
            { workspaceId, applicationId, ...failure, spentUsd },
            "cover letter check model failed",
          );
          return reply
            .code(502)
            .send(
              apiError(
                "material_model_failed",
                "The claim check's answer could not be used. Nothing was saved; try again.",
              ),
            );
        }
        throw error;
      }
    },
  );
}
