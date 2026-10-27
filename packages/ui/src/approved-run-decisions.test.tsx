import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createFixtureReviewState, type ReviewFinding } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const fixture = createFixtureReviewState();
const pending: ReviewFinding = {
  id: "finding-pending-warning",
  code: "uncovered-requirement",
  category: "coverage",
  severity: "warning",
  message: "Requirement R1 is not covered.",
  decision: "pending",
  agreement: "author-and-critic",
};
const findings = [...fixture.findings, pending];

function render(state: (typeof fixture)["state"]): string {
  return renderToStaticMarkup(
    <ReviewWorkspace
      state={{
        ...fixture,
        state,
        findings,
        approval: state === "approved" ? "approved" : "pending",
      }}
      onAction={() => undefined}
      onBulkFindingDecision={() => undefined}
    />,
  );
}

/** The finding decision buttons a person could press. */
function enabledDecisionButtons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>(Accept|Reject|Defer|Override)<\/button>/gu)]
    .filter((match) => !match[0].includes('disabled=""'))
    .map((match) => match[1] ?? "");
}

describe("finding decisions on an approved run (#1830)", () => {
  it("offers bulk and single decisions while the run awaits approval", () => {
    const html = render("awaiting-approval");
    expect(html).toContain("Accept all");
    expect(enabledDecisionButtons(html).length).toBeGreaterThan(0);
  });

  it("drops the bulk actions and locks each decision once the run is approved", () => {
    for (const state of ["approved", "exported"] as const) {
      const html = render(state);
      expect(html).not.toContain("Accept all");
      expect(html).not.toContain("Reject all");
      expect(html).not.toContain("Defer all");
      expect(enabledDecisionButtons(html)).toEqual([]);
    }
  });
});
