import { describe, expect, it } from "vitest";

import {
  policyChanged,
  policyStatus,
  policyTextProblem,
  type WritingPolicy,
  writingPolicyLimitBytes,
} from "./policy-model.js";

const policy: WritingPolicy = {
  checksum: "c".repeat(64),
  version: "sha256:cccccccccccc",
  createdAt: "2026-10-23T08:00:00.000Z",
  priorChecksum: null,
  content: "# Writing policy\n\nKeep each bullet to one sentence.",
};

describe("writing policy model", () => {
  it("asks for text, and refuses text over the API's limit in bytes", () => {
    expect(policyTextProblem("  \n")).toBe("Write the policy before saving it.");
    expect(policyTextProblem("é".repeat(writingPolicyLimitBytes / 2 + 1))).toContain("64 KiB");
    expect(policyTextProblem(policy.content)).toBeUndefined();
  });

  it("says which version runs follow, or that there is none", () => {
    expect(policyStatus(undefined)).toContain("No writing policy yet");
    expect(policyStatus(policy)).toBe("Runs follow version sha256:cccccccccccc, saved 2026-10-23.");
  });

  it("offers a save only when the text differs from the saved policy", () => {
    expect(policyChanged(policy, `${policy.content}\n`)).toBe(false);
    expect(policyChanged(policy, "# Another policy")).toBe(true);
    expect(policyChanged(undefined, "")).toBe(false);
  });
});
