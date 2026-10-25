import type { RunSnapshot } from "@draft-loop/orchestrator";
import type { CreditReservation } from "@draft-loop/storage-postgres";
import { describe, expect, it, vi } from "vitest";

import { runCreditsFields, runCreditsMessage } from "./logging.js";
import {
  creditActionForJob,
  creditActionForRun,
  type RunCreditsClosed,
  tenantRunCredits,
} from "./run-credit-settlement.js";
import type { RunJobOutcome } from "./run-job-handler.js";

const job = { tenantId: "org-north", workspaceId: "workspace-1", runId: "run-1" };
const now = new Date("2026-10-24T12:00:00.000Z");

const draft = { id: "artifact-1" };

/** Only the fields the credit rules read. */
function run(state: string, options: { draft?: boolean; lastError?: object | null } = {}) {
  return {
    runId: job.runId,
    workspaceId: job.workspaceId,
    state,
    artifact: options.draft === true ? draft : null,
    lastError: options.lastError ?? null,
    executionHistory: [],
    totalCostUsd: 0,
  } as unknown as RunSnapshot;
}

function reservation(runId: string, reservedAt = "2026-10-24T11:45:00.000Z"): CreditReservation {
  return {
    runId,
    credits: 2,
    estimateVersion: 1,
    state: "open",
    fromAllowance: 2,
    fromGrants: 0,
    reservedAt,
    closedAt: null,
  };
}

/** The ledger's one-time settle and refund over reservations in memory. */
function fakeTenancy(initial: readonly CreditReservation[], saved: Record<string, RunSnapshot>) {
  const reservations = new Map(initial.map((entry) => [entry.runId, entry]));
  const close = (state: "settled" | "refunded") =>
    vi.fn(async ({ runId }: { runId: string }) => {
      const held = reservations.get(runId);
      if (held === undefined) return { changed: false, reservation: undefined };
      if (held.state !== "open") return { changed: false, reservation: held };
      const closed = { ...held, state, closedAt: now.toISOString() };
      reservations.set(runId, closed);
      return { changed: true, reservation: closed };
    });
  const creditLedger = {
    reservationFor: vi.fn(async (runId: string) => reservations.get(runId)),
    settle: close("settled"),
    refund: close("refunded"),
    openReservationsBefore: vi.fn(async ({ reservedBefore }: { reservedBefore: Date }) =>
      [...reservations.values()].filter(
        (entry) =>
          entry.state === "open" && Date.parse(entry.reservedAt) < reservedBefore.getTime(),
      ),
    ),
  };
  const get = vi.fn(async (key: string) => {
    const saved_ = saved[key.replace("draft-loop:orchestration:run:", "")];
    return saved_ === undefined ? undefined : JSON.stringify(saved_);
  });
  return {
    reservations,
    creditLedger,
    tenancy: { forTenant: () => ({ creditLedger, get }) as never },
  };
}

function credits(
  initial: readonly CreditReservation[],
  saved: Record<string, RunSnapshot> = {},
  extra: { onSweepError?: (tenantId: string, error: unknown) => void } = {},
) {
  const fake = fakeTenancy(initial, saved);
  const closed: RunCreditsClosed[] = [];
  const handler = tenantRunCredits({
    tenancy: fake.tenancy,
    onClosed: (entry) => closed.push(entry),
    now: () => now,
    ...extra,
  });
  return { ...fake, closed, handler };
}

describe("credit action for a run", () => {
  it.each([
    ["awaiting-approval", true, "settle"],
    ["approved", true, "settle"],
    ["exported", true, "settle"],
    ["stopped", true, "settle"],
    ["budget-exhausted", true, "settle"],
    ["provider-error", true, "settle"],
    ["awaiting-approval", false, "refund"],
    ["stopped", false, "refund"],
    ["budget-exhausted", false, "refund"],
    ["provider-error", false, "refund"],
    ["paused", false, "keep"],
    ["paused", true, "keep"],
    ["collecting", false, "keep"],
    ["ingesting", false, "keep"],
    ["drafting", true, "keep"],
    ["reviewing", true, "keep"],
    ["revising", true, "keep"],
  ])("%s with a draft: %s -> %s", (state, hasDraft, expected) => {
    expect(creditActionForRun(run(state, { draft: hasDraft }))).toBe(expected);
  });

  it("keeps a run that waits for its rate limit to be retried, and refunds one that ran out of retries", () => {
    const waiting = run("provider-error", { lastError: { code: "rate-limit", retryable: true } });
    const exhausted = run("provider-error", {
      lastError: { code: "rate-limit", retryable: false },
    });

    expect(creditActionForRun(waiting)).toBe("keep");
    expect(creditActionForRun(exhausted)).toBe("refund");
    expect(creditActionForRun(undefined)).toBe("keep");
  });

  it("keeps a run the worker retries after a rejected output, and refunds one left to the person", () => {
    const retried = run("provider-error", {
      lastError: { code: "invalid-response", retryable: true },
    });
    const credential = run("provider-error", {
      lastError: { code: "authentication", retryable: true },
    });

    expect(creditActionForRun(retried)).toBe("keep");
    expect(creditActionForRun(credential)).toBe("refund");
  });

  it.each<[RunJobOutcome, string]>([
    ["held", "keep"],
    ["rescheduled", "keep"],
    ["over-ceiling", "keep"],
    ["consent-required", "keep"],
    ["material-quarantined", "keep"],
    ["credits-closed", "keep"],
    ["record-erased", "refund"],
    ["missing", "refund"],
  ])("a job that ended %s -> %s whatever the run", (outcome, expected) => {
    expect(creditActionForJob(outcome, run("awaiting-approval", { draft: true }))).toBe(expected);
  });

  it("reads the run when the job advanced it or found it finished", () => {
    expect(creditActionForJob("advanced", run("awaiting-approval", { draft: true }))).toBe(
      "settle",
    );
    expect(creditActionForJob("settled", run("stopped"))).toBe("refund");
    expect(creditActionForJob("advanced", undefined)).toBe("keep");
  });
});

describe("run credits after a job", () => {
  it("settles the reservation of a run with a draft and reports it once, content-free", async () => {
    const { handler, closed, creditLedger } = credits([reservation("run-1")]);

    await handler.afterJob(job, "advanced", run("awaiting-approval", { draft: true }));
    await handler.afterJob(job, "settled", run("awaiting-approval", { draft: true }));

    expect(creditLedger.settle).toHaveBeenCalledOnce();
    expect(creditLedger.refund).not.toHaveBeenCalled();
    expect(closed).toEqual([
      {
        organisationId: "org-north",
        runId: "run-1",
        credits: 2,
        estimateVersion: 1,
        outcome: "settled",
        estimatedUsd: 0,
      },
    ]);
    expect(runCreditsMessage).toBe("run credits settled");
    expect(Object.keys(runCreditsFields(closed[0] as RunCreditsClosed))).toEqual([
      "organisationId",
      "runId",
      "credits",
      "estimateVersion",
      "outcome",
      "estimatedUsd",
    ]);
  });

  it("refunds a run that failed before its first draft", async () => {
    const { handler, closed, reservations } = credits([reservation("run-1")]);

    await handler.afterJob(
      job,
      "advanced",
      run("provider-error", { lastError: { code: "timeout", retryable: false } }),
    );

    expect(reservations.get("run-1")?.state).toBe("refunded");
    expect(closed).toMatchObject([{ outcome: "refunded", credits: 2, estimatedUsd: 0 }]);
  });

  it.each<[string, RunJobOutcome, RunSnapshot | undefined]>([
    ["a user pause", "held", run("paused", { draft: true })],
    ["a usage-limit pause", "rescheduled", run("paused", { lastError: { code: "usage-limit" } })],
    [
      "a rate limit waiting for a retry",
      "rescheduled",
      run("provider-error", { lastError: { code: "rate-limit", retryable: true } }),
    ],
    ["a consent hold", "consent-required", run("paused")],
    ["a quarantine pause", "material-quarantined", run("paused")],
    ["a run above the ceiling", "over-ceiling", run("drafting")],
  ])("keeps the reservation open for %s", async (_label, outcome, snapshot) => {
    const { handler, closed, creditLedger } = credits([reservation("run-1")]);

    await handler.afterJob(job, outcome, snapshot);

    expect(creditLedger.settle).not.toHaveBeenCalled();
    expect(creditLedger.refund).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
  });

  it("does nothing for a run with no reservation", async () => {
    const { handler, closed, creditLedger } = credits([]);

    await handler.afterJob(job, "advanced", run("awaiting-approval", { draft: true }));
    await handler.afterJob(job, "record-erased");

    expect(creditLedger.settle).not.toHaveBeenCalled();
    expect(creditLedger.refund).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
  });

  it("refunds the reservation of a run whose record was erased, with no usage to report", async () => {
    const { handler, closed } = credits([reservation("run-1")]);

    await handler.afterJob(job, "record-erased");

    expect(closed).toMatchObject([{ outcome: "refunded", estimatedUsd: null }]);
  });

  it("knows a refunded run, and only that", async () => {
    const { handler, reservations } = credits([reservation("run-1"), reservation("run-2")]);
    await handler.afterJob(job, "record-erased");
    reservations.set("run-3", { ...reservation("run-3"), state: "settled" });

    await expect(handler.refunded(job)).resolves.toBe(true);
    await expect(handler.refunded({ ...job, runId: "run-2" })).resolves.toBe(false);
    await expect(handler.refunded({ ...job, runId: "run-3" })).resolves.toBe(false);
    await expect(handler.refunded({ ...job, runId: "run-unknown" })).resolves.toBe(false);
  });
});

describe("reconciling stale reservations", () => {
  const stale = "2026-10-24T09:00:00.000Z";
  const recent = "2026-10-24T11:30:00.000Z";
  const other = { ...job, runId: "run-other" };

  it("refunds a stale reservation whose run was never saved, and leaves a recent one", async () => {
    const { handler, reservations, closed } = credits([
      reservation("run-lost", stale),
      reservation("run-new", recent),
    ]);

    await handler.afterJob(other, "held");

    expect(reservations.get("run-lost")?.state).toBe("refunded");
    expect(reservations.get("run-new")?.state).toBe("open");
    expect(closed).toMatchObject([{ runId: "run-lost", outcome: "refunded", estimatedUsd: null }]);
  });

  it("settles or refunds a stale reservation whose run finished with no job to say so", async () => {
    const { handler, reservations } = credits(
      [
        reservation("run-stopped-draft", stale),
        reservation("run-stopped-bare", stale),
        reservation("run-paused", stale),
        reservation("run-working", stale),
      ],
      {
        "run-stopped-draft": run("stopped", { draft: true }),
        "run-stopped-bare": run("stopped"),
        "run-paused": run("paused", { draft: true }),
        "run-working": run("drafting"),
      },
    );

    await handler.afterJob(other, "held");

    expect([...reservations].map(([runId, entry]) => [runId, entry.state])).toEqual([
      ["run-stopped-draft", "settled"],
      ["run-stopped-bare", "refunded"],
      ["run-paused", "open"],
      ["run-working", "open"],
    ]);
  });

  it("never fails the job when the reconciliation fails", async () => {
    const onSweepError = vi.fn();
    const { handler, creditLedger } = credits([reservation("run-1")], {}, { onSweepError });
    creditLedger.openReservationsBefore.mockRejectedValueOnce(new Error("ledger unavailable"));

    await handler.afterJob(job, "advanced", run("awaiting-approval", { draft: true }));

    expect(creditLedger.settle).toHaveBeenCalledOnce();
    expect(onSweepError).toHaveBeenCalledWith("org-north", expect.any(Error));
  });
});
