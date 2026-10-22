import {
  type ApplicationService,
  createOpportunityDraft,
  type EditOpportunityCommand,
  opportunityBriefNotFoundErrorMessage,
  opportunityBriefVersionStaleErrorMessage,
} from "@draft-loop/application";
import type { OpportunityBriefVersionRecord } from "@draft-loop/storage";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-10-22T10:00:00.000Z";
const briefUrl = "/v1/workspaces/workspace-1/opportunities/brief-1";

async function briefRecord(): Promise<OpportunityBriefVersionRecord> {
  const brief = await createOpportunityDraft(
    {
      id: "brief-1",
      createdAt: at,
      sources: [
        {
          id: "posting",
          kind: "pasted-content",
          classification: "job-posting",
          content: "Platform Engineer at Example Ledger\n\nRequirements:\n- Operate Postgres.",
        },
      ],
    },
    { now: () => at },
  );
  return { workspaceId: "workspace-1", checksum: "a".repeat(64), brief };
}

let app: FastifyInstance;

async function build(methods: Partial<ApplicationService>): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: methods as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
    },
  });
}

const edit = (payload: unknown) =>
  app.inject({
    method: "PATCH",
    url: briefUrl,
    headers: { authorization },
    payload: payload as Record<string, unknown>,
  });

afterEach(async () => {
  await app.close();
});

describe("job brief edits", () => {
  it("saves a patch at the expected version, leaving out fields it does not name", async () => {
    const record = await briefRecord();
    const editOpportunity = vi.fn(async (_command: EditOpportunityCommand) => record);
    await build({ editOpportunity });

    const response = await edit({
      expectedVersion: 1,
      patch: {
        role: { value: "Platform Engineer", sourceIds: ["posting"] },
        requirements: [
          {
            id: "postgres",
            text: "Operate Postgres",
            priority: "critical",
            sourceIds: ["posting"],
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(editOpportunity.mock.calls[0]?.[0]).toEqual({
      root: "/tenants/owner/workspaces/workspace-1",
      briefId: "brief-1",
      expectedVersion: 1,
      patch: {
        role: { value: "Platform Engineer", sourceIds: ["posting"] },
        requirements: [
          {
            id: "postgres",
            text: "Operate Postgres",
            priority: "critical",
            sourceIds: ["posting"],
          },
        ],
      },
    });
    expect(response.json().brief.id).toBe("brief-1");
  });

  it.each([
    ["no expected version", { patch: { employer: null } }],
    ["an empty patch", { expectedVersion: 1, patch: {} }],
    ["a field nobody may edit", { expectedVersion: 1, patch: { status: "reviewed" } }],
    ["a brief's sources", { expectedVersion: 1, patch: { sources: [] } }],
  ])("refuses %s", async (_name, payload) => {
    const editOpportunity = vi.fn();
    await build({ editOpportunity });

    const response = await edit(payload);

    expect(response.statusCode).toBe(400);
    expect(editOpportunity).not.toHaveBeenCalled();
  });

  it("answers 409 when the brief has a newer version", async () => {
    await build({
      editOpportunity: async () => {
        throw new Error(opportunityBriefVersionStaleErrorMessage);
      },
    });

    const response = await edit({ expectedVersion: 1, patch: { employer: null } });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("brief_version_stale");
  });

  it("answers 409 to a review of a stale version too", async () => {
    await build({
      reviewOpportunity: async () => {
        throw new Error(opportunityBriefVersionStaleErrorMessage);
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `${briefUrl}/review`,
      headers: { authorization },
      payload: { expectedVersion: 1 },
    });

    expect(response.statusCode).toBe(409);
  });

  it("answers 404 for a brief that does not exist", async () => {
    await build({
      editOpportunity: async () => {
        throw new Error(opportunityBriefNotFoundErrorMessage);
      },
    });

    const response = await edit({ expectedVersion: 1, patch: { employer: null } });

    expect(response.statusCode).toBe(404);
  });
});

describe("job brief versions", () => {
  it("lists each version's number, status and dates, without its content", async () => {
    const record = await briefRecord();
    const listOpportunityVersions = vi.fn(async () => [record]);
    await build({ listOpportunityVersions });

    const response = await app.inject({
      method: "GET",
      url: `${briefUrl}/versions`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(listOpportunityVersions).toHaveBeenCalledWith({
      root: "/tenants/owner/workspaces/workspace-1",
      briefId: "brief-1",
    });
    expect(response.json()).toEqual({
      versions: [{ version: 1, status: "draft", createdAt: at, reviewedAt: null }],
    });
    expect(response.body).not.toContain("Postgres");
  });

  it("answers 404 for a brief without versions", async () => {
    await build({ listOpportunityVersions: async () => [] });

    const response = await app.inject({
      method: "GET",
      url: `${briefUrl}/versions`,
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
  });
});
