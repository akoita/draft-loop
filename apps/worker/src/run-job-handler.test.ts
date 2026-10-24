import type { ApplicationService } from "@draft-loop/application";
import type { RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it, vi } from "vitest";

import { createRunJobHandler, type RunJobOutcome } from "./run-job-handler.js";

const job = { tenantId: "tenant-a", workspaceId: "workspace-1", runId: "run-1" };
const now = new Date("2026-10-21T12:00:00.000Z");
const root = "/tenants/tenant-a/workspaces/workspace-1";

const budgetCeiling = { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 };
const withinCeiling = { maxRounds: 3, maxCostUsd: 2, maxDurationMs: 600_000 };

/** Only the fields the handler reads; the rest of a snapshot does not matter here. */
function snapshot(
  state: string,
  lastError: object | null = null,
  budget: object = withinCeiling,
): RunSnapshot {
  return {
    runId: job.runId,
    workspaceId: job.workspaceId,
    state,
    lastError,
    budget,
  } as RunSnapshot;
}

const usageLimit = (usageLimitResetsAt?: string) => ({
  code: "usage-limit",
  retryable: true,
  ...(usageLimitResetsAt === undefined ? {} : { usageLimitResetsAt }),
});

type Service = Pick<ApplicationService, "status" | "resume">;

async function handle(status: RunSnapshot | undefined, resumed?: RunSnapshot) {
  const service = {
    status: vi.fn<Service["status"]>(async () => status),
    resume: vi.fn<Service["resume"]>(async () => {
      if (resumed === undefined) throw new Error("unexpected resume");
      return resumed;
    }),
  };
  const requeue = vi.fn(async (_startAfter: Date) => undefined);
  const outcomes: RunJobOutcome[] = [];
  const handler = createRunJobHandler({
    service,
    workspaceRoot: (queued) => `/tenants/${queued.tenantId}/workspaces/${queued.workspaceId}`,
    allowProviderData: true,
    budgetCeiling,
    now: () => now,
    onOutcome: (_job, outcome) => outcomes.push(outcome),
  });
  await handler(job, { requeue });
  return { service, requeue, outcome: outcomes[0] };
}

describe("run job handler", () => {
  it("resumes an active run in its workspace until it awaits the person", async () => {
    const { service, requeue, outcome } = await handle(
      snapshot("drafting"),
      snapshot("awaiting-approval"),
    );

    expect(outcome).toBe("advanced");
    expect(service.status).toHaveBeenCalledWith({ root, runId: "run-1" });
    expect(service.resume).toHaveBeenCalledWith({
      root,
      runId: "run-1",
      allowProviderData: true,
    });
    expect(requeue).not.toHaveBeenCalled();
  });

  it("drafts the next round of a run the person sent back for revision", async () => {
    const { service, outcome } = await handle(snapshot("revising"), snapshot("awaiting-approval"));

    expect(outcome).toBe("advanced");
    expect(service.resume).toHaveBeenCalledOnce();
  });

  it("continues a run whose pause the person lifted, from the state of its step", async () => {
    const { service, outcome } = await handle(snapshot("reviewing"), snapshot("awaiting-approval"));

    expect(outcome).toBe("advanced");
    expect(service.resume).toHaveBeenCalledOnce();
  });

  it.each([
    ["more rounds", { ...withinCeiling, maxRounds: 6 }],
    ["a higher cost limit", { ...withinCeiling, maxCostUsd: 3.5 }],
    ["no cost limit", { maxRounds: 3, maxDurationMs: 600_000 }],
    ["no duration limit", { maxRounds: 3, maxCostUsd: 2 }],
  ])("does not execute a run saved with %s than the ceiling allows", async (_label, budget) => {
    const { service, outcome } = await handle(snapshot("drafting", null, budget));

    expect(outcome).toBe("over-ceiling");
    expect(service.resume).not.toHaveBeenCalled();
  });

  it("retries a failed step through resume, which applies the step's retry rules", async () => {
    const { service, outcome } = await handle(
      snapshot("provider-error", { code: "timeout", retryable: true }),
      snapshot("awaiting-approval"),
    );

    expect(outcome).toBe("advanced");
    expect(service.resume).toHaveBeenCalledTimes(1);
  });

  it("queues the run again after a rate limit, no earlier than the provider's retry time", async () => {
    const rateLimit = (retryNotBefore?: string) => ({
      code: "rate-limit",
      retryable: true,
      ...(retryNotBefore === undefined ? {} : { retryNotBefore }),
    });
    const oneMinute = new Date(now.getTime() + 60_000);
    const short = await handle(
      snapshot("reviewing"),
      snapshot("provider-error", rateLimit("2026-10-21T12:00:05.000Z")),
    );
    const unnamed = await handle(snapshot("reviewing"), snapshot("provider-error", rateLimit()));
    const later = await handle(
      snapshot("reviewing"),
      snapshot("provider-error", rateLimit("2026-10-21T12:03:00.000Z")),
    );

    expect(short.outcome).toBe("rescheduled");
    expect(short.requeue).toHaveBeenCalledWith(oneMinute);
    expect(unnamed.requeue).toHaveBeenCalledWith(oneMinute);
    expect(later.requeue).toHaveBeenCalledWith(new Date("2026-10-21T12:03:00.000Z"));
  });

  it("leaves a run in provider-error once its step has no retries left, or for other errors", async () => {
    const exhausted = await handle(
      snapshot("reviewing"),
      snapshot("provider-error", { code: "rate-limit", retryable: false }),
    );
    const timeout = await handle(
      snapshot("reviewing"),
      snapshot("provider-error", { code: "timeout", retryable: true }),
    );

    for (const { outcome, requeue } of [exhausted, timeout]) {
      expect(outcome).toBe("advanced");
      expect(requeue).not.toHaveBeenCalled();
    }
  });

  it.each(["awaiting-approval", "approved", "exported", "stopped", "budget-exhausted"])(
    "leaves a %s run alone",
    async (state) => {
      const { service, outcome } = await handle(snapshot(state));

      expect(outcome).toBe("settled");
      expect(service.resume).not.toHaveBeenCalled();
    },
  );

  it("leaves a run the person paused for them to resume", async () => {
    const { service, outcome } = await handle(snapshot("paused"));

    expect(outcome).toBe("held");
    expect(service.resume).not.toHaveBeenCalled();
  });

  it("completes a job whose run no longer exists", async () => {
    const { service, outcome } = await handle(undefined);

    expect(outcome).toBe("missing");
    expect(service.resume).not.toHaveBeenCalled();
  });

  it("queues the run again for the reset time when a usage limit pauses it", async () => {
    const resetsAt = "2026-10-21T15:30:00.000Z";
    const { requeue, outcome } = await handle(
      snapshot("reviewing"),
      snapshot("paused", usageLimit(resetsAt)),
    );

    expect(outcome).toBe("rescheduled");
    expect(requeue).toHaveBeenCalledWith(new Date(resetsAt));
  });

  it("waits a fixed time when a usage limit names no reset time, or one already past", async () => {
    const fallback = new Date(now.getTime() + 15 * 60 * 1000);

    const unnamed = await handle(snapshot("drafting"), snapshot("paused", usageLimit()));
    const past = await handle(
      snapshot("drafting"),
      snapshot("paused", usageLimit("2026-10-21T11:00:00.000Z")),
    );

    expect(unnamed.requeue).toHaveBeenCalledWith(fallback);
    expect(past.requeue).toHaveBeenCalledWith(fallback);
  });

  it("holds an early job for a usage-limited run until the reset time", async () => {
    const resetsAt = "2026-10-21T13:00:00.000Z";
    const { service, requeue, outcome } = await handle(snapshot("paused", usageLimit(resetsAt)));

    expect(outcome).toBe("rescheduled");
    expect(requeue).toHaveBeenCalledWith(new Date(resetsAt));
    expect(service.resume).not.toHaveBeenCalled();
  });

  it("resumes a usage-limited run once its reset time has passed", async () => {
    const { service, outcome } = await handle(
      snapshot("paused", usageLimit("2026-10-21T11:59:00.000Z")),
      snapshot("awaiting-approval"),
    );

    expect(outcome).toBe("advanced");
    expect(service.resume).toHaveBeenCalledTimes(1);
  });

  it("lets a failed resume fail the job, so the queue retries it", async () => {
    const service = {
      status: async () => snapshot("drafting"),
      resume: async () => {
        throw new Error("worker lost its provider connection");
      },
    };
    const handler = createRunJobHandler({
      service,
      workspaceRoot: () => root,
      allowProviderData: true,
      budgetCeiling,
    });

    await expect(handler(job, { requeue: async () => undefined })).rejects.toThrow(
      "worker lost its provider connection",
    );
  });
});
