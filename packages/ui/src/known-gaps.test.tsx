import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dispatchFindingDecisions } from "./app.js";
import { findingTitle } from "./finding-title.js";
import {
  isConfirmedCoverageGap,
  KNOWN_GAP_RATIONALE,
  MARK_KNOWN_GAPS_NOTE,
  markKnownGapsLabel,
  pendingConfirmedGapIds,
} from "./known-gaps.js";
import {
  createFixtureReviewState,
  type DesktopReviewState,
  type ReviewAction,
  type ReviewFinding,
  reduceReviewState,
} from "./model.js";
import { ReviewWorkspace } from "./review.js";

function gap(id: string, overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id,
    code: "uncovered-requirement",
    category: "coverage",
    severity: "error",
    message: "Requirement is not covered by deterministic token matching.",
    decision: "pending",
    agreement: "critic-only",
    requirement: { id: `req-${id}`, text: "Five years of synthetic platform work" },
    ...overrides,
  };
}

function stateWith(findings: readonly ReviewFinding[]): DesktopReviewState {
  return { ...createFixtureReviewState(), findings };
}

describe("confirmed coverage gaps (#1873)", () => {
  it("titles a confirmed gap as missing evidence and keeps the word-match title otherwise", () => {
    expect(findingTitle(gap("a"))).toBe(
      "No evidence found for: Five years of synthetic platform work",
    );
    expect(findingTitle(gap("b", { severity: "warning" }))).toBe(
      "Not found in the CV wording: Five years of synthetic platform work",
    );
  });

  it("lists only pending confirmed gaps", () => {
    const findings = [
      gap("pending"),
      gap("accepted", { decision: "accepted" }),
      gap("rejected", { decision: "rejected" }),
      gap("warning", { severity: "warning" }),
      gap("other", { code: "unsupported-claim", category: "factuality" }),
    ];
    expect(findings.map(isConfirmedCoverageGap)).toEqual([true, true, true, false, false]);
    expect(pendingConfirmedGapIds(findings)).toEqual(["pending", "accepted"]);
    expect(markKnownGapsLabel(0)).toBeNull();
    expect(markKnownGapsLabel(1)).toBe("Mark 1 confirmed gap as known");
    expect(markKnownGapsLabel(6)).toBe("Mark 6 confirmed gaps as known");
  });

  it("offers one action for every pending confirmed gap in the review", () => {
    const state = { ...stateWith([gap("a"), gap("b"), gap("c", { severity: "warning" })]) };
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={state}
        onAction={() => undefined}
        onMarkKnownGaps={() => undefined}
      />,
    );
    expect(html).toContain("Mark 2 confirmed gaps as known");
    expect(html).toContain(MARK_KNOWN_GAPS_NOTE);
    expect(html).toContain("No evidence found for: Five years of synthetic platform work");
  });

  it("records each gap as an override with the known-gap reason", async () => {
    const initial = stateWith([gap("a"), gap("b")]);
    const actions: ReviewAction[] = [];
    const result = await dispatchFindingDecisions(
      initial,
      ["a", "b"],
      "overridden",
      async (state, action) => {
        actions.push(action);
        return reduceReviewState(state, action);
      },
      () => undefined,
      KNOWN_GAP_RATIONALE,
    );
    expect(actions).toEqual(
      ["a", "b"].map((findingId) => ({
        type: "finding-decision",
        findingId,
        decision: "overridden",
        rationale: KNOWN_GAP_RATIONALE,
      })),
    );
    expect(result.findings.map((finding) => finding.decision)).toEqual([
      "overridden",
      "overridden",
    ]);
  });
});
