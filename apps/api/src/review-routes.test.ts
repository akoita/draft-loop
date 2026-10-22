import { type ApplicationService, RunActionError, type RunReview } from "@draft-loop/application";
import { type RunSnapshot, RunTransitionError } from "@draft-loop/orchestrator";
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

async function build(
  service: Partial<ApplicationService>,
  enqueueRun: (workspaceId: string, runId: string) => Promise<void> = async () => undefined,
): Promise<void> {
  app = await buildApi({
    ownerToken,
    application: {
      service: service as ApplicationService,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun,
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

describe("review decisions", () => {
  const findingId = "run-1:finding:0123456789abcdef:0:unsupported-claim";

  it("records a finding decision with its rationale and answers the updated review", async () => {
    const recordReviewDecision = vi.fn(async () => undefined);
    await build({ recordReviewDecision, readRunReview: async () => syntheticReview });

    const response = await app.inject({
      method: "PUT",
      url: `/v1/workspaces/workspace-1/runs/run-1/findings/${encodeURIComponent(findingId)}/decision`,
      headers: { authorization },
      payload: { decision: "rejected", rationale: "The source dates it." },
    });

    expect(response.statusCode).toBe(200);
    expect(recordReviewDecision).toHaveBeenCalledWith({
      root,
      runId: "run-1",
      kind: "finding",
      targetId: findingId,
      decision: "rejected",
      rationale: "The source dates it.",
    });
    expect(response.json().run.runId).toBe("run-1");
  });

  it("records a block edit", async () => {
    const recordReviewDecision = vi.fn(async () => undefined);
    await build({ recordReviewDecision, readRunReview: async () => syntheticReview });

    const response = await app.inject({
      method: "PUT",
      url: "/v1/workspaces/workspace-1/runs/run-1/edits/block-1",
      headers: { authorization },
      payload: { text: "Built TypeScript services with deterministic tests." },
    });

    expect(response.statusCode).toBe(200);
    expect(recordReviewDecision).toHaveBeenCalledWith({
      root,
      runId: "run-1",
      kind: "edit",
      targetId: "block-1",
      replacementText: "Built TypeScript services with deterministic tests.",
    });
  });

  it("refuses an unknown decision, an empty edit and an overlong rationale", async () => {
    const recordReviewDecision = vi.fn(async () => undefined);
    await build({ recordReviewDecision, readRunReview: async () => syntheticReview });

    const responses = await Promise.all([
      app.inject({
        method: "PUT",
        url: `/v1/workspaces/workspace-1/runs/run-1/findings/${findingId}/decision`,
        headers: { authorization },
        payload: { decision: "ignored" },
      }),
      app.inject({
        method: "PUT",
        url: "/v1/workspaces/workspace-1/runs/run-1/edits/block-1",
        headers: { authorization },
        payload: { text: "   " },
      }),
      app.inject({
        method: "PUT",
        url: `/v1/workspaces/workspace-1/runs/run-1/findings/${findingId}/decision`,
        headers: { authorization },
        payload: { decision: "rejected", rationale: "x".repeat(2_001) },
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400]);
    expect(recordReviewDecision).not.toHaveBeenCalled();
  });

  it.each([
    ["review_closed", 409],
    ["review_target_not_found", 404],
    ["run_not_found", 404],
  ] as const)("answers the service's %s refusal with %i", async (code, status) => {
    await build({
      recordReviewDecision: async () => {
        throw new RunActionError(code, "Refused.");
      },
      readRunReview: async () => syntheticReview,
    });

    const response = await app.inject({
      method: "PUT",
      url: `/v1/workspaces/workspace-1/runs/run-1/findings/${findingId}/decision`,
      headers: { authorization },
      payload: { decision: "accepted" },
    });

    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
  });
});

describe("approve and stop", () => {
  it("approves a run, passing the owner's reason to approve past failing checks", async () => {
    const lifecycle = vi.fn(async () => ({ ...snapshot, state: "approved", approval: "approved" }));
    await build({ lifecycle } as unknown as Partial<ApplicationService>);

    const plain = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/approve",
      headers: { authorization },
      payload: {},
    });
    const overridden = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/approve",
      headers: { authorization },
      payload: { readinessOverrideRationale: "The page length is what the employer asked for." },
    });

    expect(plain.statusCode).toBe(200);
    expect(plain.json()).toMatchObject({ runId: "run-1", state: "approved", approval: "approved" });
    expect(overridden.statusCode).toBe(200);
    expect(lifecycle).toHaveBeenNthCalledWith(1, { root, runId: "run-1", action: "approve" });
    expect(lifecycle).toHaveBeenNthCalledWith(2, {
      root,
      runId: "run-1",
      action: "approve",
      readinessOverrideRationale: "The page length is what the employer asked for.",
    });
  });

  it("answers a blocked approval and a state conflict with 409 and their codes", async () => {
    const lifecycle = vi
      .fn()
      .mockRejectedValueOnce(
        new RunTransitionError(
          "The current artifact is not application-ready (deterministic-error).",
          "readiness_blocked",
        ),
      )
      .mockRejectedValueOnce(
        new RunTransitionError("Only a run awaiting approval can be approved."),
      );
    await build({ lifecycle } as unknown as Partial<ApplicationService>);

    const blocked = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/approve",
      headers: { authorization },
      payload: {},
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/approve",
      headers: { authorization },
      payload: {},
    });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("readiness_blocked");
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toEqual({
      code: "run_state_conflict",
      message: "Only a run awaiting approval can be approved.",
    });
  });

  it("refuses an overlong reason before calling the service", async () => {
    const lifecycle = vi.fn();
    await build({ lifecycle } as unknown as Partial<ApplicationService>);

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/approve",
      headers: { authorization },
      payload: { readinessOverrideRationale: "x".repeat(501) },
    });

    expect(response.statusCode).toBe(400);
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it("stops a run", async () => {
    const lifecycle = vi.fn(async () => ({ ...snapshot, state: "stopped" }));
    await build({ lifecycle } as unknown as Partial<ApplicationService>);

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/stop",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("stopped");
    expect(lifecycle).toHaveBeenCalledWith({ root, runId: "run-1", action: "stop" });
  });
});

describe("revision, pause and resume", () => {
  const key = { "idempotency-key": "revision-key-0001" };

  it("moves the run to revising with the owner's direction, then queues it once per key", async () => {
    const lifecycle = vi.fn(async () => ({ ...snapshot, state: "revising", round: 2 }));
    const enqueueRun = vi.fn(async () => undefined);
    await build({ lifecycle } as unknown as Partial<ApplicationService>, enqueueRun);
    const request = {
      method: "POST" as const,
      url: "/v1/workspaces/workspace-1/runs/run-1/revision",
      headers: { authorization, ...key },
      payload: { candidateDirection: "Lead with the testing practice." },
    };

    const first = await app.inject(request);
    const retried = await app.inject(request);

    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ state: "revising", round: 2 });
    expect(retried.json()).toEqual(first.json());
    expect(lifecycle).toHaveBeenCalledOnce();
    expect(lifecycle).toHaveBeenCalledWith({
      root,
      runId: "run-1",
      action: "revision",
      candidateDirection: "Lead with the testing practice.",
    });
    // A retry queues again; the queue keeps one waiting job per run.
    expect(enqueueRun).toHaveBeenCalledTimes(2);
    expect(enqueueRun).toHaveBeenCalledWith("workspace-1", "run-1");
  });

  it("needs an Idempotency-Key and refuses an overlong direction", async () => {
    const lifecycle = vi.fn();
    await build({ lifecycle } as unknown as Partial<ApplicationService>);

    const keyless = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/revision",
      headers: { authorization },
      payload: {},
    });
    const overlong = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/revision",
      headers: { authorization, ...key },
      payload: { candidateDirection: "x".repeat(1_001) },
    });

    expect([keyless.statusCode, overlong.statusCode]).toEqual([400, 400]);
    expect(lifecycle).not.toHaveBeenCalled();
  });

  it("answers 503 when the revised run cannot be queued", async () => {
    const lifecycle = vi.fn(async () => ({ ...snapshot, state: "revising" }));
    await build({ lifecycle } as unknown as Partial<ApplicationService>, async () => {
      throw new Error("queue down");
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/revision",
      headers: { authorization, ...key },
      payload: {},
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("queue_unavailable");
  });

  it("pauses a run without queueing it", async () => {
    const lifecycle = vi.fn(async () => ({ ...snapshot, state: "paused" }));
    const enqueueRun = vi.fn(async () => undefined);
    await build({ lifecycle } as unknown as Partial<ApplicationService>, enqueueRun);

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/pause",
      headers: { authorization },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("paused");
    expect(lifecycle).toHaveBeenCalledWith({ root, runId: "run-1", action: "pause" });
    expect(enqueueRun).not.toHaveBeenCalled();
  });

  it("lifts a pause without running a step, then queues the run", async () => {
    const releasePause = vi.fn(async () => ({ ...snapshot, state: "drafting" }));
    const enqueueRun = vi.fn(async () => undefined);
    await build({ releasePause } as unknown as Partial<ApplicationService>, enqueueRun);

    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/workspace-1/runs/run-1/resume",
      headers: { authorization, "idempotency-key": "resume-key-0001" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("drafting");
    expect(releasePause).toHaveBeenCalledWith({ root, runId: "run-1" });
    expect(enqueueRun).toHaveBeenCalledWith("workspace-1", "run-1");
  });
});
