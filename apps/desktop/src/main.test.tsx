import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createFixtureReviewState,
  reduceReviewState,
  unresolvedBlockingFindings,
} from "./model.js";
import { ReviewWorkspace } from "./review.js";

describe("desktop trust-centered review", () => {
  it("makes paused progress, provider exposure, and unresolved findings visible", () => {
    const state = createFixtureReviewState();
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain("paused");
    expect(html).toContain("Transmission approved");
    expect(html).toContain("Disagreement · critic-only finding");
    expect(html).toContain("Resolve or override 1 blocking finding before approval.");
    expect(html).toContain('disabled=""');
    expect(html).toContain("Export Markdown");
  });

  it("requires an explicit override before approval can be committed", () => {
    const initial = createFixtureReviewState();
    expect(unresolvedBlockingFindings(initial)).toHaveLength(1);
    const blocked = reduceReviewState(initial, { type: "approve" });
    expect(blocked.state).toBe("paused");

    const overridden = reduceReviewState(initial, {
      type: "finding-decision",
      findingId: "finding-unsupported-claim",
      decision: "overridden",
    });
    const readyForApproval = { ...overridden, state: "awaiting-approval" as const };
    const approved = reduceReviewState(readyForApproval, { type: "approve" });
    expect(approved.state).toBe("approved");
    expect(approved.approval).toBe("approved");
  });

  it("keeps export unavailable until after approval", () => {
    const state = createFixtureReviewState();
    expect(reduceReviewState(state, { type: "export" }).state).toBe("paused");
    const approved = {
      ...state,
      state: "approved" as const,
      approval: "approved" as const,
      findings: state.findings.map((finding) => ({ ...finding, decision: "overridden" as const })),
    };
    expect(reduceReviewState(approved, { type: "export" }).state).toBe("exported");
  });
});
