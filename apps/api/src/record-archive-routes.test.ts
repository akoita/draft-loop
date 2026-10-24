import { createHash } from "node:crypto";

import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import {
  type RecordArchive,
  RecordArchiveError,
  type RecordArchiveFile,
  type RecordArchiveRequest,
  type RecordArchives,
} from "@draft-loop/storage/record-archive";
import Fastify, { type FastifyInstance } from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { sendError } from "./errors.js";
import { cloudLoggingOptions } from "./logging.js";
import { registerRecordArchiveRoutes } from "./record-archive-routes.js";
import type { Caller } from "./request-auth.js";
import { readZip } from "./test-zip.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const archiveUrl = "/v1/workspaces/coach-north/archive";
const encoder = new TextEncoder();
const sha = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

/** The API workspace `coach-north` is the record `history-1`; any other id is unknown. */
const service = {
  readWorkspace: async (root: string) => {
    if (root !== "/tenants/t/workspaces/coach-north") throw new WorkspaceNotFoundError(root);
    return { id: "history-1" };
  },
} as unknown as ApplicationService;

/** An archive port over fixed, fictional files, recording what it was asked for. */
function fixedArchives(failure?: "prepare" | "stream") {
  const requests: RecordArchiveRequest[] = [];
  const table = encoder.encode('{"table":"consent_events","rows":[{"note":"alder-quill"}]}\n');
  const object = encoder.encode("# Experience\n\nFictional notes, codenamed alder-quill.\n");
  const manifest: RecordArchive["manifest"] = {
    format: "draft-loop-record-archive",
    formatVersion: 1,
    createdAt: "2026-10-24T10:00:00.000Z",
    record: { workspaceId: "coach-north" },
    entries: [
      {
        kind: "table",
        path: "tables/consent_events.json",
        table: "consent_events",
        sha256: sha(table),
        sizeBytes: table.byteLength,
      },
      { kind: "object", path: `objects/${sha(object)}`, sha256: sha(object), sizeBytes: 50 },
    ],
  };
  const manifestContent = encoder.encode(`${JSON.stringify(manifest)}\n`);
  const archives: RecordArchives = {
    prepare: async (request) => {
      requests.push(request);
      if (failure === "prepare") {
        throw new RecordArchiveError("object_integrity", "A stored object changed.");
      }
      return {
        manifest,
        manifestSha256: sha(manifestContent),
        files: async function* (): AsyncGenerator<RecordArchiveFile> {
          yield { path: "manifest.json", content: manifestContent };
          yield { path: "tables/consent_events.json", content: table };
          if (failure === "stream") {
            throw new RecordArchiveError("object_integrity", "A stored object changed.");
          }
          yield { path: `objects/${sha(object)}`, content: object };
        },
      };
    },
  };
  return { archives, requests, manifestContent, object };
}

let app: FastifyInstance | undefined;
let logLines: string[];

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** The route alone, with callers from a test header: `owner`, or a member's role. */
async function routeServer(archives: RecordArchives): Promise<FastifyInstance> {
  logLines = [];
  const server = Fastify({
    logger: cloudLoggingOptions({ write: (line) => logLines.push(line) }),
  }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.setErrorHandler(sendError);
  server.decorateRequest("caller", undefined);
  server.addHook("onRequest", async (request) => {
    const header = request.headers["x-test-caller"];
    if (typeof header !== "string") return;
    request.caller =
      header === "owner"
        ? { kind: "owner" }
        : {
            kind: "member",
            tenantId: "t",
            memberId: `member-${header}`,
            role: header as Extract<Caller, { kind: "member" }>["role"],
          };
  });
  registerRecordArchiveRoutes(server, {
    service,
    workspaceRoot: (workspaceId) => `/tenants/t/workspaces/${workspaceId}`,
    archives,
    knowledgeScope: "owned",
  });
  app = server;
  return server;
}

const download = (server: FastifyInstance, caller: string, url = archiveUrl) =>
  server.inject({ method: "GET", url, headers: { "x-test-caller": caller } });

describe("record archive route", () => {
  it("streams the archive as a zip to owners and admins, with one content-free log line", async () => {
    const fixed = fixedArchives();
    const server = await routeServer(fixed.archives);
    for (const caller of ["owner", "admin"]) {
      const response = await download(server, caller);
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("application/zip");
      expect(response.headers["content-disposition"]).toBe(
        'attachment; filename="coach-north-archive.zip"',
      );
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(response.headers["x-archive-manifest-sha256"]).toBe(sha(fixed.manifestContent));
      const files = readZip(response.rawPayload);
      expect(files.map((file) => file.path)).toEqual([
        "manifest.json",
        "tables/consent_events.json",
        `objects/${sha(fixed.object)}`,
      ]);
      expect(sha(files[0]?.content ?? Buffer.alloc(0))).toBe(sha(fixed.manifestContent));
    }
    expect(fixed.requests).toEqual([
      { workspaceId: "coach-north", historyId: "history-1", knowledgeScope: "owned" },
      { workspaceId: "coach-north", historyId: "history-1", knowledgeScope: "owned" },
    ]);

    const audit = logLines
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.audit?.action === "record_archive_downloaded");
    expect(audit.map((entry) => entry.audit)).toEqual([
      { action: "record_archive_downloaded", workspaceId: "coach-north", files: 3 },
      {
        action: "record_archive_downloaded",
        workspaceId: "coach-north",
        memberId: "member-admin",
        files: 3,
      },
    ]);
    expect(logLines.join("\n")).not.toContain("alder-quill");
  });

  it("refuses members with 403 and an unknown record with 404, before reading anything", async () => {
    const fixed = fixedArchives();
    const server = await routeServer(fixed.archives);
    const refused = await download(server, "member");
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("forbidden");
    const unknown = await download(server, "owner", "/v1/workspaces/coach-south/archive");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("not_found");
    const invalid = await download(server, "owner", "/v1/workspaces/..%2Fother/archive");
    expect(invalid.statusCode).toBe(400);
    expect(fixed.requests).toEqual([]);
  });

  it("answers 409 for a changed object before sending, and ends a stream that meets one", async () => {
    const before = await routeServer(fixedArchives("prepare").archives);
    const refused = await download(before, "owner");
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toEqual({
      code: "archive_integrity",
      message: "A stored object changed.",
    });
    await before.close();

    const during = await routeServer(fixedArchives("stream").archives);
    // The headers had gone, so the response is destroyed before the zip's central directory.
    await expect(download(during, "owner")).rejects.toThrow("response destroyed before completion");
  });

  it("is served by the API in owner mode with the owner token only when archives are given", async () => {
    const application = {
      service,
      workspaceRoot: (workspaceId: string) => `/tenants/t/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    };
    const authorization = `Bearer ${ownerToken}`;
    app = await buildApi({ ownerToken, application });
    const without = await app.inject({
      method: "GET",
      url: archiveUrl,
      headers: { authorization },
    });
    expect(without.statusCode).toBe(404);
    await app.close();

    const fixed = fixedArchives();
    app = await buildApi({
      ownerToken,
      application: { ...application, recordArchives: fixed.archives },
    });
    const served = await app.inject({ method: "GET", url: archiveUrl, headers: { authorization } });
    expect(served.statusCode).toBe(200);
    expect(readZip(served.rawPayload)).toHaveLength(3);
    // Owner-token mode holds one workspace over the tenant's knowledge bases.
    expect(fixed.requests.map((request) => request.knowledgeScope)).toEqual(["tenant"]);
    expect((await app.inject({ method: "GET", url: archiveUrl })).statusCode).toBe(401);
  });
});
