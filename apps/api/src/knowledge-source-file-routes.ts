import type { HostedKnowledgeIntake } from "@draft-loop/application";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import type { ContentScreeningHooks } from "./content-screening-routes.js";
import { apiError, apiErrorSchema } from "./errors.js";

export interface KnowledgeSourceFileRoutesOptions {
  readonly intake: Pick<HostedKnowledgeIntake, "readSourceFile">;
  /** Injection screening; without it no file is quarantined, so none is withheld. */
  readonly screening?: Pick<ContentScreeningHooks, "withholdsDownload">;
}

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier");

const sourceFileParams = z.strictObject({
  knowledgeBaseId: identifierSchema,
  sourceId: identifierSchema,
});

const withheld = apiError(
  "material_quarantined",
  "This file is quarantined by injection screening. An owner or admin can download or release it.",
);

/**
 * A `Content-Disposition` that saves the file under its own name: an ASCII fallback for old
 * clients and the exact name in RFC 5987 form. The name was checked at upload to hold no path.
 */
export function attachmentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\]/gu, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * The download of a knowledge source's latest stored file. Base access is the knowledge routes'
 * (a base the caller does not reach answers 404 before this handler). A quarantined file is sent
 * only to owners, admins and the owner token, so they can inspect it before releasing it.
 */
export function registerKnowledgeSourceFileRoutes(
  parent: FastifyInstance,
  options: KnowledgeSourceFileRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { intake, screening } = options;

  app.get(
    "/v1/knowledge-bases/:knowledgeBaseId/sources/:sourceId/file",
    {
      schema: {
        summary: "Download a knowledge source's stored file",
        description:
          "Answers the source's latest stored file as an attachment under its own name, with its media type and its SHA-256 in X-Content-SHA256. A pull request list answers the Markdown it was stored as. The bytes are checked against the recorded checksum first: a file that is missing or no longer matches answers 409 source_file_unavailable and is never sent. A file quarantined by injection screening and not released answers 409 material_quarantined, except to owners, admins and the owner token.",
        params: sourceFileParams,
        response: {
          200: z.any().describe("The file's bytes, in its media type."),
          400: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { knowledgeBaseId, sourceId } = request.params;
      const file = await intake.readSourceFile(knowledgeBaseId, sourceId);
      const subject = {
        kind: "knowledge-source-version",
        knowledgeBaseId,
        sourceId,
        sourceVersionId: file.latestVersion.id,
      } as const;
      if (screening !== undefined && (await screening.withholdsDownload(request, subject))) {
        return reply.code(409).send(withheld);
      }
      // Content-free: ids only, never the file's name or text.
      request.log.info(
        { audit: { action: "knowledge_source_downloaded", knowledgeBaseId, sourceId } },
        "knowledge source file downloaded",
      );
      return reply
        .code(200)
        .header("content-type", file.latestVersion.mediaType)
        .header("content-disposition", attachmentDisposition(file.source.displayName))
        .header("x-content-type-options", "nosniff")
        .header("x-content-sha256", file.latestVersion.checksum)
        .header("cache-control", "private, no-store")
        .send(Buffer.from(file.bytes));
    },
  );
}
