import type { ReviewFinding } from "@draft-loop/ui/model";
import { describe, expect, it } from "vitest";

import { groupRepeatedWarnings } from "./finding-groups.js";
import type { ReviewDecisions } from "./review-state.js";

function finding(id: string, overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id,
    code: "dense-bullet-series",
    category: "quality",
    severity: "warning",
    message: "4 bullets in a row; keep at most 3 and put a paragraph between series",
    decision: "pending",
    agreement: "critic-only",
    ...overrides,
  };
}

const titles = new Map([
  ["experience", "Experience"],
  ["skills", "Skills"],
]);

function decisions(entries: Record<string, ReviewFinding["decision"]> = {}): ReviewDecisions {
  return { decisions: entries, rationales: {}, edits: {}, history: [] };
}

describe("repeated warnings in the review", () => {
  it("shows one rule's warnings as one finding that lists its places, under the first id", () => {
    const blocking = finding("f-0", { code: "unsupported-claim", severity: "error" });
    const shown = groupRepeatedWarnings(
      [
        blocking,
        finding("f-1", { sectionId: "experience" }),
        finding("f-2", { sectionId: "skills", message: "section is 5 one-line bullets" }),
        finding("f-3"),
      ],
      titles,
      decisions(),
    );

    expect(shown.map(({ id }) => id)).toEqual(["f-0", "f-1"]);
    expect(shown[0]).toBe(blocking);
    expect(shown[1]).toMatchObject({ sectionId: "experience", decision: "pending" });
    expect(shown[1]?.message).toBe(
      "Found in 3 places. Experience: 4 bullets in a row; keep at most 3 and put a paragraph between series. Skills: section is 5 one-line bullets. 4 bullets in a row; keep at most 3 and put a paragraph between series.",
    );
  });

  it("leaves a single warning, blocking findings and a requirement's warnings as they are", () => {
    const requirement = { id: "r-1", text: "Build TypeScript services" };
    const findings = [
      finding("f-1"),
      finding("f-2", { code: "duplicate-content" }),
      finding("f-3", { code: "missing", category: "coverage", requirement }),
      finding("f-4", { code: "missing", category: "coverage", requirement }),
      finding("f-5", { code: "unsupported-claim", severity: "error" }),
      finding("f-6", { code: "unsupported-claim", severity: "error" }),
    ];

    expect(groupRepeatedWarnings(findings, titles, decisions())).toEqual(findings);
  });

  it("shows the group's one decision, also one recorded on a member before grouping", () => {
    const findings = [finding("f-1"), finding("f-2")];
    const decided = groupRepeatedWarnings(findings, titles, {
      ...decisions({ "f-1": "rejected" }),
      rationales: { "f-1": "Short bullets suit this section." },
    });
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({
      id: "f-1",
      decision: "rejected",
      rationale: "Short bullets suit this section.",
    });

    const earlier = groupRepeatedWarnings(findings, titles, decisions({ "f-2": "deferred" }));
    expect(earlier[0]).toMatchObject({ id: "f-1", decision: "deferred" });
  });
});
