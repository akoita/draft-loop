import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, sendError, sendNotFound } from "./errors.js";
import { isOwnerAuthorization } from "./owner-access.js";

export interface ApiOptions {
  readonly ownerToken: string;
  readonly logger?: FastifyServerOptions["logger"];
}

/** Request bodies above this are refused before parsing; job posts and briefs fit well inside. */
export const apiBodyLimitBytes = 1_048_576;

const publicRoutes = new Set(["/v1/health"]);

const healthSchema = z.object({ status: z.literal("ok") }).meta({ id: "Health" });

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

  await app.register(helmet);
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
    if (request.routeOptions.url !== undefined && publicRoutes.has(request.routeOptions.url))
      return;
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

  return app;
}
