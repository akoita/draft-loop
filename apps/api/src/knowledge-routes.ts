import {
  type HostedKnowledgeIntake,
  type HostedKnowledgeSourceView,
  hostedKnowledgeSourceMediaTypes,
} from "@draft-loop/application";
import type { CandidateKnowledgeBaseRecord } from "@draft-loop/storage";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import { apiError, apiErrorSchema } from "./errors.js";

export interface KnowledgeRoutesOptions {
  /** The tenant's knowledge intake, bound to its one store and its blob prefix. */
  readonly intake: HostedKnowledgeIntake;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const knowledgeBaseParams = z.strictObject({ knowledgeBaseId: identifierSchema });

/** A file's name to show; never a path, so no separators and no control characters. */
const uploadQuery = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(200)
    .refine(
      (name) => ![...name].some((character) => character < " " || "\u007f/\\".includes(character)),
      "must be a file name without a path",
    )
    .describe("The file's name, shown in source lists and evidence references."),
});

const createKnowledgeBaseBody = z.strictObject({
  displayName: z.string().trim().min(1).max(200),
  description: z.string().max(2_000).optional(),
});

export const knowledgeBaseViewSchema = z
  .object({
    id: z.string(),
    displayName: z.string(),
    description: z.string(),
    state: z.string(),
    createdAt: z.string(),
    archivedAt: z.string().nullable(),
  })
  .meta({ id: "KnowledgeBase" });

function knowledgeBaseView(record: CandidateKnowledgeBaseRecord) {
  return {
    id: record.id,
    displayName: record.displayName,
    description: record.description,
    state: record.state,
    createdAt: record.createdAt,
    archivedAt: record.archivedAt,
  };
}

export const knowledgeSourceViewSchema = z
  .object({
    id: z.string(),
    knowledgeBaseId: z.string(),
    displayName: z.string(),
    kind: z.string(),
    versionId: z.string(),
    mediaType: z.string(),
    sizeBytes: z.number().int(),
    checksum: z.string().describe("Lowercase hex SHA-256 of the file."),
    createdAt: z.string().describe("When this version of the source was added."),
  })
  .meta({ id: "KnowledgeSource" });

/** A source's identity and its latest file's metadata; never its content or where it is stored. */
export function knowledgeSourceView({ source, latestVersion }: HostedKnowledgeSourceView) {
  return {
    id: source.id,
    knowledgeBaseId: source.knowledgeBaseId,
    displayName: source.displayName,
    kind: source.kind,
    versionId: latestVersion.id,
    mediaType: latestVersion.mediaType,
    sizeBytes: latestVersion.sizeBytes,
    checksum: latestVersion.checksum,
    createdAt: latestVersion.createdAt,
  };
}

/**
 * The tenant's knowledge bases and their sources (ADR 0011, D11). The tenant's one store is created
 * with its first knowledge base; a client never names a store or a storage location.
 */
export function registerKnowledgeRoutes(
  parent: FastifyInstance,
  options: KnowledgeRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { intake } = options;

  app.post(
    "/v1/knowledge-bases",
    {
      schema: {
        summary: "Create a knowledge base for candidate sources",
        body: createKnowledgeBaseBody,
        response: { 201: knowledgeBaseViewSchema, 400: apiErrorSchema },
      },
    },
    async (request, reply) => {
      const { displayName, description } = request.body;
      const record = await intake.createKnowledgeBase({
        displayName,
        ...(description === undefined ? {} : { description }),
      });
      return reply.code(201).send(knowledgeBaseView(record));
    },
  );

  app.get(
    "/v1/knowledge-bases",
    {
      schema: {
        summary: "List the tenant's knowledge bases",
        response: { 200: z.object({ knowledgeBases: z.array(knowledgeBaseViewSchema) }) },
      },
    },
    async () => ({ knowledgeBases: (await intake.listKnowledgeBases()).map(knowledgeBaseView) }),
  );

  app.get(
    "/v1/knowledge-bases/:knowledgeBaseId/sources",
    {
      schema: {
        summary: "List a knowledge base's sources with their latest file's metadata",
        params: knowledgeBaseParams,
        response: {
          200: z.object({ sources: z.array(knowledgeSourceViewSchema) }),
          400: apiErrorSchema,
          404: apiErrorSchema,
        },
      },
    },
    async (request) => ({
      sources: (await intake.listSources(request.params.knowledgeBaseId)).map(knowledgeSourceView),
    }),
  );

  // The upload's own parsers live in a child context, so every other route keeps parsing JSON.
  void app.register(async (scope) => {
    const upload = scope.withTypeProvider<ZodTypeProvider>();
    upload.removeAllContentTypeParsers();
    upload.addContentTypeParser(
      [...hostedKnowledgeSourceMediaTypes],
      { parseAs: "buffer", bodyLimit: intake.maxSourceBytes },
      (_request, body, done) => done(null, body),
    );
    upload.post(
      "/v1/knowledge-bases/:knowledgeBaseId/sources",
      {
        bodyLimit: intake.maxSourceBytes,
        schema: {
          summary: "Upload a candidate source file",
          description: `Send the file itself as the request body, with its media type as the Content-Type: ${hostedKnowledgeSourceMediaTypes.join(", ")}. The type is checked against the file's signature; the file is stored, never parsed here. The same bytes in the same knowledge base answer 200 with the existing source, so a retry is safe.`,
          consumes: [...hostedKnowledgeSourceMediaTypes],
          params: knowledgeBaseParams,
          querystring: uploadQuery,
          body: z.unknown().meta({ type: "string", format: "binary" }),
          response: {
            200: knowledgeSourceViewSchema,
            201: knowledgeSourceViewSchema,
            400: apiErrorSchema,
            404: apiErrorSchema,
            413: apiErrorSchema,
            415: apiErrorSchema,
          },
        },
      },
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body)) {
          return reply
            .code(415)
            .send(apiError("unsupported_media_type", "Send the file as the request body."));
        }
        const mediaType = (request.headers["content-type"] ?? "").split(";")[0]?.trim() ?? "";
        const added = await intake.addFileSource({
          knowledgeBaseId: request.params.knowledgeBaseId,
          displayName: request.query.name,
          mediaType: mediaType.toLowerCase(),
          bytes: new Uint8Array(request.body),
        });
        return reply.code(added.created ? 201 : 200).send(knowledgeSourceView(added));
      },
    );
  });
}
