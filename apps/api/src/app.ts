import type {
  ApplicationService,
  HostedKnowledgeIntake,
  HostedSensitivityRules,
  RunBudgetCeiling,
  UsageLine,
} from "@draft-loop/application";
import type { ConsentLedger } from "@draft-loop/storage/consent-ledger";
import type { RecordArchives } from "@draft-loop/storage/record-archive";
import type { TenantDirectory } from "@draft-loop/storage/tenant-directory";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
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

import { registerApplicationRoutes } from "./application-routes.js";
import { registerAuthConfigRoutes } from "./auth-config-routes.js";
import { registerConsentEnforcement } from "./consent-enforcement.js";
import { registerConsentRoutes } from "./consent-routes.js";
import { registerContentScreening } from "./content-screening-routes.js";
import type { HostedContentScreening } from "./content-screening-service.js";
import { sendError, sendNotFound } from "./errors.js";
import { registerExportRoutes } from "./export-routes.js";
import { createMemoryIdempotencyStore, type IdempotencyStore } from "./idempotency.js";
import { type KnowledgeOwnership, registerKnowledgeAccess } from "./knowledge-access.js";
import { registerKnowledgeRoutes } from "./knowledge-routes.js";
import { registerOrganisationClosing } from "./organisation-closing.js";
import { registerOrganisationErasureRoutes } from "./organisation-erasure-routes.js";
import { registerOrganisationRoutes } from "./organisation-routes.js";
import { registerRecordAccess } from "./record-access.js";
import { registerRecordArchiveRoutes } from "./record-archive-routes.js";
import { registerRecordErasureRoutes } from "./record-erasure-routes.js";
import { registerRecordMemberRoutes } from "./record-member-routes.js";
import { type ApiAuthOptions, registerRequestAuthentication } from "./request-auth.js";
import { registerReviewRoutes } from "./review-routes.js";
import { registerSensitivityRulesRoutes } from "./sensitivity-rules-routes.js";
import { registerTenantApplications, type TenantApplications } from "./tenant-context.js";
import { registerUsageRoutes } from "./usage-routes.js";
import { contentSecurityPolicy, registerWebScreen } from "./web-screen.js";
import { type KnowledgeStoreAddress, registerWorkspaceRoutes } from "./workspace-routes.js";
import { registerWritingPolicyRoutes } from "./writing-policy-routes.js";

export interface ApiOptions {
  /** The owner's token: the only credential in owner mode, the operator's in sign-in mode. */
  readonly ownerToken: string;
  /** How requests are authenticated; owner mode when unset. */
  readonly auth?: ApiAuthOptions;
  readonly logger?: FastifyServerOptions["logger"];
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
  };
  /** Serves each request from its caller's tenant instead of one fixed `application`. */
  readonly tenants?: TenantApplications;
  /**
   * The organisations and their members; without it the `/v1/me`, organisation and operator
   * routes are not served. The server opens it with per-request tenancy (#1591).
   */
  readonly directory?: TenantDirectory;
  /** The built web screen's directory, served at `/`; without it no page is served. */
  readonly webRoot?: string;
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

  registerRequestAuthentication(app, options.ownerToken, auth);

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
  registerAuthConfigRoutes(app, auth);

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
  if (application !== undefined) {
    const { knowledgeIntake, knowledgeStore } = application;
    // One store for every route, so a key is never replayed by another route's cache.
    const idempotency = application.idempotency ?? createMemoryIdempotencyStore();
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
      ...(knowledgeIntake === undefined || knowledgeStore === undefined
        ? {}
        : { knowledge: { intake: knowledgeIntake, store: knowledgeStore } }),
    });
    registerWritingPolicyRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
    });
    registerApplicationRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      idempotency,
      enqueueRun: application.enqueueRun,
      budgetCeiling: application.budgetCeiling,
      ...(screening === undefined ? {} : { screening }),
    });
    registerReviewRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      idempotency,
      enqueueRun: application.enqueueRun,
    });
    registerExportRoutes(app, {
      service: application.service,
      workspaceRoot: application.workspaceRoot,
      idempotency,
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
    if (application.recordArchives !== undefined) {
      registerRecordArchiveRoutes(app, {
        service: application.service,
        workspaceRoot: application.workspaceRoot,
        archives: application.recordArchives,
        knowledgeScope: auth.mode === "oidc" ? "owned" : "tenant",
      });
    }
  }
  if (options.directory !== undefined) {
    registerOrganisationRoutes(app, { directory: options.directory });
  }
  if (erasureFor !== undefined) registerOrganisationErasureRoutes(app, { erasureFor });
  if (options.webRoot !== undefined) await registerWebScreen(app, options.webRoot);

  return app;
}
