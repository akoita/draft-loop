import type {
  ApplicationService,
  HostedKnowledgeIntake,
  HostedSensitivityRules,
  RunBudgetCeiling,
  UsageLine,
} from "@draft-loop/application";
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
import { apiError, sendError, sendNotFound } from "./errors.js";
import { registerExportRoutes } from "./export-routes.js";
import { createMemoryIdempotencyStore, type IdempotencyStore } from "./idempotency.js";
import { registerKnowledgeRoutes } from "./knowledge-routes.js";
import { isOwnerAuthorization } from "./owner-access.js";
import { registerReviewRoutes } from "./review-routes.js";
import { registerSensitivityRulesRoutes } from "./sensitivity-rules-routes.js";
import { registerUsageRoutes } from "./usage-routes.js";
import { contentSecurityPolicy, isPublicRequest, registerWebScreen } from "./web-screen.js";
import { type KnowledgeStoreAddress, registerWorkspaceRoutes } from "./workspace-routes.js";
import { registerWritingPolicyRoutes } from "./writing-policy-routes.js";

export interface ApiOptions {
  readonly ownerToken: string;
  readonly logger?: FastifyServerOptions["logger"];
  /** The application service and how to address its workspaces; without it only health is served. */
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
  };
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

  await app.register(helmet, { contentSecurityPolicy });
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: { title: "DraftLoop API", version: "1" },
      components: {
        securitySchemes: { ownerToken: { type: "http", scheme: "bearer" } },
      },
      security: [{ ownerToken: [] }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  app.addHook("onRequest", async (request, reply) => {
    if (isPublicRequest(request.routeOptions.url, request.url)) return;
    if (!isOwnerAuthorization(request.headers.authorization, options.ownerToken)) {
      await reply
        .code(401)
        .header("www-authenticate", "Bearer")
        .send(apiError("unauthorized", "A valid owner token is required."));
    }
  });

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

  if (options.application !== undefined) {
    const { knowledgeIntake, knowledgeStore } = options.application;
    // One store for every route, so a key is never replayed by another route's cache.
    const idempotency = options.application.idempotency ?? createMemoryIdempotencyStore();
    registerWorkspaceRoutes(app, {
      service: options.application.service,
      workspaceRoot: options.application.workspaceRoot,
      budgetCeiling: options.application.budgetCeiling,
      ...(knowledgeIntake === undefined || knowledgeStore === undefined
        ? {}
        : { knowledge: { intake: knowledgeIntake, store: knowledgeStore } }),
    });
    registerWritingPolicyRoutes(app, {
      service: options.application.service,
      workspaceRoot: options.application.workspaceRoot,
    });
    registerApplicationRoutes(app, {
      service: options.application.service,
      workspaceRoot: options.application.workspaceRoot,
      idempotency,
      enqueueRun: options.application.enqueueRun,
      budgetCeiling: options.application.budgetCeiling,
    });
    registerReviewRoutes(app, {
      service: options.application.service,
      workspaceRoot: options.application.workspaceRoot,
      idempotency,
      enqueueRun: options.application.enqueueRun,
    });
    registerExportRoutes(app, {
      service: options.application.service,
      workspaceRoot: options.application.workspaceRoot,
      idempotency,
    });
    registerUsageRoutes(app, {
      service: options.application.service,
      workspaceRoot: options.application.workspaceRoot,
      monthUsage: options.application.monthUsage,
    });
    if (options.application.knowledgeIntake !== undefined) {
      registerKnowledgeRoutes(app, { intake: options.application.knowledgeIntake });
    }
    if (options.application.sensitivityRules !== undefined) {
      registerSensitivityRulesRoutes(app, { rules: options.application.sensitivityRules });
    }
  }
  if (options.webRoot !== undefined) await registerWebScreen(app, options.webRoot);

  return app;
}
