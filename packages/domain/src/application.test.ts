import { describe, expect, it } from "vitest";
import {
  applicationNameMaxLength,
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

  it("is drafting without runs or while runs are only drafting", () => {
    expect(deriveApplicationStatus([], false)).toBe("drafting");
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
