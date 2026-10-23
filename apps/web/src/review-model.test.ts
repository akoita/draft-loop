import { describe, expect, it } from "vitest";

import {
  blockEditProblem,
  decisionRequest,
  pendingCount,
  reviewOpen,
  reviewSections,
} from "./review-model.js";
import { syntheticReview } from "./test-fixtures.js";

const draft = syntheticReview.draft;
const coverageFinding = syntheticReview.findings[1];
if (draft === null || coverageFinding === undefined) throw new Error("The fixture has a draft.");

describe("review sections", () => {
  it("puts each claim's evidence and finding with its section", () => {
    const { sections, general } = reviewSections(draft, syntheticReview.findings);

    expect(sections.map((section) => section.title)).toEqual(["Experience", "Skills"]);
    expect(sections[0]?.blocks[0]?.claims[0]?.evidence[0]?.sourcePath).toBe("career.md");
    expect(sections[0]?.findings.map((finding) => finding.id)).toEqual(["finding-1"]);
    expect(sections[1]?.findings).toEqual([]);
    expect(general.map((finding) => finding.id)).toEqual(["finding-2"]);
  });

  it("places a finding about a section by its id", () => {
    const { sections, general } = reviewSections(draft, [
      { ...coverageFinding, sectionId: "skills" },
    ]);

    expect(sections[1]?.findings).toHaveLength(1);
    expect(general).toEqual([]);
  });
});

describe("decisions and edits", () => {
  it("needs a reason to override", () => {
    expect(decisionRequest("overridden", " ")).toEqual({
      problem: "Say why the draft stays as it is.",
    });
    expect(decisionRequest("overridden", " Accurate as written ")).toEqual({
      body: { decision: "overridden", rationale: "Accurate as written" },
    });
    expect(decisionRequest("accepted", "")).toEqual({ body: { decision: "accepted" } });
  });

  it("checks an edited block", () => {
    expect(blockEditProblem("Led migrations")).toBeUndefined();
    expect(blockEditProblem("  ")).toBe("A block cannot be empty.");
    expect(blockEditProblem("a".repeat(4_001))).toBe("Keep a block to 4000 characters.");
  });

  it("opens the review only while the run awaits approval", () => {
    expect(reviewOpen(syntheticReview)).toBe(true);
    expect(
      reviewOpen({ ...syntheticReview, run: { ...syntheticReview.run, state: "approved" } }),
    ).toBe(false);
    expect(pendingCount(syntheticReview.findings)).toBe(1);
  });
});
