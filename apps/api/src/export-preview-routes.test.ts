import type { ApplicationService } from "@draft-loop/application";
import { RunTransitionError } from "@draft-loop/orchestrator";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const root = "/tenants/owner/workspaces/workspace-1";

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

const previewRequest = (payload: object) => ({
  method: "POST" as const,
  url: "/v1/workspaces/workspace-1/runs/run-1/export-preview",
  headers: { authorization },
  payload,
});

describe("export preview", () => {
  it("answers the document inline with its page counts and stores nothing", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 preview");
    const previewExport = vi.fn(async () => ({
      format: "pdf" as const,
      mimeType: "application/pdf",
      content: pdf,
      templateId: "modern",
      pageCount: 2,
      targetPageCount: 2,
    }));
    const exportRun = vi.fn();
    await build({ previewExport, export: exportRun });

    const response = await app.inject(previewRequest({ format: "pdf", templateId: "modern" }));

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-disposition"]).toBe("inline");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["x-page-count"]).toBe("2");
    expect(response.headers["x-target-page-count"]).toBe("2");
    expect(response.headers["x-template-id"]).toBe("modern");
    expect(response.rawPayload.equals(Buffer.from(pdf))).toBe(true);
    expect(previewExport).toHaveBeenCalledWith({
      root,
      runId: "run-1",
      format: "pdf",
      templateId: "modern",
    });
    expect(exportRun).not.toHaveBeenCalled();
  });

  it("leaves out the page count for a format without pages", async () => {
    await build({
      previewExport: async () => ({
        format: "markdown",
        mimeType: "text/markdown",
        content: new TextEncoder().encode("# CV"),
        templateId: "classic",
        pageCount: null,
        targetPageCount: 2,
      }),
    });

    const response = await app.inject(previewRequest({ format: "markdown" }));

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-page-count"]).toBeUndefined();
    expect(response.body).toBe("# CV");
  });

  it("answers a preview of a run not yet approved with 409", async () => {
    await build({
      previewExport: async () => {
        throw new RunTransitionError("Only an approved run can be exported.");
      },
    });

    const response = await app.inject(previewRequest({ format: "pdf" }));

    expect(response.statusCode).toBe(409);
  });

  it("refuses an unknown format", async () => {
    await build({ previewExport: vi.fn() });

    const response = await app.inject(previewRequest({ format: "rtf" }));

    expect(response.statusCode).toBe(400);
  });
});
