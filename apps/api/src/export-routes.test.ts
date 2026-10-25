import { type ApplicationService, RunActionError, type RunExport } from "@draft-loop/application";
import { RunTransitionError } from "@draft-loop/orchestrator";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const root = "/tenants/owner/workspaces/workspace-1";
const location = `${root}/exports/run-1/0f8e6c1a.docx`;

const docxExport: RunExport = {
  id: "export-1",
  runId: "run-1",
  format: "docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  createdAt: "2026-10-22T10:00:00.000Z",
  checksum: "a".repeat(64),
  sizeBytes: 2048,
  artifactVersion: 2,
  templateId: "modern",
  location,
};

let app: FastifyInstance;

async function build(service: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: service as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
  });
}

afterEach(async () => {
  await app.close();
});

const exportRequest = (payload: object, key = "export-key-0001") => ({
  method: "POST" as const,
  url: "/v1/workspaces/workspace-1/runs/run-1/exports",
  headers: { authorization, "idempotency-key": key },
  payload,
});

describe("exports", () => {
  it("exports the approved draft once per key and never shows where it is stored", async () => {
    const exportRun = vi.fn(async () => location);
    const listRunExports = vi.fn(async () => [docxExport]);
    await build({ export: exportRun, listRunExports });

    const created = await app.inject(exportRequest({ format: "docx", templateId: "modern" }));
    const retried = await app.inject(exportRequest({ format: "docx", templateId: "modern" }));

    expect(created.statusCode).toBe(201);
    expect(exportRun).toHaveBeenCalledOnce();
    expect(exportRun).toHaveBeenCalledWith({
      root,
      runId: "run-1",
      format: "docx",
      templateId: "modern",
    });
    const { location: _location, ...view } = docxExport;
    expect(created.json()).toEqual(view);
    expect(created.body).not.toContain("/tenants/");
    expect(retried.json()).toEqual(created.json());
  });

  it("refuses an unknown format and a missing Idempotency-Key", async () => {
    const exportRun = vi.fn();
    await build({ export: exportRun });

    const unknown = await app.inject(exportRequest({ format: "odt" }));
    const keyless = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/exports",
      headers: { authorization },
      payload: { format: "docx" },
    });

    expect([unknown.statusCode, keyless.statusCode]).toEqual([400, 400]);
    expect(exportRun).not.toHaveBeenCalled();
  });

  it("answers an export of a run not yet approved with 409", async () => {
    await build({
      export: async () => {
        throw new RunTransitionError("Only an approved run can be exported.");
      },
    });

    const response = await app.inject(exportRequest({ format: "pdf" }));

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("run_state_conflict");
  });
});

describe("export downloads", () => {
  const content = new TextEncoder().encode("Synthetic exported document.");

  it("lists a run's exports without their storage locations", async () => {
    const listRunExports = vi.fn(async () => [docxExport]);
    await build({ listRunExports });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-1/exports",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(listRunExports).toHaveBeenCalledWith({ root, runId: "run-1" });
    expect(response.json().exports).toHaveLength(1);
    expect(response.body).not.toContain("/tenants/");
  });

  it("sends the verified bytes as an attachment with their media type and checksum", async () => {
    const readRunExport = vi.fn(async () => ({ export: docxExport, content }));
    await build({ readRunExport });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-1/exports/export-1/content",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(readRunExport).toHaveBeenCalledWith({ root, runId: "run-1", exportId: "export-1" });
    expect(response.headers["content-type"]).toBe(docxExport.mimeType);
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="cv-2026-10-22-export-1.docx"',
    );
    expect(response.headers["x-content-sha256"]).toBe(docxExport.checksum);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(new Uint8Array(response.rawPayload)).toEqual(content);
  });

  it.each([
    ["export_integrity", 409],
    ["export_not_found", 404],
  ] as const)("never sends a document the service refuses with %s", async (code, status) => {
    await build({
      readRunExport: async () => {
        throw new RunActionError(code, "Refused.");
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-1/exports/export-1/content",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
  });
});
