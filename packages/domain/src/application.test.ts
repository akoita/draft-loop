import { describe, expect, it } from "vitest";
import {
  applicationNameMaxLength,
  applicationStage,
  deriveApplicationStatus,
  normalizeApplicationName,
} from "./application.js";
import { type WorkflowState, workflowStates } from "./index.js";

describe("application name", () => {
  it("trims and accepts 1 to 120 characters", () => {
    expect(normalizeApplicationName("  Acme — Staff Engineer ")).toBe("Acme — Staff Engineer");
    expect(normalizeApplicationName("x".repeat(applicationNameMaxLength))).toHaveLength(120);
  });

  it("rejects blank and over-long names", () => {
    expect(() => normalizeApplicationName("   ")).toThrow(RangeError);
    expect(() => normalizeApplicationName("x".repeat(applicationNameMaxLength + 1))).toThrow(
      RangeError,
    );
  });
});

describe("deriveApplicationStatus", () => {
  it("maps every run state to a status", () => {
    const expected: Record<WorkflowState, string> = {
      collecting: "drafting",
      ingesting: "drafting",
      drafting: "drafting",
      reviewing: "in-review",
      revising: "in-review",
      "awaiting-approval": "in-review",
      paused: "in-review",
      stopped: "in-review",
      "budget-exhausted": "in-review",
      approved: "approved",
      exported: "exported",
    };
    for (const state of workflowStates) {
      expect(deriveApplicationStatus([{ state }], false), state).toBe(expected[state]);
      expect(deriveApplicationStatus([{ state }], true), state).toBe("exported");
    }
  });

  it("is collecting without runs", () => {
    expect(deriveApplicationStatus([], false)).toBe("collecting");
    expect(deriveApplicationStatus([], true)).toBe("exported");
  });

  it("is drafting while runs are only drafting", () => {
    expect(deriveApplicationStatus([{ state: "collecting" }, { state: "drafting" }], false)).toBe(
      "drafting",
    );
  });

  it("is in review once a run is past drafting", () => {
    for (const state of ["reviewing", "revising", "awaiting-approval", "paused", "stopped"]) {
      expect(deriveApplicationStatus([{ state }], false)).toBe("in-review");
    }
  });

  it("is approved once a run is approved, and exported once anything was exported", () => {
    expect(deriveApplicationStatus([{ state: "reviewing" }, { state: "approved" }], false)).toBe(
      "approved",
    );
    expect(deriveApplicationStatus([{ state: "approved" }], true)).toBe("exported");
    expect(deriveApplicationStatus([{ state: "exported" }], false)).toBe("exported");
  });
});

describe("application stage", () => {
  const base = { status: "in-review", runCount: 2, exportCount: 0, newestRunEnded: false } as const;

  it("names where an application stands for the candidate", () => {
    expect(applicationStage({ ...base, status: "collecting", runCount: 0 })).toBe("start-review");
    expect(applicationStage({ ...base, status: "drafting" })).toBe("drafting");
    expect(applicationStage(base)).toBe("reviewing");
    expect(applicationStage({ ...base, newestRunEnded: true })).toBe("review-ended");
    expect(applicationStage({ ...base, status: "approved", newestRunEnded: true })).toBe("export");
    expect(applicationStage({ ...base, exportCount: 1 })).toBe("done");
  });
});
