import { type ApplicationService, catalogModelPricing } from "@draft-loop/application";
import {
  ApplicationMaterialError,
  type ApplicationMaterialFact,
  applicationMaterialFactText,
} from "@draft-loop/application/application-material";
import { applicationMaterialRecordInput } from "@draft-loop/application/application-material-input";
import { applicationMaterialDefaultModelId } from "@draft-loop/application/application-material-model";
import { guardCallCost } from "@draft-loop/application/call-cost-guard";
import {
  coverLetterClaimCheckModelId,
  coverLetterClaimCheckPromptVersion,
  createModelCoverLetterClaimChecker,
} from "@draft-loop/application/cover-letter-claims-model";
import type { FactUsageService } from "@draft-loop/application/fact-usage";
import {
  type DraftInterviewGuideInput,
  draftEssentialInterviewGuide,
  type InterviewGuideDraft,
  type InterviewGuideItem,
  interviewGuideFindings,
} from "@draft-loop/application/interview-guide";
import {
  draftExtensiveInterviewGuide,
  extensiveInterviewGuidePartNames,
} from "@draft-loop/application/interview-guide-extensive";
import {
  interviewGuideFacts,
  interviewGuideMatrix,
  interviewGuideNeverSay,
} from "@draft-loop/application/interview-guide-matrix";
import {
  createModelInterviewGuideWriter,
  interviewGuideMaxCostUsd,
  interviewGuidePromptVersion,
} from "@draft-loop/application/interview-guide-model";
import { interviewGuideCanReuseBrief } from "@draft-loop/application/interview-guide-research";
import { CallCostBudgetError } from "@draft-loop/orchestrator";
import { interviewDetailsSchema } from "@draft-loop/schemas/interview-details";
import { type ResearchTopic, researchTopics } from "@draft-loop/schemas/research-brief";
import {
  maximumSavedApplicationMaterialCitations,
  maximumSavedInterviewGuideItems,
  type SavedApplicationMaterial,
  savedApplicationMaterialIdSchema,
} from "@draft-loop/schemas/saved-application-material";
import type { ConsentLedger } from "@draft-loop/storage/consent-ledger";
import type { ResearchBriefStore } from "@draft-loop/storage/research-briefs";
import type { SavedApplicationMaterialStore } from "@draft-loop/storage/saved-application-material";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
  type ApplicationMaterialParts,
  applicationMaterialModelIds,
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
import type { ResearchRuns } from "./research-runs.js";

/**
 * Drafts an interview preparation guide (#2632): the essential or extensive writer over the
 * facts the candidate allowed for interviews, the requirement matrix, the never-say list and the
 * application's research brief, with every sentence held to its sources by the claim check. A
 * guide that needs research the brief does not hold queues it first, when the candidate approved.
 */

export interface InterviewGuideRoutesOptions {
  readonly service: ApplicationService;
  readonly workspaceRoot: (workspaceId: string) => string;
  readonly material: Pick<ApplicationMaterialParts, "route" | "allowProviderData" | "maxCostUsd">;
  readonly consents?: ConsentLedger;
  readonly screening?: Pick<ContentScreeningHooks, "assertRunMaterialClear">;
  readonly factUsage?: Pick<FactUsageService, "read">;
  readonly drafts?: SavedApplicationMaterialStore;
  readonly researchBriefs?: Pick<ResearchBriefStore, "list">;
  /** The worker's research runs; without them a guide drafts from the briefs that exist. */
  readonly runs?: ResearchRuns;
  readonly now?: () => Date;
}

const body = z
  .strictObject({
    details: interviewDetailsSchema.describe(
      "The interview the guide prepares for: its stage, depth, length and what to cover. `notes`, `other_topics` and `never_say` are the candidate's own words, never facts.",
    ),
    model: z
      .enum(applicationMaterialModelIds)
      .optional()
      .describe("The model that writes the guide; the default model when absent."),
    research: z
      .enum(["approved", "skip"])
      .describe(
        "`approved` queues web research about the employer, the role and the field when the newest brief is older than 14 days or misses a topic the guide needs, and answers 202 while it runs; draft again with `skip` once it is done. `skip` drafts from the briefs that exist; topics without a source are reported in `unsourced_topics`.",
      ),
    parts: z
      .array(z.enum(extensiveInterviewGuidePartNames as ["context", "story", "practice"]))
      .min(1)
      .max(extensiveInterviewGuidePartNames.length)
      .optional()
      .describe(
        "For an extensive guide: write only these parts again and keep the rest of `based_on`. Needs `based_on`.",
      ),
    based_on: savedApplicationMaterialIdSchema
      .optional()
      .describe("The saved guide whose other parts are kept when `parts` is set."),
  })
  .meta({ id: "InterviewGuideRequest" });

const researching = z
  .strictObject({
    status: z.literal("researching"),
    research: z.strictObject({ status: z.literal("pending") }),
  })
  .meta({ id: "InterviewGuideResearching" });

/** A saved guide item as the writer's options take it back, to keep the parts not rewritten. */
function guideItemOf(item: SavedApplicationMaterial["items"][number]): InterviewGuideItem[] {
  if (item.section === undefined) return [];
  return [
    {
      section: item.section,
      heading: item.question,
      text: item.text,
      ...(item.trap === undefined ? {} : { trap: item.trap }),
      factIds: item.citations.map((citation) => citation.fact_id),
      findingIds: (item.company_citations ?? []).map((citation) => citation.finding_id),
    },
  ];
}

function isResearchTopic(topic: string): topic is ResearchTopic {
  return (researchTopics as readonly string[]).includes(topic);
}

export function registerInterviewGuideRoutes(
  parent: FastifyInstance,
  options: InterviewGuideRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, material, consents, screening, drafts } = options;
  const now = options.now ?? (() => new Date());

  app.post(
    "/v1/workspaces/:workspaceId/applications/:applicationId/interview-guide",
    {
      schema: {
        summary: "Draft an interview preparation guide for an application",
        description:
          "Drafts a sectioned guide for one interview from the facts the candidate allowed for interviews, the newest brief's requirements and the application's research brief. Every sentence about the candidate cites a fact or admits a gap, every sentence about the employer or the field cites a finding, and sentences that fail, or come close to a never-say entry, are left out and listed in `dropped_sentences`. An essential guide is one writer call (cost cap US$0.20); an extensive one is three (US$0.40), and `parts` writes some of them again. With `research: approved` and a brief that is stale or misses a topic, research is queued and the answer is 202. Errors as the material route: 403 consent_required, 503 material_model_unavailable, 409 material_quarantined, material_unscreened, no_citable_facts or cost_cap_reached, 422 invalid_draft, 502 material_model_failed; 404 when `based_on` is not a guide of this application, 400 when `parts` is set without it or for an essential guide.",
        params,
        body,
        response: { 200: draftView, 202: researching, ...errors },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId } = request.params;
      const { details } = request.body;
      const root = workspaceRoot(workspaceId);
      const workspace = await service.readWorkspace(root);
      const application = await service.getApplication({ root, applicationId });
      if (application === undefined) {
        return reply.code(404).send(apiError("not_found", "There is no such application."));
      }
      if (request.body.parts !== undefined) {
        if (details.depth !== "extensive" || request.body.based_on === undefined) {
          return reply
            .code(400)
            .send(
              apiError(
                "invalid_input",
                "Writing parts again needs an extensive guide and the saved guide in `based_on`.",
              ),
            );
        }
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
      let previous: readonly InterviewGuideItem[] | undefined;
      if (request.body.based_on !== undefined) {
        const saved = await drafts?.get(workspaceId, request.body.based_on);
        if (
          saved === undefined ||
          saved.application_id !== applicationId ||
          saved.kind !== "interview-guide"
        ) {
          return reply
            .code(404)
            .send(apiError("not_found", "There is no such guide for this application."));
        }
        previous = saved.items.flatMap(guideItemOf);
      }
      const brief = application.briefs.at(-1);
      if (brief !== undefined) {
        await screening?.assertRunMaterialClear({
          workspaceId,
          workspace,
          opportunityBrief: { briefId: brief.briefId, version: brief.latestVersion },
        });
      }

      // Research first, when the candidate approved it and the newest brief cannot serve.
      const [research] = (await options.researchBriefs?.list(workspaceId, applicationId)) ?? [];
      if (
        request.body.research === "approved" &&
        options.runs !== undefined &&
        !interviewGuideCanReuseBrief(research, details, now())
      ) {
        const salary = details.topics?.includes("salary") ?? false;
        const queued = await options.runs.queue({
          workspaceId,
          applicationId,
          guide: { depth: details.depth, ...(salary ? { salary } : {}) },
        });
        if (queued !== "unavailable") {
          request.log.info(
            { workspaceId, applicationId, depth: details.depth, queued },
            "interview guide research queued",
          );
          return reply
            .code(202)
            .send({ status: "researching" as const, research: { status: "pending" as const } });
        }
      }

      const record = await applicationMaterialRecordInput({
        service,
        root,
        briefId: brief?.briefId,
        factUsage: options.factUsage,
      });
      const { allowed, neverSaid } = interviewGuideFacts(record.facts, { usage: record.usage });
      const input: DraftInterviewGuideInput = {
        details,
        facts: allowed,
        requirements: record.requirements,
        matrix: interviewGuideMatrix(record.requirements, allowed),
        neverSay: interviewGuideNeverSay(neverSaid, details.never_say),
        brief: research,
        language: application.language ?? workspace.language,
      };

      const writerModel = {
        company: "anthropic",
        modelId: request.body.model ?? applicationMaterialDefaultModelId,
        role: "author",
        promptTemplateVersion: interviewGuidePromptVersion,
      } as const;
      const checkerModel = {
        company: "anthropic",
        modelId: coverLetterClaimCheckModelId,
        role: "author",
        promptTemplateVersion: coverLetterClaimCheckPromptVersion,
      } as const;
      const buildRoute = material.route;
      // A route answers only its own selection, prompt version included: one for each model.
      const routeOf = (configuredModel: typeof writerModel | typeof checkerModel) => {
        const price = catalogModelPricing(configuredModel);
        return buildRoute({ configuredModel, ...(price === undefined ? {} : { pricing: price }) });
      };
      const writerRoute = routeOf(writerModel);
      const checkRoute = routeOf(checkerModel);
      let spentUsd = 0;
      const recording = {
        execute: async (modelRequest: Parameters<typeof writerRoute.execute>[0]) => {
          const target =
            modelRequest.model.promptTemplateVersion === checkerModel.promptTemplateVersion
              ? checkRoute
              : writerRoute;
          const response = await target.execute(modelRequest);
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
            "interview guide model call",
          );
          return response;
        },
      };
      const maxCostUsd = Math.min(
        interviewGuideMaxCostUsd[details.depth],
        material.maxCostUsd ?? Number.POSITIVE_INFINITY,
      );
      const executor = guardCallCost(recording, maxCostUsd) as never;
      const dataPolicy = {
        allowTransmission: true,
        allowedCompanies: ["anthropic" as const],
        sensitiveData: true,
        sensitiveDataAcknowledged: true,
      };
      const writer = createModelInterviewGuideWriter({
        executor,
        model: writerModel,
        dataPolicy,
        applicationId,
      });
      const checker = createModelCoverLetterClaimChecker({
        executor,
        model: checkerModel,
        dataPolicy,
        applicationId,
      });

      try {
        const draft: InterviewGuideDraft =
          details.depth === "essential"
            ? await draftEssentialInterviewGuide(writer, checker, input)
            : await draftExtensiveInterviewGuide(writer, checker, input, {
                ...(request.body.parts === undefined ? {} : { parts: request.body.parts }),
                ...(previous === undefined ? {} : { previous }),
              });
        const view = guideView(draft, input, {
          writerModel,
          spentUsd,
          researchBriefId: research?.id,
        });
        request.log.info(
          {
            workspaceId,
            applicationId,
            depth: details.depth,
            parts: request.body.parts ?? "all",
            items: view.items.length,
            droppedSentences: draft.droppedSentences.length,
            unsourcedTopics: draft.unsourcedTopics.length,
            spentUsd,
          },
          "interview guide drafted",
        );
        if (drafts === undefined) return reply.send(view);
        const saved: SavedApplicationMaterial = {
          id: newMaterialId(),
          workspace_id: workspaceId,
          application_id: applicationId,
          created_at: now().toISOString(),
          ...view,
          ...(request.body.based_on === undefined ? {} : { based_on: request.body.based_on }),
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
            { workspaceId, applicationId, code: error.code, spentUsd },
            "interview guide refused",
          );
          return error.code === "no_facts"
            ? reply.code(409).send(apiError("no_citable_facts", error.message))
            : reply.code(422).send(apiError("invalid_draft", error.message));
        }
        if (error instanceof CallCostBudgetError) {
          request.log.info({ workspaceId, applicationId, spentUsd }, "interview guide capped");
          return reply
            .code(409)
            .send(
              apiError(
                "cost_cap_reached",
                "Drafting this guide could pass the server's cost cap for one guide.",
              ),
            );
        }
        const failure = providerFailureOf(error);
        if (failure !== undefined) {
          request.log.warn(
            { workspaceId, applicationId, ...failure, spentUsd },
            "interview guide model failed",
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

/** The drafted guide as the API shows and stores it, each item with its citations' texts. */
function guideView(
  draft: InterviewGuideDraft,
  input: DraftInterviewGuideInput,
  context: {
    readonly writerModel: { readonly company: string; readonly modelId: string };
    readonly spentUsd: number;
    readonly researchBriefId: string | undefined;
  },
) {
  const facts = new Map(input.facts.map((fact) => [fact.id, fact]));
  const findings = new Map(
    interviewGuideFindings(input.brief).map((finding) => [finding.id, finding.text]),
  );
  const items = draft.items.slice(0, maximumSavedInterviewGuideItems).map((item) => {
    const citations = item.factIds
      .flatMap((id) => facts.get(id) ?? [])
      .slice(0, maximumSavedApplicationMaterialCitations)
      .map((fact: ApplicationMaterialFact) => ({
        fact_id: fact.id,
        text: applicationMaterialFactText(fact),
      }));
    const companyCitations = item.findingIds
      .filter((id) => findings.has(id))
      .slice(0, maximumSavedApplicationMaterialCitations)
      .map((id) => ({ finding_id: id, text: findings.get(id) ?? id }));
    return {
      question: item.heading,
      text: item.text,
      section: item.section,
      ...(item.trap === undefined ? {} : { trap: item.trap }),
      citations,
      ...(companyCitations.length === 0 ? {} : { company_citations: companyCitations }),
    };
  });
  const usesResearch = items.some((item) => (item.company_citations ?? []).length > 0);
  const unsourced = draft.unsourcedTopics.filter(isResearchTopic);
  return {
    kind: "interview-guide" as const,
    interview_details: input.details,
    items,
    ...(usesResearch && context.researchBriefId !== undefined
      ? { research_brief_id: context.researchBriefId }
      : {}),
    model: draft.model ?? {
      provider: context.writerModel.company,
      model: context.writerModel.modelId,
    },
    ...(draft.droppedSentences.length === 0
      ? {}
      : {
          dropped_sentences: draft.droppedSentences
            .filter((sentence) => sentence.trim() !== "")
            .slice(0, maximumSavedInterviewGuideItems * 2),
        }),
    ...(unsourced.length === 0 ? {} : { unsourced_topics: unsourced }),
    prompt_version: interviewGuidePromptVersion,
    cost_usd: context.spentUsd,
  };
}
