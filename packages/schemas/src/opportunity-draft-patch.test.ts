import { describe, expect, it } from "vitest";

import { opportunityDraftPatchSchema } from "./opportunity-draft-patch.js";

const requirement = {
  id: "typescript-services",
  text: "Build TypeScript services",
  priority: "critical",
  sourceIds: ["posting"],
};

describe("opportunity draft patch", () => {
  it("accepts the editable fields in their brief shape", () => {
    const patch = {
      role: { value: "Platform Engineer", sourceIds: ["posting"] },
      employer: null,
      requirements: [requirement],
    };

    expect(opportunityDraftPatchSchema.parse(patch)).toEqual(patch);
  });

  it.each([
    ["an empty patch", {}],
    ["a field the person cannot edit", { status: "reviewed" }],
    ["a brief's sources", { sources: [] }],
    ["a requirement without a source", { requirements: [{ ...requirement, sourceIds: [] }] }],
    [
      "an employer entered and edited at once",
      { employer: { value: "Example Ledger", sourceIds: ["posting"] }, candidateEmployer: "Other" },
    ],
  ])("refuses %s", (_name, patch) => {
    expect(opportunityDraftPatchSchema.safeParse(patch).success).toBe(false);
  });
});
