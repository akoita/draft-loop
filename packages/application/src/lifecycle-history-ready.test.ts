import type { RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import {
  assertLifecycleHistoryReady,
  historySaveWindowMs,
  RunHistoryNotReadyError,
} from "./lifecycle-decision.js";

const updatedAt = "2026-11-19T04:24:36.000Z";
const now = Date.parse(updatedAt) + 500;

function run(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    runId: "run-1",
    state: "awaiting-approval",
    round: 1,
    updatedAt,
    artifact: { id: "artifact-1" },
    ...overrides,
  } as RunSnapshot;
}

function history(saved: { round?: boolean; artifact?: boolean }) {
  return {
    getRound: async (id: string) =>
      saved.round === true && id === "run-1:round:1" ? ({ id } as never) : undefined,
    getArtifactVersion: async (id: string) =>
      saved.artifact === true ? ({ id } as never) : undefined,
  };
}

describe("lifecycle history readiness", () => {
  it("refuses a revision while the round's history is still being saved", async () => {
    await expect(
      assertLifecycleHistoryReady(history({ artifact: true }), "revision", run(), now),
    ).rejects.toBeInstanceOf(RunHistoryNotReadyError);
    await expect(
      assertLifecycleHistoryReady(history({ round: true }), "approve", run(), now),
    ).rejects.toBeInstanceOf(RunHistoryNotReadyError);
  });

  it("lets the action through once the round and draft are saved", async () => {
    await expect(
      assertLifecycleHistoryReady(history({ round: true, artifact: true }), "revision", run(), now),
    ).resolves.toBeUndefined();
  });

  it("does not wait for history on other actions, other states or long-settled runs", async () => {
    const empty = history({});
    await expect(assertLifecycleHistoryReady(empty, "pause", run(), now)).resolves.toBeUndefined();
    await expect(
      assertLifecycleHistoryReady(empty, "revision", run({ state: "drafting" }), now),
    ).resolves.toBeUndefined();
    await expect(
      assertLifecycleHistoryReady(
        empty,
        "approve",
        run(),
        Date.parse(updatedAt) + historySaveWindowMs + 1,
      ),
    ).resolves.toBeUndefined();
  });
});
