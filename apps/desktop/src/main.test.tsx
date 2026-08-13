import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createFixtureReviewState,
  reduceReviewState,
  reviewFindingSummary,
  unresolvedBlockingFindings,
} from "./model.js";
import { ReviewWorkspace } from "./review.js";

describe("desktop trust-centered review", () => {
  it("shows honest onboarding for a real workspace without inputs", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "collecting" as const,
      runId: "pending",
      setup: {
        fixtureMode: false,
        jobDescriptionReady: false,
        evidenceSourceCount: 0,
        ready: false,
        nextSteps: ["Add a target job description.", "Add at least one candidate evidence source."],
      },
    };
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={state}
        onAction={() => undefined}
        onSelectFiles={() => undefined}
        onAddUrl={() => undefined}
      />,
    );

    expect(html).toContain("Bring your evidence into the loop");
    expect(html).toContain("Add job description");
    expect(html).toContain("Review and fetch evidence URL");
    expect(html).toContain("Start author–critic review");
  });

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
      rationale: "Verified against the candidate's original source.",
    });
    const readyForApproval = { ...overridden, state: "awaiting-approval" as const };
    const approved = reduceReviewState(readyForApproval, { type: "approve" });
    expect(approved.state).toBe("approved");
    expect(approved.approval).toBe("approved");
  });

  it("distinguishes non-blocking warnings from approval blockers", () => {
    const initial = createFixtureReviewState();
    const warningOnly = {
      ...initial,
      state: "awaiting-approval" as const,
      findings: initial.findings.map((finding) =>
        finding.severity === "error"
          ? {
              ...finding,
              decision: "overridden" as const,
              rationale: "Verified against the candidate's original source.",
            }
          : finding,
      ),
    };

    expect(reviewFindingSummary(warningOnly)).toMatchObject({
      blocking: [],
      warnings: [{ id: "finding-coverage" }],
      status: "warnings",
    });
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={warningOnly} onAction={() => undefined} />,
    );
    expect(html).toContain("1 unresolved warning");
    expect(html).toContain("Approval is available with 1 unresolved non-blocking warning");
    expect(reduceReviewState(warningOnly, { type: "approve" }).approval).toBe("approved");
  });

  it("does not accept an override without a rationale", () => {
    const initial = createFixtureReviewState();
    const unchanged = reduceReviewState(initial, {
      type: "finding-decision",
      findingId: "finding-unsupported-claim",
      decision: "overridden",
    });
    expect(unchanged.findings[0]?.decision).toBe("pending");
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
