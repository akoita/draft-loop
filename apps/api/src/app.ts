import {
  type ApplicationService,
  defaultHostedKnowledgeSourceMaxBytes,
  type HostedKnowledgeIntake,
  type HostedSensitivityRules,
  type RunBudgetCeiling,
  type UsageLine,
} from "@draft-loop/application";
import type { FactUsageService } from "@draft-loop/application/fact-usage";
import type { PreferenceSuggestions } from "@draft-loop/application/preference-suggestions";
import type { WorkJournalService } from "@draft-loop/application/work-journal";
import type { WritingSamplesService } from "@draft-loop/application/writing-samples";
import type { UrlFetcher } from "@draft-loop/ingestion";
import type { AgentTokenStore } from "@draft-loop/storage/agent-tokens";
import type { ConsentLedger } from "@draft-loop/storage/consent-ledger";
import type { MemberSettingsStore } from "@draft-loop/storage/member-settings";
import type { RecordArchives } from "@draft-loop/storage/record-archive";
import type { ResearchBriefStore } from "@draft-loop/storage/research-briefs";
import type { SavedApplicationMaterialStore } from "@draft-loop/storage/saved-application-material";
import type { TenantDirectory } from "@draft-loop/storage/tenant-directory";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import type { FastifySerializerCompiler } from "fastify/types/schema.js";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  ResponseSerializationError,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { type ZodType, z } from "zod";
import { registerAgentSpendGate } from "./agent-spend-gate.js";
import { registerAgentTokenRoutes } from "./agent-token-routes.js";
import { registerApplicationFileRoutes } from "./application-file-routes.js";
import { registerApplicationFolderRoutes } from "./application-folder-routes.js";
import { registerApplicationImportRoutes } from "./application-import-routes.js";
import { registerApplicationLifecycleRoutes } from "./application-lifecycle-routes.js";
import {
  type CoverLetterWriter,
  registerApplicationMaterialRoutes,
} from "./application-material-routes.js";
import { registerApplicationRoutes } from "./application-routes.js";
import { registerAuthConfigRoutes } from "./auth-config-routes.js";
import { type BetaSignUpOptions, registerBetaSignUpRoutes } from "./beta-sign-up-routes.js";
import {
  type BetaWaitlistRoutesOptions,
  registerBetaWaitlistRoutes,
} from "./beta-waitlist-routes.js";
import type { BriefExtractions } from "./brief-extraction.js";
import type { LiveInterviewSpeech } from "./career-interview-live.js";
import {
  type CareerInterviewParts,
  registerCareerInterviewRoutes,
} from "./career-interview-routes.js";
import { registerClientErrorRoutes } from "./client-error-routes.js";
import { registerConsentEnforcement } from "./consent-enforcement.js";
import { registerConsentRoutes } from "./consent-routes.js";
import { registerContentScreening } from "./content-screening-routes.js";
import type { HostedContentScreening } from "./content-screening-service.js";
import { registerMemberCreditsRoute, registerRunEstimateRoute } from "./credit-routes.js";
import { createEntitlementGate, type EntitlementGate } from "./entitlement-gate.js";
import { sendError, sendNotFound } from "./errors.js";
import { registerExportPreviewRoutes } from "./export-preview-routes.js";
import { registerExportRoutes } from "./export-routes.js";
import { registerFactUsageRoutes } from "./fact-usage-routes.js";
import { createMemoryIdempotencyStore, type IdempotencyStore } from "./idempotency.js";
import { type KnowledgeOwnership, registerKnowledgeAccess } from "./knowledge-access.js";
import { registerKnowledgeRoutes } from "./knowledge-routes.js";
import { registerKnowledgeSourceFileRoutes } from "./knowledge-source-file-routes.js";
import type { MaterialReviews } from "./material-reviews.js";
import { registerMemberSettingsRoutes } from "./member-settings-routes.js";
import { registerModelCallGate } from "./model-call-gate.js";
import { registerModelCatalogRoutes } from "./model-catalog-routes.js";
import { registerOperatorPlanRoutes } from "./operator-plan-routes.js";
import {
  type OrganisationActivityRecorder,
  registerOrganisationActivity,
} from "./organisation-activity.js";
import { registerOrganisationClosing } from "./organisation-closing.js";
import { registerOrganisationErasureRoutes } from "./organisation-erasure-routes.js";
import { registerOrganisationRoutes } from "./organisation-routes.js";
import { registerOwnerTokenKnowledge } from "./owner-token-knowledge.js";
import { registerOwnerTokenProofRoutes } from "./owner-token-proof-routes.js";
import { createPlanLimits } from "./plan-limits.js";
import { registerPreferenceSuggestionRoutes } from "./preference-suggestion-routes.js";
import {
  noProfileDerivations,
  type ProfileDerivations,
  registerProfileRoutes,
} from "./profile-routes.js";
import { type RateLimits, registerRateLimit } from "./rate-limit.js";
import { registerRecordAccess } from "./record-access.js";
import { registerRecordArchiveRoutes } from "./record-archive-routes.js";
import { registerRecordErasureRoutes } from "./record-erasure-routes.js";
import { registerRecordMemberRoutes } from "./record-member-routes.js";
import { type ApiAuthOptions, registerRequestAuthentication } from "./request-auth.js";
import { registerResearchBriefRoutes } from "./research-brief-routes.js";
import type { ResearchRuns } from "./research-runs.js";
import { registerReviewRoutes } from "./review-routes.js";
import { registerReviewStateRoutes } from "./review-state-routes.js";
import { registerSensitivityRulesRoutes } from "./sensitivity-rules-routes.js";
import { registerSpeechModelRoutes } from "./speech-model-routes.js";
import { registerTenantApplications, type TenantApplications } from "./tenant-context.js";
import { registerUsageRoutes } from "./usage-routes.js";
import { contentSecurityPolicy, registerWebScreen } from "./web-screen.js";
import { registerWorkJournalRoutes, type SourceEvidenceKinds } from "./work-journal-routes.js";
import { type KnowledgeStoreAddress, registerWorkspaceRoutes } from "./workspace-routes.js";
import { registerWritingPolicyRoutes } from "./writing-policy-routes.js";
import { registerWritingSamplesRoutes } from "./writing-samples-routes.js";

export interface ApiOptions {
  /** The owner's token: the only credential in owner mode, the operator's in sign-in mode. */
  readonly ownerToken: string;
  /** How requests are authenticated; owner mode when unset. */
  readonly auth?: ApiAuthOptions;
  readonly logger?: FastifyServerOptions["logger"];
  /** Request limits per source address (#2145); the server always passes them, tests may not. */
  readonly rateLimits?: RateLimits;
  /**
   * One tenant's application service and how to address its workspaces, served to every caller;
   * without it or `tenants` only health is served.
   */
  readonly application?: {
    readonly service: ApplicationService;
    readonly workspaceRoot: (workspaceId: string) => string;
    readonly idempotency?: IdempotencyStore;
    /** Queues a begun run for the workers, such as the run queue bound to the deployment's tenant. */
    readonly enqueueRun: (workspaceId: string, runId: string) => Promise<void>;
    /** The most one run may spend; a workspace whose budget is higher cannot begin one. */
    readonly budgetCeiling: RunBudgetCeiling;
    /** The tenant's completed calls in a `YYYY-MM` month, grouped by company, model and route. */
    readonly monthUsage: (month: string) => Promise<readonly UsageLine[]>;
    /** The tenant's knowledge intake; without it the knowledge routes are not served. */
    readonly knowledgeIntake?: HostedKnowledgeIntake;
    /** The tenant's one knowledge store, as workspaces select from it; set with the intake. */
    readonly knowledgeStore?: KnowledgeStoreAddress;
    /** The tenant's knowledge bases' sensitivity rules; without them those routes are not served. */
    readonly sensitivityRules?: HostedSensitivityRules;
    /** Each candidate record's consent ledger; without it the consent routes are not served. */
    readonly consents?: ConsentLedger;
    /** Each candidate record's archive; without it the archive route is not served. */
    readonly recordArchives?: RecordArchives;
    /**
     * The tenant's injection screening (ADR 0011, phase 2d): intake screens job sources and
     * uploads, a run refuses quarantined material and the release route is served. Without it
     * none of that happens.
     */
    readonly contentScreening?: HostedContentScreening;
    /** The worker's extraction of live briefs; without it a live brief is left for the person. */
    readonly briefExtractions?: BriefExtractions;
    /**
     * Replaces the pinned job page fetcher, such as with the separate page fetcher; it must keep
     * the same address checks.
     */
    readonly jobPageFetcher?: UrlFetcher;
    /** The worker's derivation of career profiles; without it a derivation start answers 503. */
    readonly profileDerivations?: ProfileDerivations;
    /**
     * The tenant's work journal (#2018); without it the work journal routes are not served. Only
     * owner-token mode serves them until sign-in mode records the intake as a consent.
     */
    readonly workJournal?: WorkJournalService;
    /** The tenant's evidence-kind overrides; approving a note needs them with the intake. */
    readonly sourceEvidenceKinds?: SourceEvidenceKinds;
    /** The guided career interview (#1030); without it those routes are not served. */
    readonly careerInterview?: CareerInterviewParts;
    /** Saved cover letters and interview questions (#2477); without them drafts are not kept. */
    readonly applicationMaterialDrafts?: SavedApplicationMaterialStore;
    /** The worker's critic pass on saved cover letters (#2525); without it none runs. */
    readonly materialReviews?: MaterialReviews;
    /** Research briefs kept with each application (#2542); without them those routes are not served. */
    readonly researchBriefs?: ResearchBriefStore;
    /** The worker's research runs the candidate approves (#2560); without them none is queued. */
    readonly researchRuns?: ResearchRuns;
    /** Writing preferences suggested from review choices (#2253); without it those routes are not served. */
    readonly preferenceSuggestions?: PreferenceSuggestions;
    /** Where each career fact may be used (#2259); without it those routes are not served. */
    readonly factUsage?: FactUsageService;
    /** The candidate's writing samples (#2513); without them those routes are not served. */
    readonly writingSamples?: WritingSamplesService;
  };
  /**
   * The owner's agent tokens with one fixed `application` (#2159); with `tenants`, the owner
   * tenant's through `agentTokensFor`. Owner mode only; without them agent tokens are refused.
   */
  readonly agentTokens?: AgentTokenStore;
  /** Serves each request from its caller's tenant instead of one fixed `application`. */
  readonly tenants?: TenantApplications;
  /**
   * The organisations and their members; without it the `/v1/me`, organisation and operator
   * routes are not served. The server opens it with per-request tenancy (#1591).
   */
  readonly directory?: TenantDirectory;
  /** The public beta's invite codes and account cap (#2502); unset, those routes are not served. */
  readonly betaInvites?: Pick<BetaSignUpOptions, "invites" | "cap">;
  /**
   * The beta waitlist; without it `/v1/waitlist` and its operator routes are absent (#2566).
   * With it, the auth config tells the signed-out screen to show the landing page (#2567).
   */
  readonly betaWaitlist?: BetaWaitlistRoutesOptions["waitlist"];
  /** When each organisation was last active (#2538); unset, activity is not recorded. */
  readonly organisationActivity?: OrganisationActivityRecorder;
  /** Each member's own settings, such as the screen language; without it those routes are not served. */
  readonly memberSettings?: MemberSettingsStore;
  /** The built web screen's directory, served at `/`; without it no page is served. */
  readonly webRoot?: string;
  /** Where the pinned speech model's files are (#2199); unset, its manifest says unavailable. */
  readonly speechModelRoot?: string;
  /** The models the deployment's local endpoint serves (ADR 0011, D5); none when unset. */
  readonly localModels?: readonly string[];
  /** Speech for the live career interview (#2361); unset, the live route is not served. */
  readonly liveSpeech?: LiveInterviewSpeech;
  /** How cover letters are written (#2586); cited paragraphs when unset. */
  readonly coverLetterWriter?: CoverLetterWriter;
}

/** Request bodies above this are refused before parsing; job posts and briefs fit well inside. */
export const apiBodyLimitBytes = 1_048_576;

const healthSchema = z.object({ status: z.literal("ok") }).meta({ id: "Health" });

/**
 * Responses are checked by parsing them against their schema. The provider's own serializer
 * encodes instead, which refuses the one-way transforms that shared schemas use to normalize
 * values, such as lower-casing checksums.
 */
const serializerCompiler: FastifySerializerCompiler<ZodType> =
  ({ schema, method, url }) =>
  (data) => {
    const result = schema.safeParse(data);
    if (!result.success) throw new ResponseSerializationError(method, url, { cause: result.error });
    return JSON.stringify(result.data);
  };

/**
 * Builds the hosted API (ADR 0011, D10): a thin Fastify adapter whose routes are typed by Zod
 * schemas, from which the OpenAPI document is generated.
 */
export async function buildApi(options: ApiOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: apiBodyLimitBytes,
    // Cloud Run's front end terminates TLS; the API is never reached directly.
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(sendError);
  app.setNotFoundHandler(sendNotFound);

  const auth: ApiAuthOptions = options.auth ?? { mode: "owner" };
  await app.register(helmet, { contentSecurityPolicy: contentSecurityPolicy(auth) });
  // The live career interview streams audio both ways over one WebSocket per conversation.
  if (options.liveSpeech !== undefined) {
    await app.register(websocket, { options: { maxPayload: 1_048_576 } });
  }
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "DraftLoop API", version: "1" },
      components: {
        securitySchemes: {
          ownerToken: {
            type: "http",
            scheme: "bearer",
            description:
              "The owner's token, or in sign-in mode an access token from the identity provider.",
          },
        },
      },
      security: [{ ownerToken: [] }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  const ownerTenantId = options.tenants?.ownerTenantId;
  const agentTokens =
    auth.mode === "oidc"
      ? undefined
      : (options.agentTokens ??
        (ownerTenantId === undefined
          ? undefined
          : options.tenants?.agentTokensFor?.(ownerTenantId)));
  if (options.rateLimits !== undefined) registerRateLimit(app, options.rateLimits);
  registerRequestAuthentication(app, options.ownerToken, auth, agentTokens);
  const recordActivity =
    options.organisationActivity === undefined
      ? undefined
      : registerOrganisationActivity(app, { activity: options.organisationActivity });
  // Before any route, so every route registered below is counted where it calls a model.
  if (auth.mode === "oidc" && options.tenants?.entitlementsFor !== undefined) {
    registerModelCallGate(app, { entitlementsFor: options.tenants.entitlementsFor });
  }

  app.get(
    "/v1/health",
    {
      schema: {
        summary: "Report that the API is serving",
        security: [],
        response: { 200: healthSchema },
      },
    },
    async () => ({ status: "ok" as const }),
  );
  registerAuthConfigRoutes(app, auth, options.betaWaitlist !== undefined);
  registerClientErrorRoutes(app);
  registerOwnerTokenProofRoutes(app, options.ownerToken);

  app.get(
    "/v1/openapi.json",
    {
      schema: {
        summary: "The OpenAPI document generated from the route schemas",
        hide: true,
      },
    },
    async () => app.swagger(),
  );

  if (options.application !== undefined && options.tenants !== undefined) {
    throw new Error("Serve either one application or the callers' tenants, not both.");
  }
  const application =
    options.tenants === undefined
      ? options.application
      : registerTenantApplications(app, options.tenants);
  const erasureFor = options.tenants?.erasureFor;
  if (erasureFor !== undefined) {
    // Before every route, so a closing organisation is refused whatever the route.
    registerOrganisationClosing(app, {
      erasureFor,
      ...(options.tenants?.ownerTenantId === undefined
        ? {}
        : { ownerTenantId: options.tenants.ownerTenantId }),
    });
  }
  const recordAccessFor = options.tenants?.recordAccessFor;
  if (application !== undefined && auth.mode === "oidc" && recordAccessFor === undefined) {
    throw new Error("Sign-in mode serves workspaces only with candidate record access.");
  }
  if (application !== undefined && recordAccessFor !== undefined) {
    // Before the workspace routes, so its hooks run for each of them.
    registerRecordAccess(app, {
      recordAccessFor,
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      ...(options.tenants?.ownerTenantId === undefined
        ? {}
        : { ownerTenantId: options.tenants.ownerTenantId }),
    });
    if (options.directory !== undefined) {
      registerRecordMemberRoutes(app, {
        recordAccessFor,
        directory: options.directory,
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        ...(options.tenants?.ownerTenantId === undefined
          ? {}
          : { ownerTenantId: options.tenants.ownerTenantId }),
      });
    }
  }
  if (application !== undefined && erasureFor !== undefined) {
    // Before the workspace routes, so a record being erased is missing for each of them.
    registerRecordErasureRoutes(app, {
      erasureFor,
      ...(options.tenants?.ownerTenantId === undefined
        ? {}
        : { ownerTenantId: options.tenants.ownerTenantId }),
    });
  }
  const knowledgeOwnersFor = options.tenants?.knowledgeOwnersFor;
  if (application !== undefined && auth.mode === "oidc" && knowledgeOwnersFor === undefined) {
    throw new Error("Sign-in mode serves knowledge bases only with their owning records.");
  }
  let knowledgeOwnership: KnowledgeOwnership | undefined;
  if (
    application !== undefined &&
    auth.mode === "oidc" &&
    recordAccessFor !== undefined &&
    knowledgeOwnersFor !== undefined
  ) {
    // After record access, so a selection's workspace is checked before its bases.
    knowledgeOwnership = registerKnowledgeAccess(app, {
      knowledgeOwnersFor,
      recordAccessFor,
      service: application.service,
      workspaceRoot: application.workspaceRoot,
    });
  } else if (
    application !== undefined &&
    knowledgeOwnersFor !== undefined &&
    options.tenants?.ownerTenantId !== undefined
  ) {
    knowledgeOwnership = registerOwnerTokenKnowledge(
      app,
      knowledgeOwnersFor(options.tenants.ownerTenantId),
    );
  }
  if (application !== undefined && auth.mode === "oidc" && knowledgeOwnersFor !== undefined) {
    if (application.consents === undefined) {
      throw new Error("Sign-in mode stores material and calls providers only with consent.");
    }
    // Before the routes it guards, whose registration attaches its checks.
    registerConsentEnforcement(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      consents: application.consents,
      knowledgeOwnersFor,
      ...(application.knowledgeIntake === undefined
        ? {}
        : { knowledgeIntake: application.knowledgeIntake }),
    });
  }
  let entitlementGate: EntitlementGate | undefined;
  if (application !== undefined && auth.mode === "oidc") {
    const entitlementsFor = options.tenants?.entitlementsFor;
    if (entitlementsFor === undefined) {
      throw new Error("Sign-in mode starts runs only against the organisation's plan and credits.");
    }
    entitlementGate = createEntitlementGate({ service: application.service, entitlementsFor });
  }
  // Sign-in mode only: owner-token mode has no organisation to hold a plan.
  const entitlementsFor = options.tenants?.entitlementsFor;
  const planLimits =
    auth.mode === "oidc" && entitlementsFor !== undefined
      ? createPlanLimits({
          entitlementsFor,
          ...(recordAccessFor === undefined ? {} : { recordAccessFor }),
        })
      : undefined;
  if (application !== undefined) {
    const { knowledgeIntake, knowledgeStore } = application;
    // One store for every route, so a key is never replayed by another route's cache.
    const idempotency = application.idempotency ?? createMemoryIdempotencyStore();
    // Before the routes, so a start an agent token makes is held to its monthly cap (#2599).
    const agentSpend =
      agentTokens === undefined
        ? undefined
        : registerAgentSpendGate(app, {
            tokens: agentTokens,
            service: application.service,
            workspaceRoot: application.workspaceRoot,
            budgetCeiling: application.budgetCeiling,
          });
    const screening =
      application.contentScreening === undefined
        ? undefined
        : registerContentScreening(app, {
            service: application.service,
            workspaceRoot: application.workspaceRoot,
            screening: application.contentScreening,
            authMode: auth.mode,
            ...(application.consents === undefined ? {} : { consents: application.consents }),
            ...(knowledgeIntake === undefined ? {} : { knowledgeIntake }),
            ...(knowledgeOwnersFor === undefined ? {} : { knowledgeOwnersFor }),
            ...(options.tenants?.ownerTenantId === undefined
              ? {}
              : { ownerTenantId: options.tenants.ownerTenantId }),
          });
    registerWorkspaceRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      budgetCeiling: application.budgetCeiling,
      ...(options.localModels === undefined ? {} : { localModels: options.localModels }),
      ...(planLimits === undefined ? {} : { planLimits }),
      ...(knowledgeIntake === undefined || knowledgeStore === undefined
        ? {}
        : { knowledge: { intake: knowledgeIntake, store: knowledgeStore } }),
    });
    registerWritingPolicyRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
    });
    if (application.preferenceSuggestions !== undefined) {
      registerPreferenceSuggestionRoutes(app, {
        suggestions: application.preferenceSuggestions,
        workspaceRoot: application.workspaceRoot,
      });
    }
    if (application.writingSamples !== undefined) {
      registerWritingSamplesRoutes(app, {
        writingSamples: application.writingSamples,
        workspaceRoot: application.workspaceRoot,
      });
    }
    if (application.factUsage !== undefined) {
      registerFactUsageRoutes(app, {
        factUsage: application.factUsage,
        workspaceRoot: application.workspaceRoot,
      });
    }
    registerRunEstimateRoute(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      ...(agentSpend === undefined ? {} : { agentSpend }),
      ...(auth.mode === "oidc" && entitlementsFor !== undefined ? { entitlementsFor } : {}),
    });
    registerApplicationRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      idempotency,
      enqueueRun: application.enqueueRun,
      budgetCeiling: application.budgetCeiling,
      ...(screening === undefined ? {} : { screening }),
      ...(entitlementGate === undefined ? {} : { entitlementGate }),
      ...(application.briefExtractions === undefined
        ? {}
        : { briefExtractions: application.briefExtractions }),
      ...(application.jobPageFetcher === undefined
        ? {}
        : { jobPageFetcher: application.jobPageFetcher }),
    });
    registerProfileRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      derivations: application.profileDerivations ?? noProfileDerivations,
    });
    registerModelCatalogRoutes(
      app,
      options.localModels === undefined ? {} : { localModels: options.localModels },
    );
    registerApplicationLifecycleRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
    });
    registerApplicationFolderRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
    });
    // A desktop import writes history as it was recorded, so only the one owner may send one.
    if (auth.mode !== "oidc") {
      registerApplicationImportRoutes(app, {
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        ...(screening === undefined ? {} : { screening }),
      });
    }
    registerApplicationFileRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      maxBytes: knowledgeIntake?.maxSourceBytes ?? defaultHostedKnowledgeSourceMaxBytes,
    });
    registerReviewRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      idempotency,
      enqueueRun: application.enqueueRun,
    });
    registerReviewStateRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      ...(knowledgeIntake === undefined ? {} : { knowledgeIntake }),
    });
    registerExportRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      idempotency,
    });
    registerExportPreviewRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
    });
    registerUsageRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      monthUsage: application.monthUsage,
    });
    if (application.knowledgeIntake !== undefined) {
      registerKnowledgeRoutes(app, {
        intake: application.knowledgeIntake,
        ...(knowledgeOwnership === undefined ? {} : { ownership: knowledgeOwnership }),
        ...(screening === undefined ? {} : { screening }),
        ...(application.sensitivityRules === undefined
          ? {}
          : { sensitivityRules: application.sensitivityRules }),
      });
    }
    if (application.knowledgeIntake !== undefined) {
      registerKnowledgeSourceFileRoutes(app, {
        intake: application.knowledgeIntake,
        ...(screening === undefined ? {} : { screening }),
      });
    }
    if (application.sensitivityRules !== undefined) {
      registerSensitivityRulesRoutes(app, { rules: application.sensitivityRules });
    }
    if (application.consents !== undefined) {
      registerConsentRoutes(app, {
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        consents: application.consents,
      });
    }
    if (application.workJournal !== undefined && auth.mode !== "oidc") {
      registerWorkJournalRoutes(app, {
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        journal: application.workJournal,
        idempotency,
        agentTokens: agentTokens !== undefined,
        ...(knowledgeIntake === undefined ||
        application.sensitivityRules === undefined ||
        application.sourceEvidenceKinds === undefined
          ? {}
          : {
              knowledge: {
                intake: knowledgeIntake,
                rules: application.sensitivityRules,
                evidenceKinds: application.sourceEvidenceKinds,
              },
            }),
        ...(screening === undefined ? {} : { screening }),
      });
    }
    if (application.careerInterview !== undefined) {
      registerCareerInterviewRoutes(app, {
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        interview: application.careerInterview,
        ...(application.consents === undefined ? {} : { consents: application.consents }),
        ...(knowledgeIntake === undefined ||
        application.sensitivityRules === undefined ||
        application.sourceEvidenceKinds === undefined
          ? {}
          : {
              knowledge: {
                intake: knowledgeIntake,
                rules: application.sensitivityRules,
                evidenceKinds: application.sourceEvidenceKinds,
              },
            }),
        ...(screening === undefined ? {} : { screening }),
        ...(options.liveSpeech === undefined ? {} : { live: options.liveSpeech }),
      });
    }
    if (application.careerInterview !== undefined) {
      // Drafting application material uses the career interview's Claude route and ceiling.
      const interview = application.careerInterview;
      registerApplicationMaterialRoutes(app, {
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        material: {
          get route() {
            return interview.route;
          },
          get allowProviderData() {
            return interview.allowProviderData;
          },
          ...(options.coverLetterWriter === undefined
            ? {}
            : { coverLetterWriter: options.coverLetterWriter }),
        },
        ...(application.consents === undefined ? {} : { consents: application.consents }),
        ...(screening === undefined ? {} : { screening }),
        ...(application.factUsage === undefined ? {} : { factUsage: application.factUsage }),
        ...(application.writingSamples === undefined
          ? {}
          : { writingSamples: application.writingSamples }),
        ...(application.applicationMaterialDrafts === undefined
          ? {}
          : { drafts: application.applicationMaterialDrafts }),
        ...(application.materialReviews === undefined
          ? {}
          : { reviews: application.materialReviews }),
        ...(application.researchBriefs === undefined
          ? {}
          : { researchBriefs: application.researchBriefs }),
      });
    }
    if (application.researchBriefs !== undefined) {
      registerResearchBriefRoutes(app, {
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        briefs: application.researchBriefs,
        ...(application.researchRuns === undefined ? {} : { runs: application.researchRuns }),
      });
    }
    if (application.workJournal !== undefined && agentTokens !== undefined) {
      registerAgentTokenRoutes(app, {
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        tokens: agentTokens,
      });
    }
    if (application.recordArchives !== undefined) {
      registerRecordArchiveRoutes(app, {
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        archives: application.recordArchives,
        knowledgeScope: auth.mode === "oidc" ? "owned" : "tenant",
      });
    }
  }
  if (options.memberSettings !== undefined) {
    registerMemberSettingsRoutes(app, { memberSettings: options.memberSettings });
  }
  if (options.directory !== undefined) {
    registerOrganisationRoutes(app, {
      directory: options.directory,
      ...(planLimits === undefined ? {} : { planLimits }),
    });
  }
  if (entitlementsFor !== undefined) {
    registerMemberCreditsRoute(app, { entitlementsFor, signIn: auth.mode === "oidc" });
  }
  if (erasureFor !== undefined) {
    registerOrganisationErasureRoutes(app, {
      erasureFor,
      ...(options.tenants?.ownerTenantId === undefined
        ? {}
        : { ownerTenantId: options.tenants.ownerTenantId }),
    });
  }
  if (options.tenants?.operatorFor !== undefined) {
    registerOperatorPlanRoutes(app, { operatorFor: options.tenants.operatorFor });
  }
  if (options.betaInvites !== undefined) {
    const operatorFor = options.tenants?.operatorFor;
    registerBetaSignUpRoutes(app, {
      ...options.betaInvites,
      ...(auth.mode === "oidc" ? { resolveSignIn: auth.resolveSignIn } : {}),
      ...(recordActivity === undefined ? {} : { recordActivity }),
      ...(operatorFor === undefined
        ? {}
        : {
            assignBetaPlan: async (organisationId: string, at: Date) => {
              await operatorFor(organisationId).plans.assignPlan({
                planId: "beta",
                periodStart: at.toISOString().slice(0, 10),
                assignedAt: at.toISOString(),
              });
            },
          }),
    });
  }
  if (options.betaWaitlist !== undefined) {
    registerBetaWaitlistRoutes(app, { waitlist: options.betaWaitlist });
  }
  registerSpeechModelRoutes(app, { root: options.speechModelRoot });
  if (options.webRoot !== undefined) await registerWebScreen(app, options.webRoot);

  return app;
}
