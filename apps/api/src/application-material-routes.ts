import { randomBytes } from "node:crypto";

import { type ApplicationService, catalogModelPricing } from "@draft-loop/application";
import {
  ApplicationMaterialError,
  type ApplicationMaterialFact,
  applicationMaterialFactText,
  applicationMaterialKinds,
  boundedApplicationMaterialGuidance,
  draftApplicationMaterial,
  unsupportedNumbers,
} from "@draft-loop/application/application-material";
import { researchCompanyFacts } from "@draft-loop/application/application-material-company";
import {
  applicationMaterialDocumentFormats,
  defaultApplicationMaterialTemplateId,
  renderApplicationMaterialDocument,
} from "@draft-loop/application/application-material-document";
import { applicationMaterialRecordInput } from "@draft-loop/application/application-material-input";
import {
  applicationMaterialDefaultModelId,
  applicationMaterialEconomyModelId,
  applicationMaterialPromptVersion,
  createModelApplicationMaterialWriter,
} from "@draft-loop/application/application-material-model";
import { guardCallCost } from "@draft-loop/application/call-cost-guard";
import type { FactUsageService } from "@draft-loop/application/fact-usage";
import type { WritingSamplesService } from "@draft-loop/application/writing-samples";
import { writingTells } from "@draft-loop/application/writing-tells";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import { CallCostBudgetError } from "@draft-loop/orchestrator";
import { materialReviewOutcomes } from "@draft-loop/run-queue";
import { applicationIdSchema } from "@draft-loop/schemas/application";
import {
  applicationMaterialGuidanceSchema,
  maximumSavedApplicationMaterialItemCharacters,
  maximumSavedApplicationMaterialItems,
  type SavedApplicationMaterial,
  savedApplicationMaterialIdSchema,
} from "@draft-loop/schemas/saved-application-material";
import {
  type ConsentLedger,
  type ConsentState,
  permitsTransmission,
} from "@draft-loop/storage/consent-ledger";
import type { ResearchBriefStore } from "@draft-loop/storage/research-briefs";
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
import type { MaterialReviews } from "./material-reviews.js";

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
  /** The candidate's writing samples (#2513); without them drafts follow the brief alone. */
  readonly writingSamples?: Pick<WritingSamplesService, "read">;
  /** Where drafts are kept (#2477); without it a draft is returned and not stored, as before. */
  readonly drafts?: SavedApplicationMaterialStore;
  /**
   * The critic pass on saved cover letters (#2525); without it a letter stands as drafted. A pass is
   * queued only when the record's consent names the workspace's critic company.
   */
  readonly reviews?: MaterialReviews;
  /**
   * The application's research briefs (#2544); the newest one's findings reach the drafter as
   * company facts. Without them a draft cites career facts only, as before.
   */
  readonly researchBriefs?: Pick<ResearchBriefStore, "list">;
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
        edited: z
          .boolean()
          .optional()
          .describe("True when the candidate rewrote this item; the text is then theirs."),
        unsupported_numbers: z
          .array(z.string())
          .optional()
          .describe(
            "For an edited item: numbers none of the draft's cited facts state, for the candidate to check. Flagged, never refused.",
          ),
        citations: z
          .array(z.object({ fact_id: z.string(), text: z.string() }))
          .describe("The career record facts the item relies on, as the candidate stored them."),
        company_citations: z
          .array(z.object({ finding_id: z.string(), text: z.string() }))
          .optional()
          .describe(
            "The research brief's findings a statement about the employer relies on; never a claim about the candidate.",
          ),
      }),
    ),
    research_brief_id: z
      .string()
      .optional()
      .describe("The research brief the company citations come from."),
    based_on: savedApplicationMaterialIdSchema
      .optional()
      .describe("The saved draft this version was edited from; absent for a drafted version."),
    model: z.object({ provider: z.string(), model: z.string() }),
    critic_findings: z
      .array(z.object({ paragraph: z.number().int(), sentence: z.string(), reason: z.string() }))
      .optional()
      .describe(
        "For a version the critic pass wrote: the sentences of the version it is based on that read as machine-written.",
      ),
    critic_model: z
      .object({ provider: z.string(), model: z.string() })
      .optional()
      .describe("The critic that found them, from another company than the author."),
    review: z
      .object({ status: z.literal("pending") })
      .optional()
      .describe(
        "Set when saving this cover letter queued the critic pass; poll the draft's review route.",
      ),
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

const reviewView = z
  .object({
    status: z.enum(["none", "pending", "done", "failed"]),
    outcome: z
      .enum(materialReviewOutcomes)
      .optional()
      .describe(
        "How a finished pass ended: `revised` saved a new version, `clean` found nothing to rewrite, `kept` kept the draft because the revision broke a citation rule; the rest made no change.",
      ),
    revision_id: savedApplicationMaterialIdSchema
      .optional()
      .describe("The version the pass saved, when it revised the letter."),
  })
  .meta({ id: "ApplicationMaterialReview" });

const documentQuery = z.strictObject({
  format: z.enum(applicationMaterialDocumentFormats).describe("Word (`docx`) or `pdf`."),
  template: z
    .enum(["classic", "compact", "modern"])
    .optional()
    .describe(
      `The CV template the document is drawn with; ${defaultApplicationMaterialTemplateId} by default.`,
    ),
});

const editBody = z
  .strictObject({
    items: z
      .array(
        z.strictObject({
          text: z.string().trim().min(1).max(maximumSavedApplicationMaterialItemCharacters),
        }),
      )
      .min(1)
      .max(maximumSavedApplicationMaterialItems)
      .describe("Every item's text, in the saved draft's order; one entry for each of its items."),
  })
  .meta({ id: "ApplicationMaterialEdit" });

/** A saved draft as the API shows it: its stored fields without the workspace and application. */
function viewOf(draft: SavedApplicationMaterial): z.infer<typeof draftView> {
  const { workspace_id: _workspace, application_id: _application, ...view } = draft;
  const sources = view.items.flatMap((item) => [
    ...item.citations.map((citation) => citation.text),
    ...(item.company_citations ?? []).map((citation) => citation.text),
  ]);
  return withTells({
    ...view,
    items: view.items.map((item) => {
      if (item.edited !== true) return item;
      const numbers = unsupportedNumbers(item.text, sources);
      return numbers.length === 0 ? item : { ...item, unsupported_numbers: numbers };
    }),
  });
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
  // A cover letter gets one critic pass on the worker when the deployment queues it and the
  // record's consent names the workspace's critic company, which must differ from the author's.
  const queueReview = async (
    saved: SavedApplicationMaterial,
    workspace: { readonly critic?: { readonly company: string } },
    recordId: string,
  ): Promise<boolean> => {
    const { reviews } = options;
    if (reviews === undefined || saved.kind !== "cover-letter") return false;
    const criticCompany = workspace.critic?.company;
    if (
      criticCompany === undefined ||
      criticCompany === saved.model.provider ||
      consents === undefined
    )
      return false;
    const consent = await consents.current(recordId);
    const permitted = permitsTransmission(consent, {
      author: { company: saved.model.provider },
      critic: { company: criticCompany },
    });
    if (!permitted) return false;
    return reviews.queue({
      workspaceId: saved.workspace_id,
      applicationId: saved.application_id,
      materialId: saved.id,
    });
  };

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
      const { facts, requirements, voice, usage } = await applicationMaterialRecordInput({
        service,
        root,
        briefId: brief?.briefId,
        writingSamples: options.writingSamples,
        factUsage: options.factUsage,
      });

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
        // The newest research brief, when the candidate ran one, gives facts about the employer.
        const [research] = (await options.researchBriefs?.list(workspaceId, applicationId)) ?? [];
        const companyFacts = research === undefined ? [] : researchCompanyFacts(research);
        const draft = await draftApplicationMaterial(writer, {
          kind: request.body.kind,
          ...(guidance === undefined ? {} : { guidance }),
          ...(voice === undefined ? {} : { voice }),
          facts,
          requirements,
          ...(usage === undefined ? {} : { usage }),
          language: application.language ?? workspace.language,
          ...(companyFacts.length === 0 ? {} : { companyFacts }),
        });
        const companyById = new Map(companyFacts.map((fact) => [fact.id, fact.text]));
        const usesResearch = draft.items.some((item) => (item.companyFactIds ?? []).length > 0);
        const byId = new Map(facts.map((fact) => [fact.id, fact]));
        request.log.info(
          {
            workspaceId,
            applicationId,
            kind: draft.kind,
            items: draft.items.length,
            guided: guidance !== undefined,
            companyFacts: companyFacts.length,
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
              return { fact_id: id, text: applicationMaterialFactText(fact) };
            }),
            ...((item.companyFactIds ?? []).length === 0
              ? {}
              : {
                  company_citations: (item.companyFactIds ?? []).map((id) => ({
                    finding_id: id,
                    text: companyById.get(id) ?? id,
                  })),
                }),
          })),
          ...(usesResearch && research !== undefined ? { research_brief_id: research.id } : {}),
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
        const reviewed = await queueReview(saved, workspace, recordId);
        return reply.send(
          reviewed ? { ...viewOf(saved), review: { status: "pending" } } : viewOf(saved),
        );
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

  app.get(
    "/v1/workspaces/:workspaceId/applications/:applicationId/material/:materialId/review",
    {
      schema: {
        summary: "Read where a saved cover letter's critic pass stands",
        description:
          "`pending` while the worker reviews the letter; `done` with its outcome once it ended, and `revision_id` when the pass saved a revised version; `failed` when the pass failed its retries, so the letter stands as drafted; `none` when no pass was queued. 404 when the application has no such draft.",
        params: draftParams,
        response: { 200: reviewView, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId, materialId } = request.params;
      const base = await drafts.get(workspaceId, materialId);
      if (base === undefined || base.application_id !== applicationId) {
        return reply.code(404).send(apiError("not_found", "There is no such saved draft."));
      }
      const state = await options.reviews?.state({ workspaceId, materialId });
      if (state === undefined) return reply.send({ status: "none" as const });
      if (state.status !== "done") return reply.send({ status: state.status });
      const revision =
        state.outcome === "revised"
          ? (await drafts.list(workspaceId, applicationId, { kind: base.kind })).find(
              (draft) => draft.based_on === base.id && draft.critic_findings !== undefined,
            )
          : undefined;
      return reply.send({
        status: "done" as const,
        outcome: state.outcome,
        ...(revision === undefined ? {} : { revision_id: revision.id }),
      });
    },
  );

  app.post(
    "/v1/workspaces/:workspaceId/applications/:applicationId/material/:materialId/versions",
    {
      schema: {
        summary: "Save the candidate's edit of a draft as a new version",
        description:
          "Copies the saved draft with the candidate's texts, marks each changed item as edited and keeps its citations. No model is called and the version costs nothing. A number no cited fact states is flagged in `unsupported_numbers`, not refused. 400 when the item count differs from the draft's; 404 when the application has no such draft.",
        params: draftParams,
        body: editBody,
        response: { 200: draftView, 400: apiErrorSchema, 404: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId, materialId } = request.params;
      const base = await drafts.get(workspaceId, materialId);
      if (base === undefined || base.application_id !== applicationId) {
        return reply.code(404).send(apiError("not_found", "There is no such saved draft."));
      }
      const texts = request.body.items.map((item) => item.text);
      if (texts.length !== base.items.length) {
        return reply
          .code(400)
          .send(
            apiError(
              "item_count_mismatch",
              `The draft has ${base.items.length} items; send one text for each.`,
            ),
          );
      }
      const items = base.items.map((item, index) => {
        const text = texts[index] as string;
        const edited = item.edited === true || text !== item.text;
        return { ...item, text, ...(edited ? { edited: true } : {}) };
      });
      const saved: SavedApplicationMaterial = {
        ...base,
        id: newMaterialId(),
        created_at: now().toISOString(),
        items,
        based_on: base.id,
        cost_usd: 0,
      };
      await drafts.insert(saved);
      request.log.info(
        {
          workspaceId,
          applicationId,
          materialId: saved.id,
          basedOn: base.id,
          edited: items.filter((item) => item.edited === true).length,
        },
        "application material edited",
      );
      return reply.send(viewOf(saved));
    },
  );

  app.get(
    "/v1/workspaces/:workspaceId/applications/:applicationId/material/:materialId/document",
    {
      schema: {
        summary: "Download a saved cover letter or question set as Word or PDF",
        description:
          "Draws the saved draft with a CV template, Modern by default, and answers the document as an attachment. A cover letter opens with the application's name; interview questions get one heading each. Nothing is stored. 404 when the application has no such draft.",
        params: draftParams,
        querystring: documentQuery,
        response: {
          200: z.any().describe("The document's bytes, in its media type."),
          404: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { workspaceId, applicationId, materialId } = request.params;
      const saved = await drafts.get(workspaceId, materialId);
      if (saved === undefined || saved.application_id !== applicationId) {
        return reply.code(404).send(apiError("not_found", "There is no such saved draft."));
      }
      const root = workspaceRoot(workspaceId);
      const [application, workspace] = await Promise.all([
        service.getApplication({ root, applicationId }),
        service.readWorkspace(root),
      ]);
      const { format, template } = request.query;
      const rendered = renderApplicationMaterialDocument(
        {
          id: saved.id,
          kind: saved.kind,
          title: application?.name ?? "",
          language: application?.language ?? workspace.language ?? "en",
          createdAt: saved.created_at,
          items: saved.items,
        },
        format,
        { templateId: template, generatedAt: saved.created_at },
      );
      request.log.info(
        {
          workspaceId,
          applicationId,
          materialId,
          format,
          template: rendered.metadata.renderingTemplate.id,
        },
        "application material document drawn",
      );
      return reply
        .code(200)
        .header("content-type", rendered.mimeType)
        .header(
          "content-disposition",
          `attachment; filename="${saved.kind}-${saved.created_at.slice(0, 10)}${rendered.extension}"`,
        )
        .header("cache-control", "private, no-store")
        .send(Buffer.from(rendered.content));
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
