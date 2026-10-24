import type { ApprovalReadiness } from "@draft-loop/ui/approval-readiness";
import type { CoverageAssessmentView, ReviewCoverageView } from "@draft-loop/ui/coverage-contract";
import { createFixtureReviewState, type DesktopReviewState } from "@draft-loop/ui/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { findingQueueCounts, ReviewWorkspace } from "./review.js";
import { type FooterBlockerKind, footerBlocker } from "./review-footer.js";
import {
  coverageCollapsedSummary,
  coverageTabLabel,
  coverageTally,
  defaultReviewWorkTab,
  findingsTabLabel,
  nextStepLine,
  nextStepTarget,
  ReviewWorkTabs,
  readStoredReviewWorkTab,
  reviewWorkPanelProps,
  reviewWorkTabStorageKey,
  writeStoredReviewWorkTab,
} from "./review-work-tabs.js";

const fixture = createFixtureReviewState();
const knownBlock = fixture.artifact.sections[0]?.blocks[0];
if (knownBlock === undefined) throw new Error("fixture has no block");
// One round below the limit, so a revision is still available.
const reviewed: DesktopReviewState = {
  ...fixture,
  state: "awaiting-approval",
  round: 1,
  findings: [],
};
const relevanceBlocked: ApprovalReadiness = {
  artifactId: fixture.artifact.id,
  artifactVersion: fixture.artifact.version,
  applicationReady: false,
  blockers: [
    { code: "unmet-rubric-threshold", dimension: "relevance", score: 0.22, threshold: 0.8 },
  ],
};
const ready = { ready: true, headline: "Ready to send", reasons: [] } as const;
const blockingFinding = fixture.findings.find((finding) => finding.severity === "error");
if (blockingFinding === undefined) throw new Error("fixture has no blocking finding");

function assessment(index: number, status: CoverageAssessmentView["status"]) {
  return {
    requirementId: `req-${index}`,
    requirementText: `Requirement ${index}`,
    status,
    basis: "judgement" as const,
    evidence: index === 0 ? [{ blockId: knownBlock?.id ?? "" }] : [],
    rationale: `Rationale ${index}.`,
  };
}

// 8 of 17 covered, the shape of the issue's example.
const coverage: ReviewCoverageView = {
  instructionsVersion: null,
  summary: { judged: 17, satisfied: 8, notSatisfied: 9, invalid: 0, unanswered: 0 },
  assessments: Array.from({ length: 17 }, (_, index) =>
    assessment(index, index < 8 ? "covered" : index % 2 === 0 ? "uncovered" : "needs-judgement"),
  ),
};

function next(
  state: DesktopReviewState,
  readiness: ApprovalReadiness | null = null,
  verdict: Parameters<typeof footerBlocker>[2] = null,
): { kind: FooterBlockerKind; line: string } {
  const blocker = footerBlocker(state, readiness, verdict);
  return { kind: blocker.kind, line: nextStepLine(state, blocker, readiness) };
}

describe("nextStepLine", () => {
  it("waits for a draft, then exports, then stops", () => {
    expect(next({ ...reviewed, artifact: { ...reviewed.artifact, version: 0 } })).toEqual({
      kind: "no-artifact",
      line: "Next: resume or start a review to get a draft",
    });
    expect(
      next({
        ...reviewed,
        artifact: { ...reviewed.artifact, version: 0 },
        state: "drafting",
      }),
    ).toEqual({ kind: "no-artifact", line: "Next: wait for the review" });
    expect(next({ ...reviewed, state: "approved", approval: "approved" })).toEqual({
      kind: "approved",
      line: "Next: export",
    });
    expect(
      next({ ...reviewed, state: "exported", approval: "approved", exportPath: "/tmp/cv.md" }),
    ).toEqual({ kind: "exported", line: "Next: nothing left · the CV is exported" });
    expect(
      next({ ...reviewed, state: "exported", approval: "approved", exportPath: null }),
    ).toEqual({ kind: "exported", line: "Next: export again to save a new copy" });
  });

  it("names what the reviewer is waiting on", () => {
    const running: DesktopReviewState = {
      ...reviewed,
      state: "reviewing",
      execution: { ...reviewed.execution, status: "running" },
    };
    expect(next(running)).toEqual({ kind: "waiting", line: "Next: wait for the review" });
    expect(next({ ...reviewed, round: 3, reviewComplete: false }).line).toBe(
      "Next: return to reviewed Round 2",
    );
    expect(next({ ...reviewed, state: "paused", reviewComplete: false }).line).toBe(
      "Next: resume the review",
    );
    expect(next({ ...reviewed, state: "stopped", reviewComplete: false }).line).toBe(
      "Next: start a new review",
    );
    expect(next({ ...reviewed, reviewComplete: false }).line).toBe(
      "Next: resume or retry the review",
    );
    expect(next({ ...reviewed, state: "provider-error" }, null, ready)).toEqual({
      kind: "waiting",
      line: "Next: recover from the provider error",
    });
  });

  it("counts the blocking findings still to decide", () => {
    const pending = { ...blockingFinding, decision: "pending" as const };
    expect(next({ ...reviewed, findings: [pending] })).toEqual({
      kind: "findings",
      line: "Next: decide 1 blocking finding",
    });
    expect(next({ ...reviewed, findings: [pending, { ...pending, id: "second" }] }).line).toBe(
      "Next: decide 2 blocking findings",
    );
    const accepted = { ...blockingFinding, decision: "accepted" as const };
    expect(next({ ...reviewed, findings: [accepted] }).line).toBe("Next: request a revision");
    // At the round limit an accepted finding cannot be revised, so it still needs a decision.
    expect(next({ ...reviewed, round: 2, findings: [accepted] }).line).toBe(
      "Next: decide 1 blocking finding",
    );
  });

  it("names the failing final check", () => {
    expect(next(reviewed, relevanceBlocked)).toEqual({
      kind: "final-checks",
      line: "Next: approve or override (relevance 22%)",
    });
    expect(
      next(reviewed, {
        ...relevanceBlocked,
        blockers: [...relevanceBlocked.blockers, { code: "disputed-dimension" }],
      }).line,
    ).toBe("Next: approve or override (relevance 22% and 1 more)");
  });

  it("asks for approval once nothing blocks it", () => {
    expect(next(reviewed, null, ready)).toEqual({ kind: "ready", line: "Next: approve" });
    expect(
      next(reviewed, null, { ready: false, headline: "Not ready to send yet", reasons: ["x"] }),
    ).toEqual({ kind: "ready", line: "Next: check the warnings, then approve" });
  });
});

describe("nextStepTarget", () => {
  it("links only the steps that happen in the queue or at the gate", () => {
    const pending = { ...blockingFinding, decision: "pending" as const };
    const accepted = { ...blockingFinding, decision: "accepted" as const };
    const cases: readonly [DesktopReviewState, ApprovalReadiness | null, string | null][] = [
      [{ ...reviewed, findings: [pending] }, null, "findings"],
      [{ ...reviewed, findings: [accepted] }, null, "findings"],
      [reviewed, relevanceBlocked, "approval-gate"],
      [reviewed, null, null],
      [{ ...reviewed, reviewComplete: false }, null, null],
      [{ ...reviewed, state: "approved", approval: "approved" }, null, null],
      [{ ...reviewed, state: "exported", approval: "approved", exportPath: "/x.md" }, null, null],
      [{ ...reviewed, artifact: { ...reviewed.artifact, version: 0 } }, null, null],
    ];
    for (const [state, readiness, target] of cases) {
      expect(nextStepTarget(footerBlocker(state, readiness, ready))).toBe(target);
    }
  });
});

describe("coverage summary", () => {
  it("tallies covered requirements against every assessed one", () => {
    expect(coverageTally(coverage)).toEqual({ covered: 8, total: 17, notCovered: 9 });
    expect(coverageCollapsedSummary(coverage)).toBe("8 of 17 covered · 9 not covered");
    expect(coverageTabLabel(coverage)).toEqual({
      id: "coverage",
      label: "Coverage · 8/17",
      ariaLabel: "Coverage, 8 of 17 covered",
    });
  });

  it("drops the not-covered count when everything is covered, and says when nothing was assessed", () => {
    const allCovered = {
      ...coverage,
      assessments: coverage.assessments.slice(0, 3),
    };
    expect(coverageCollapsedSummary(allCovered)).toBe("3 of 3 covered");
    expect(coverageCollapsedSummary({ ...coverage, assessments: [] })).toBe(
      "No requirements assessed",
    );
  });
});

describe("tab choice", () => {
  it("opens on Findings only when a finding needs action", () => {
    expect(defaultReviewWorkTab(2)).toBe("findings");
    expect(defaultReviewWorkTab(0)).toBe("coverage");
    expect(findingsTabLabel(2)).toEqual({
      id: "findings",
      label: "Findings · 2",
      ariaLabel: "Findings, 2 need action",
    });
    expect(findingsTabLabel(0).label).toBe("Findings · 0");
  });

  it("remembers a valid choice and survives a blocked store", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    expect(readStoredReviewWorkTab(storage)).toBeNull();
    writeStoredReviewWorkTab(storage, "coverage");
    expect(values.get(reviewWorkTabStorageKey)).toBe("coverage");
    expect(readStoredReviewWorkTab(storage)).toBe("coverage");
    values.set(reviewWorkTabStorageKey, "gate");
    expect(readStoredReviewWorkTab(storage)).toBeNull();
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredReviewWorkTab(throwing)).toBeNull();
    expect(() => writeStoredReviewWorkTab(throwing, "findings")).not.toThrow();
  });
});

describe("review work tabs", () => {
  it("renders a tablist with a roving tabindex that points at the panels", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkTabs
        next="Next: approve"
        selected="coverage"
        onSelect={() => undefined}
        tabs={[
          findingsTabLabel(0),
          { id: "coverage", label: "Coverage · 1/1", ariaLabel: "Coverage, 1 of 1 covered" },
        ]}
      />,
    );
    expect(html).toContain('<p class="next-step-line">Next: approve</p>');
    expect(html).toContain('role="tablist" aria-label="Review work"');
    expect(html).toContain(
      'role="tab" id="review-work-tab-findings" aria-selected="false" aria-controls="findings-panel" aria-label="Findings, 0 need action" tabindex="-1">Findings · 0</button>',
    );
    expect(html).toContain(
      'role="tab" id="review-work-tab-coverage" aria-selected="true" aria-controls="coverage-panel" aria-label="Coverage, 1 of 1 covered" tabindex="0">Coverage · 1/1</button>',
    );
  });

  it("renders an actionable step as a link-style button named by the step", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkTabs
        next="Next: decide 1 blocking finding"
        onNext={() => undefined}
        selected="findings"
        onSelect={() => undefined}
        tabs={[findingsTabLabel(1)]}
      />,
    );
    expect(html).toContain(
      '<p class="next-step-line"><button class="next-step-action" type="button">Next: decide 1 blocking finding</button></p>',
    );
  });

  it("drops the tablist when there is only one panel", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkTabs
        next="Next: approve"
        selected="findings"
        onSelect={() => undefined}
        tabs={[findingsTabLabel(0)]}
      />,
    );
    expect(html).toBe('<div class="review-work"><p class="next-step-line">Next: approve</p></div>');
  });

  it("labels a tabbed panel by its tab and hides the unselected one", () => {
    expect(reviewWorkPanelProps("findings", "coverage", true)).toEqual({
      role: "tabpanel",
      id: "findings-panel",
      "aria-labelledby": "review-work-tab-findings",
      "aria-label": undefined,
      hidden: true,
    });
    expect(reviewWorkPanelProps("coverage", "coverage", true)).toMatchObject({
      id: "coverage-panel",
      hidden: false,
    });
    expect(reviewWorkPanelProps("findings", "findings", false)).toBeNull();
  });
});

describe("work tabs in the review workspace", () => {
  function render(state: DesktopReviewState): string {
    return renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
  }

  it("opens on Findings with the counts in both tab labels", () => {
    const needsAction = findingQueueCounts(fixture.findings).needsAction;
    expect(needsAction).toBeGreaterThan(0);
    const html = render({ ...fixture, coverage });
    expect(html).toContain(
      `aria-label="Findings, ${needsAction} need action" tabindex="0">Findings · ${needsAction}</button>`,
    );
    expect(html).toContain(
      'aria-label="Coverage, 8 of 17 covered" tabindex="-1">Coverage · 8/17</button>',
    );
    expect(html).toContain('id="review-work-tab-findings" aria-selected="true"');
    expect(html).toContain('id="review-work-tab-coverage" aria-selected="false"');
    expect(html).toContain(
      '<p class="next-step-line"><button class="next-step-action" type="button">Next: decide 1 blocking finding</button></p>',
    );
    // The tabs name the panels; both stay mounted, and only the selected one shows.
    const findingsTag = html.match(/<section class="panel findings-panel"[^>]*>/u)?.[0] ?? "";
    expect(findingsTag).toContain('role="tabpanel"');
    expect(findingsTag).toContain('aria-labelledby="review-work-tab-findings"');
    expect(findingsTag).not.toContain("hidden");
    expect(findingsTag).not.toContain("aria-label=");
    const coverageTag = html.match(/<section class="panel coverage-panel"[^>]*>/u)?.[0] ?? "";
    expect(coverageTag).toContain('role="tabpanel" id="coverage-panel"');
    expect(coverageTag).toContain('aria-labelledby="review-work-tab-coverage" hidden=""');
  });

  it("opens on Coverage once every finding is resolved, with the cards folded", () => {
    const resolved = fixture.findings.map((finding) => ({
      ...finding,
      decision: "rejected" as const,
    }));
    const html = render({ ...fixture, findings: resolved, coverage });
    expect(html).toContain(">Findings · 0</button>");
    // Nothing to go to: the "Next:" line stays plain text.
    expect(html).toContain('<p class="next-step-line">Next: approve</p>');
    expect(html).toContain('id="review-work-tab-coverage" aria-selected="true"');
    expect(html).toContain(
      '<span class="coverage-tally">8 of 17 covered · 9 not covered</span> · <button class="coverage-fold-toggle" type="button" aria-expanded="false" aria-controls="coverage-panel-body">show all</button>',
    );
    expect(html).toContain('id="coverage-panel-body" hidden=""');
    // Folded cards keep their markup, so "show all" only unhides them.
    expect(html.match(/class="coverage-row /gu)).toHaveLength(17);
  });

  it("links a findings step to the queue and a final-check step to the gate", () => {
    expect(render({ ...fixture, coverage })).toContain(
      '<button class="next-step-action" type="button">Next: decide 1 blocking finding</button>',
    );
    const html = render({
      ...reviewed,
      approvalReadiness: relevanceBlocked,
    });
    expect(html).toContain(
      '<button class="next-step-action" type="button">Next: approve or override (relevance 22%)</button>',
    );
  });

  it("shows only the findings queue when the run has no coverage", () => {
    const html = render(fixture);
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('aria-label="critique findings"');
    expect(html).toContain(
      '<p class="next-step-line"><button class="next-step-action" type="button">Next: decide 1 blocking finding</button></p>',
    );
  });
});
