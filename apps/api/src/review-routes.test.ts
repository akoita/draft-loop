import type { ApplicationService, RunReview } from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const at = "2026-10-22T10:00:00.000Z";
const root = "/tenants/owner/workspaces/workspace-1";

const snapshot = {
  schemaVersion: 1,
  runId: "run-1",
  workspaceId: "workspace-1",
  contextSnapshotId: "context-1",
  state: "awaiting-approval",
  round: 1,
  currentStep: null,
  artifact: { id: "artifact-1" },
  findings: [{ code: "unsupported-claim" }],
  totalCostUsd: 0,
  executionHistory: [],
  approval: "pending",
  startedAt: at,
  updatedAt: at,
  lastError: null,
} as unknown as RunSnapshot;

/** A synthetic review of a fictional candidate's draft. */
const syntheticReview: RunReview = {
  snapshot,
  draft: {
    id: "artifact-1",
    version: 1,
    createdAt: at,
    sections: [
      {
        id: "experience",
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            id: "block-1",
            type: "bullet",
            text: "Built TypeScript services for Example Ledger.",
            edited: false,
            claimIds: ["claim-1"],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: "Built TypeScript services for Example Ledger.",
        status: "supported",
        substantive: true,
        evidence: [{ sourcePath: "career.md", excerpt: "Built TypeScript services." }],
      },
    ],
  },
  findings: [
    {
      id: "run-1:finding:0123456789abcdef:0:unsupported-claim",
      code: "unsupported-claim",
      category: "grounding",
      severity: "warning",
      message: "The claim needs a dated source.",
      decision: "pending",
      claimId: "claim-1",
      requirement: { id: "typescript-services", text: "Build TypeScript services" },
    },
  ],
  independentReview: {
    authorLineage: "anthropic",
    criticLineage: "openai",
    lineagesDistinct: true,
    required: true,
  },
  readiness: {
    status: "awaiting-approval",
    ready: true,
    stopReason: "ready",
    scores: [{ dimension: "grounding", score: 0.9, threshold: 0.8, meets: true }],
  },
  approvalCheck: null,
  candidateDirection: null,
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

describe("run review", () => {
  it("reads the draft, its findings with their decisions, and the recorded readiness", async () => {
    const readRunReview = vi.fn(async () => syntheticReview);
    await build({ readRunReview });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-1/review",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(readRunReview).toHaveBeenCalledWith({ root, runId: "run-1" });
    const body = response.json();
    expect(body.run).toMatchObject({ runId: "run-1", state: "awaiting-approval", findingCount: 1 });
    expect(body.draft.sections[0].blocks[0]).toEqual(syntheticReview.draft?.sections[0]?.blocks[0]);
    expect(body.draft.claims[0].evidence).toEqual([
      { sourcePath: "career.md", excerpt: "Built TypeScript services." },
    ]);
    expect(body.findings).toEqual(syntheticReview.findings);
    expect(body.independentReview.lineagesDistinct).toBe(true);
    expect(body.readiness.scores).toHaveLength(1);
    expect(body.approvalCheck).toBeNull();
    expect(body).not.toHaveProperty("snapshot");
  });

  it("answers a run with no draft yet with a null draft", async () => {
    await build({
      readRunReview: async () => ({
        ...syntheticReview,
        snapshot: { ...snapshot, state: "drafting", artifact: null, findings: [] },
        draft: null,
        findings: [],
        readiness: null,
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-1/review",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ draft: null, findings: [], readiness: null });
  });

  it("answers 404 for an unknown run", async () => {
    await build({ readRunReview: async () => undefined });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/missing/review",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_found");
  });

  it("needs the owner token", async () => {
    await build({ readRunReview: async () => syntheticReview });

    const response = await app.inject({
      method: "GET",
      url: "/v1/workspaces/workspace-1/runs/run-1/review",
    });

    expect(response.statusCode).toBe(401);
  });
});
