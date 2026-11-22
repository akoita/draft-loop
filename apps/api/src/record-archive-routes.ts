import type { ApplicationService } from "@draft-loop/application";
import type {
  ReadableRecordExports,
  RecordArchiveKnowledgeScope,
  RecordArchives,
} from "@draft-loop/storage/record-archive";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { logAccessRefusal } from "./access-refusal-log.js";
import { apiError, apiErrorSchema } from "./errors.js";
import { reachesEveryRecord } from "./record-access.js";
import { zipStream } from "./zip-stream.js";

export interface RecordArchiveRoutesOptions {
  readonly service: ApplicationService;
  /** The driver's reference for a workspace id; the API never accepts a reference from a client. */
  readonly workspaceRoot: (workspaceId: string) => string;
  /** The tenant's record archives (ADR 0011, D7). */
  readonly archives: RecordArchives;
  /** Each record's readable copy (#3036); without it the readable export route is not served. */
  readonly readableExports?: ReadableRecordExports;
  /**
   * Which knowledge bases an archive holds, from the API's authentication mode: `owned` in
   * sign-in mode, where each base belongs to one record, and `tenant` in owner-token mode, whose
   * one workspace uses the tenant's bases.
   */
  readonly knowledgeScope: RecordArchiveKnowledgeScope;
}

const workspaceParams = z.strictObject({
  workspaceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u, "must be a safe identifier"),
});

const ownersAndAdminsOnly = apiError(
  "forbidden",
  "Only the organisation's owners and admins may export a candidate record.",
);

/**
 * Downloads everything held about one candidate record as a record archive v1 zip (ADR 0011, D7).
 * Owners and admins may export any record of their organisation, and the owner token its
 * deployment's; members get 403, and a record the caller cannot reach answers 404 through record
 * access before this route runs. Every object is checked before the first byte is sent, and again
 * as it is written: one that changes mid-download ends the response without a valid zip.
 */
export function registerRecordArchiveRoutes(
  parent: FastifyInstance,
  options: RecordArchiveRoutesOptions,
): void {
  const app = parent.withTypeProvider<ZodTypeProvider>();
  const { service, workspaceRoot, archives, readableExports, knowledgeScope } = options;

  app.get(
    "/v1/workspaces/:workspaceId/archive",
    {
      schema: {
        summary: "Download everything held about a candidate record as a zip",
        description:
          "Streams the record's archive (record archive v1): its manifest, its rows as JSON and the original bytes of its sources and exported documents. Owners and admins only. The manifest's SHA-256 is in X-Archive-Manifest-SHA256. A stored object that is missing or no longer matches its checksum answers 409 archive_integrity before anything is sent.",
        params: workspaceParams,
        response: {
          200: z.any().describe("The archive, as application/zip."),
          400: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { caller } = request;
      const { workspaceId } = request.params;
      if (caller === undefined || !reachesEveryRecord(caller)) {
        logAccessRefusal(request, { resource: "record", reason: "role", resourceId: workspaceId });
        return reply.code(403).send(ownersAndAdminsOnly);
      }
      const historyId = (await service.readWorkspace(workspaceRoot(workspaceId))).id;
      const archive = await archives.prepare({ workspaceId, historyId, knowledgeScope });
      // Content-free: ids and counts only. The tenant id comes with the request's logger.
      request.log.info(
        {
          audit: {
            action: "record_archive_downloaded",
            workspaceId,
            ...(caller.kind === "member" ? { memberId: caller.memberId } : {}),
            files: archive.manifest.entries.length + 1,
          },
        },
        "record archive downloaded",
      );
      return reply
        .code(200)
        .header("content-type", "application/zip")
        .header("content-disposition", `attachment; filename="${workspaceId}-archive.zip"`)
        .header("x-archive-manifest-sha256", archive.manifestSha256)
        .header("cache-control", "private, no-store")
        .send(zipStream(archive.files(), new Date(archive.manifest.createdAt)));
    },
  );

  if (readableExports === undefined) return;

  app.get(
    "/v1/workspaces/:workspaceId/export",
    {
      schema: {
        summary: "Download a readable copy of a candidate record as a zip",
        description:
          "Streams what a person reads rather than how the service stores it: a README, their documents under their own names, one folder per job application with its job text, saved letters and exported drafts, their profile, work journal and consent history. Each file is built from an allow list of fields, so no storage location, counter, checksum or token id appears. Owners and admins only. A stored document that is missing or no longer matches its checksum answers 409 archive_integrity before anything is sent.",
        params: workspaceParams,
        response: {
          200: z.any().describe("The readable export, as application/zip."),
          400: apiErrorSchema,
          403: apiErrorSchema,
          404: apiErrorSchema,
          409: apiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const { caller } = request;
      const { workspaceId } = request.params;
      if (caller === undefined || !reachesEveryRecord(caller)) {
        logAccessRefusal(request, { resource: "record", reason: "role", resourceId: workspaceId });
        return reply.code(403).send(ownersAndAdminsOnly);
      }
      const historyId = (await service.readWorkspace(workspaceRoot(workspaceId))).id;
      const prepared = await readableExports.prepare({ workspaceId, historyId, knowledgeScope });
      // Content-free: ids and counts only. The tenant id comes with the request's logger.
      request.log.info(
        {
          audit: {
            action: "readable_export_downloaded",
            workspaceId,
            ...(caller.kind === "member" ? { memberId: caller.memberId } : {}),
            files: prepared.fileCount,
          },
        },
        "readable export downloaded",
      );
      return reply
        .code(200)
        .header("content-type", "application/zip")
        .header("content-disposition", 'attachment; filename="redakloop-data.zip"')
        .header("cache-control", "private, no-store")
        .send(zipStream(prepared.files(), new Date(prepared.createdAt)));
    },
  );
}
