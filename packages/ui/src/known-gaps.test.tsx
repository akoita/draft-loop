import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dispatchFindingDecisions } from "./app.js";
import { findingTitle } from "./finding-title.js";
import {
  isConfirmedCoverageGap,
  KNOWN_GAP_RATIONALE,
  knownGapReadinessOverride,
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

describe("settled known gaps at approval (#1903)", () => {
  const wordMatch = {
    applicationReady: false,
    blockers: [{ code: "deterministic-error", check: "uncovered-requirement" }],
  } as const;
  const known = { decision: "overridden", rationale: KNOWN_GAP_RATIONALE } as const;

  it("turns the known-gap reasons into the readiness override", () => {
    expect(knownGapReadinessOverride(wordMatch, [gap("a", known)])).toBe(KNOWN_GAP_RATIONALE);
    expect(
      knownGapReadinessOverride(wordMatch, [
        gap("a", known),
        gap("b", known),
        gap("c", { decision: "rejected", rationale: "The job ad lists it as a nice-to-have." }),
        gap("warning", { severity: "warning" }),
      ]),
    ).toBe(
      `3 known gaps settled in review: ${KNOWN_GAP_RATIONALE}; The job ad lists it as a nice-to-have.`,
    );
    const long = knownGapReadinessOverride(wordMatch, [
      gap("a", { decision: "overridden", rationale: "x".repeat(600) }),
    ]);
    expect(long).toHaveLength(500);
    expect(long?.endsWith("…")).toBe(true);
  });

  it("still needs the override while another check fails or a gap is unsettled", () => {
    const mixed = {
      applicationReady: false,
      blockers: [
        ...wordMatch.blockers,
        { code: "deterministic-error", check: "missing-cv-header" },
      ],
    } as const;
    expect(knownGapReadinessOverride(mixed, [gap("a", known)])).toBeNull();
    expect(
      knownGapReadinessOverride(
        { applicationReady: false, blockers: [{ code: "unmet-rubric-threshold" }] },
        [gap("a", known)],
      ),
    ).toBeNull();
    expect(knownGapReadinessOverride(wordMatch, [gap("a", known), gap("b")])).toBeNull();
    expect(knownGapReadinessOverride(wordMatch, [gap("a", { decision: "accepted" })])).toBeNull();
    expect(knownGapReadinessOverride(wordMatch, [])).toBeNull();
  });

  it("needs nothing when no final check fails", () => {
    expect(knownGapReadinessOverride(null, [gap("a", known)])).toBeNull();
    expect(
      knownGapReadinessOverride({ applicationReady: true, blockers: [] }, [gap("a", known)]),
    ).toBeNull();
  });

  it("lets Approve record the reasons without a separate override", () => {
    const fixture = createFixtureReviewState();
    const state: DesktopReviewState = {
      ...fixture,
      state: "awaiting-approval",
      findings: [gap("a", known), gap("b", known)],
      approvalReadiness: {
        artifactId: fixture.artifact.id,
        artifactVersion: fixture.artifact.version,
        ...wordMatch,
      },
    };
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain("Approving records your reasons as the override.");
    expect(html).not.toContain("Final CV checks block approval");
    expect(html).not.toContain("Approve with override");
    expect(html).toMatch(/title="Approve artifact \(Alt\+A\)"(?! disabled)/u);
  });

  it("keeps Approve disabled and the override offered when another check fails", () => {
    const fixture = createFixtureReviewState();
    const state: DesktopReviewState = {
      ...fixture,
      state: "awaiting-approval",
      findings: [gap("a", known)],
      approvalReadiness: {
        artifactId: fixture.artifact.id,
        artifactVersion: fixture.artifact.version,
        applicationReady: false,
        blockers: [
          { code: "deterministic-error", check: "uncovered-requirement" },
          { code: "deterministic-error", check: "missing-cv-header" },
        ],
      },
    };
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain("Final CV checks block approval");
    expect(html).toContain("Approve with override");
    expect(html).toMatch(/title="Approve artifact \(Alt\+A\)" disabled=""/u);
  });
});
