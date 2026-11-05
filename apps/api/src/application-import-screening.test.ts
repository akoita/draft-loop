import type { ApplicationService } from "@draft-loop/application";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerApplicationImportRoutes } from "./application-import-routes.js";
import { sendError } from "./errors.js";

const path = "/v1/workspaces/workspace-1/application-imports";
const root = "/tenants/owner/workspaces/workspace-1";
const jobText = "Design interfaces for a fictional product.";

const bundle = {
  format: "draft-loop-application-bundle",
  formatVersion: 1,
  sourceWorkspaceId: "desktop-workspace",
  sourceApplicationId: "default",
  name: "Fictional Designer",
  jobText,
  briefs: ["brief-posting", "brief-notes", "brief-empty", "brief-gone"].map((briefId) => ({
    briefId,
    versions: [{ id: `${briefId}-v1` }],
  })),
  runs: [],
};

/** Each brief's stored sources: a job posting among others, none of that kind, none at all. */
const opportunities: Record<string, { sources: object[] } | undefined> = {
  "brief-posting": {
    sources: [
      { id: "source-notes", classification: "user-notes" },
      { id: "source-posting", classification: "job-posting" },
    ],
  },
  "brief-notes": { sources: [{ id: "source-first", classification: "user-notes" }] },
  "brief-empty": { sources: [] },
  "brief-gone": undefined,
};

function importResult(status: "imported" | "already-imported") {
  return {
    applicationId: "imported-1",
    name: "Fictional Designer",
    status,
    counts: { runs: 0, briefs: 4, briefVersions: 4 },
  };
}

const getOpportunity = vi.fn(async ({ briefId }: { briefId: string }) => {
  const brief = opportunities[briefId];
  return brief === undefined ? undefined : { briefId, brief };
});

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  getOpportunity.mockClear();
});

function build(service: Partial<ApplicationService>, screen = true) {
  const screenOpportunity = vi.fn(
    async (_request: unknown, _record: unknown, _sources: readonly unknown[]) => undefined,
  );
  const server = Fastify();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  server.setErrorHandler(sendError);
  registerApplicationImportRoutes(server, {
    service: service as ApplicationService,
    workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
    ...(screen ? { screening: { screenOpportunity } } : {}),
  });
  app = server;
  return { server, screenOpportunity };
}

describe("application import screening", () => {
  it("screens the job text against each imported brief's job posting, or its first source", async () => {
    const { server, screenOpportunity } = build({
      importApplicationBundle: async () => importResult("imported"),
      getOpportunity,
    } as unknown as Partial<ApplicationService>);

    const response = await server.inject({ method: "POST", url: path, payload: bundle });

    expect(response.statusCode).toBe(201);
    expect(getOpportunity.mock.calls.map(([input]) => input)).toEqual(
      bundle.briefs.map(({ briefId }) => ({ root, briefId })),
    );
    // A brief with no sources, or none stored, is not screened.
    expect(screenOpportunity.mock.calls.map(([, record, sources]) => [record, sources])).toEqual(
      ["brief-posting", "brief-notes"].map((briefId, index) => [
        expect.objectContaining({ briefId }),
        [
          {
            id: index === 0 ? "source-posting" : "source-first",
            kind: "pasted-content",
            classification: "job-posting",
            content: jobText,
          },
        ],
      ]),
    );
  });

  it("screens nothing again for a bundle already imported, nor without screening", async () => {
    const resent = build({
      importApplicationBundle: async () => importResult("already-imported"),
      getOpportunity,
    } as unknown as Partial<ApplicationService>);
    const resend = await resent.server.inject({ method: "POST", url: path, payload: bundle });
    await resent.server.close();

    const unscreened = build(
      {
        importApplicationBundle: async () => importResult("imported"),
        getOpportunity,
      } as unknown as Partial<ApplicationService>,
      false,
    );
    const imported = await unscreened.server.inject({ method: "POST", url: path, payload: bundle });

    expect([resend.statusCode, imported.statusCode]).toEqual([200, 201]);
    expect(resent.screenOpportunity).not.toHaveBeenCalled();
    expect(getOpportunity).not.toHaveBeenCalled();
  });

  it("refuses an import on a server whose application cannot import", async () => {
    const { server } = build({});

    const response = await server.inject({ method: "POST", url: path, payload: bundle });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: { code: "rejected", message: "This server does not import applications." },
    });
  });
});
