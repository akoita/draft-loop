import {
  type ApplicationService,
  type HostedKnowledgeIntake,
  HostedKnowledgeIntakeError,
  type HostedKnowledgeSourceView,
} from "@draft-loop/application";
import type { CandidateKnowledgeBaseRecord } from "@draft-loop/storage";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-10-22T10:00:00.000Z";

const base: CandidateKnowledgeBaseRecord = {
  id: "base-1",
  displayName: "Career",
  description: "",
  state: "active",
  isDefault: false,
  createdAt: at,
  updatedAt: at,
  archivedAt: null,
};

const sourceView: HostedKnowledgeSourceView = {
  source: {
    id: "source-1",
    knowledgeBaseId: "base-1",
    kind: "file",
    displayName: "career.md",
    createdAt: at,
  },
  latestVersion: {
    id: "version-1",
    sourceId: "source-1",
    version: 1,
    parentVersionId: null,
    mediaType: "text/markdown",
    checksum: "b".repeat(64),
    sizeBytes: 42,
    createdAt: at,
  },
};

let app: FastifyInstance;

/** Only the intake methods a test scripts exist; calling any other one fails the test. */
async function build(intake: Partial<HostedKnowledgeIntake>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: {} as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      knowledgeIntake: intake as HostedKnowledgeIntake,
    },
  });
}

afterEach(async () => {
  await app.close();
});

describe("knowledge bases", () => {
  it("creates a knowledge base", async () => {
    const createKnowledgeBase = vi.fn(async () => base);
    await build({ createKnowledgeBase });

    const response = await app.inject({
      method: "POST",
      url: "/v1/knowledge-bases",
      headers: { authorization },
      payload: { displayName: "Career" },
    });

    expect(response.statusCode).toBe(201);
    expect(createKnowledgeBase).toHaveBeenCalledWith({ displayName: "Career" });
    expect(response.json()).toEqual({
      id: "base-1",
      displayName: "Career",
      description: "",
      state: "active",
      createdAt: at,
      archivedAt: null,
    });
  });

  it.each([
    ["no name", {}],
    ["a blank name", { displayName: "  " }],
    ["a store of the client's choosing", { displayName: "Career", storeId: "other" }],
  ])("refuses %s", async (_name, payload) => {
    const createKnowledgeBase = vi.fn();
    await build({ createKnowledgeBase });

    const response = await app.inject({
      method: "POST",
      url: "/v1/knowledge-bases",
      headers: { authorization },
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(createKnowledgeBase).not.toHaveBeenCalled();
  });

  it("lists the tenant's knowledge bases", async () => {
    await build({ listKnowledgeBases: async () => [base] });

    const response = await app.inject({
      method: "GET",
      url: "/v1/knowledge-bases",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().knowledgeBases.map(({ id }: { id: string }) => id)).toEqual(["base-1"]);
  });
});

describe("knowledge sources", () => {
  it("lists a base's sources with their metadata, never a storage location", async () => {
    const listSources = vi.fn(async () => [sourceView]);
    await build({ listSources });

    const response = await app.inject({
      method: "GET",
      url: "/v1/knowledge-bases/base-1/sources",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(listSources).toHaveBeenCalledWith("base-1");
    expect(response.json()).toEqual({
      sources: [
        {
          id: "source-1",
          knowledgeBaseId: "base-1",
          displayName: "career.md",
          kind: "file",
          versionId: "version-1",
          mediaType: "text/markdown",
          sizeBytes: 42,
          checksum: "b".repeat(64),
          createdAt: at,
        },
      ],
    });
    expect(response.body).not.toContain("tenants/");
  });

  it("answers 404 for a knowledge base that does not exist", async () => {
    await build({
      listSources: async () => {
        throw new HostedKnowledgeIntakeError("knowledge_base_not_found", "No such knowledge base.");
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/knowledge-bases/missing/sources",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("knowledge_base_not_found");
  });

  it("is not served without a knowledge intake", async () => {
    app = await buildApi({
      ownerToken,
      application: {
        service: {} as ApplicationService,
        workspaceRoot: (workspaceId) => workspaceId,
        enqueueRun: async () => undefined,
        budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
        monthUsage: async () => [],
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/knowledge-bases",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
  });
});
