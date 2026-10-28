import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequirementCoveragePanel } from "./coverage-panel.js";
import {
  ACCEPT_UNAVAILABLE_NOTE,
  ACCEPTED_WITHOUT_REVISION_NUDGE,
  acceptedWithoutRevision,
  acceptUnavailable,
  BULK_ACCEPT_SKIPS_BLOCKING_NOTE,
  BULK_ACCEPT_SKIPS_WORD_MATCH_NOTE,
  bulkBlockingSkipNote,
  bulkDecisionTargetsForDecision,
  bulkWordMatchWarning,
  COVERAGE_INFORMATION_NOTE,
  findingDecisionEffects,
} from "./finding-decision-help.js";
import { createFixtureReviewState, type ReviewFinding } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const fixture = createFixtureReviewState();
// The fixture sits at its round limit; one round earlier a revision is still possible.
const revisable = { ...fixture, state: "awaiting-approval" as const, round: 1 };
const atLimit = { ...fixture, state: "awaiting-approval" as const };

function wordMatchWarning(id: string): ReviewFinding {
  return {
    id,
    code: "uncovered-requirement",
    category: "coverage",
    severity: "warning",
    message: `Requirement ${id} has no matching wording.`,
    decision: "pending",
    agreement: "author-and-critic",
  };
}

describe("finding decision effects", () => {
  it("says what each decision does to a blocking finding while a revision is available", () => {
    expect(findingDecisionEffects({ severity: "error" }, { revisionAvailable: true })).toEqual({
      accepted: "the next revision fixes it; approval stays locked until then",
      rejected: "the finding is wrong; unblocks approval",
      overridden: "keep the draft as is, with a reason; unblocks approval",
      deferred: "decide later; still blocks approval",
    });
  });

  it("says Accept leaves a blocking finding locked when no revision is left", () => {
    const effects = findingDecisionEffects({ severity: "error" }, { revisionAvailable: false });
    expect(effects.accepted).toBe("no revision left, so approval stays locked");
    expect(effects.rejected).toBe("the finding is wrong; unblocks approval");
    expect(effects.deferred).toBe("decide later; still blocks approval");
  });

  it("tells warnings apart: they only steer the revision and never block approval", () => {
    const withRevision = findingDecisionEffects(
      { severity: "warning" },
      { revisionAvailable: true },
    );
    expect(withRevision.accepted).toBe("the next revision fixes it; warnings never block approval");
    expect(withRevision.deferred).toBe("decide later; warnings never block approval");
    expect(Object.values(withRevision).join(" ")).not.toContain("unblocks");

    const withoutRevision = findingDecisionEffects(
      { severity: "warning" },
      { revisionAvailable: false },
    );
    expect(withoutRevision.accepted).toBe(
      "no revision left to fix it; warnings never block approval",
    );
  });

  it("guards Accept only for blocking findings with no revision left", () => {
    expect(acceptUnavailable({ severity: "error" }, { revisionAvailable: false })).toBe(true);
    expect(acceptUnavailable({ severity: "error" }, { revisionAvailable: true })).toBe(false);
    expect(acceptUnavailable({ severity: "warning" }, { revisionAvailable: false })).toBe(false);
    expect(
      acceptedWithoutRevision(
        { severity: "error", decision: "accepted" },
        { revisionAvailable: false },
      ),
    ).toBe(true);
    expect(
      acceptedWithoutRevision(
        { severity: "error", decision: "rejected" },
        { revisionAvailable: false },
      ),
    ).toBe(false);
  });
});

describe("bulk decisions and word-match coverage warnings", () => {
  const findings = [...fixture.findings, wordMatchWarning("finding-word-2")];
  const allIds = findings.map((finding) => finding.id);

  it("skips word-match coverage warnings from Accept all only", () => {
    const context = { revisionAvailable: true };
    expect(bulkDecisionTargetsForDecision(findings, allIds, "accepted", context)).toEqual([
      "finding-unsupported-claim",
    ]);
    expect(bulkDecisionTargetsForDecision(findings, allIds, "rejected", context)).toEqual(allIds);
    expect(bulkDecisionTargetsForDecision(findings, allIds, "deferred", context)).toEqual(allIds);
  });

  it("also skips blocking findings from Accept all when no revision is left", () => {
    const context = { revisionAvailable: false };
    const plainWarning: ReviewFinding = {
      ...wordMatchWarning("finding-style"),
      code: "weak-verb",
    };
    const withPlainWarning = [...findings, plainWarning];
    const ids = withPlainWarning.map((finding) => finding.id);
    expect(bulkDecisionTargetsForDecision(withPlainWarning, ids, "accepted", context)).toEqual([
      "finding-style",
    ]);
    expect(bulkDecisionTargetsForDecision(withPlainWarning, ids, "rejected", context)).toEqual(ids);
    expect(bulkDecisionTargetsForDecision(withPlainWarning, ids, "deferred", context)).toEqual(ids);
  });

  it("explains the blocking skip only when no revision is left and a blocking finding is shown", () => {
    expect(bulkBlockingSkipNote(findings, { revisionAvailable: false })).toBe(
      "No revision left: Accept all skips blocking findings; use Reject or Override for them.",
    );
    expect(bulkBlockingSkipNote(findings, { revisionAvailable: true })).toBeNull();
    expect(bulkBlockingSkipNote(findings.slice(1), { revisionAvailable: false })).toBeNull();
  });

  it("renders the blocking skip line on the bulk bar at the round limit", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={{ ...atLimit, findings }}
        onAction={() => undefined}
        onBulkFindingDecision={() => undefined}
      />,
    );
    expect(html).toContain(`<p class="finding-bulk-note">${BULK_ACCEPT_SKIPS_BLOCKING_NOTE}</p>`);
    // Every shown finding is either blocking or a word-match warning, so nothing is left to accept.
    expect(html).toContain('disabled="">Accept all</button>');
    expect(html).not.toContain('disabled="">Reject all</button>');
  });

  it("warns about word-match coverage warnings in the shown set", () => {
    expect(bulkWordMatchWarning(findings)).toBe(
      "Includes 2 word-match coverage findings; accepting them asks the author to add the job's wording.",
    );
    expect(bulkWordMatchWarning(findings.slice(0, 1))).toBeNull();
  });

  it("renders the warning and the skip note on the bulk bar", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={{ ...revisable, findings }}
        onAction={() => undefined}
        onBulkFindingDecision={() => undefined}
      />,
    );
    expect(html).toContain("Apply to all 3 shown");
    expect(html).toContain(
      `Includes 2 word-match coverage findings; accepting them asks the author to add the job&#x27;s wording. ${BULK_ACCEPT_SKIPS_WORD_MATCH_NOTE}.`,
    );
    expect(html).not.toContain(BULK_ACCEPT_SKIPS_BLOCKING_NOTE);
  });

  it("disables Accept all when only word-match warnings are shown", () => {
    const onlyWordMatch = [wordMatchWarning("finding-word-1"), wordMatchWarning("finding-word-2")];
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={{ ...revisable, findings: onlyWordMatch }}
        onAction={() => undefined}
        onBulkFindingDecision={() => undefined}
      />,
    );
    expect(html).toContain('disabled="">Accept all</button>');
    expect(html).not.toContain('disabled="">Reject all</button>');
  });
});

describe("finding cards explain their decisions", () => {
  it("shows what each decision does on an expanded blocking finding", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={revisable} onAction={() => undefined} />,
    );
    expect(html).toContain('aria-label="What each decision does"');
    expect(html).toContain(
      "<strong>Accept:</strong> the next revision fixes it; approval stays locked until then",
    );
    expect(html).toContain("<strong>Reject:</strong> the finding is wrong; unblocks approval");
    expect(html).toContain("<strong>Defer:</strong> decide later; still blocks approval");
    expect(html).toMatch(
      /aria-describedby="finding-details-finding-unsupported-claim-effect-accepted">Accept<\/button>/u,
    );
    expect(html).not.toContain(ACCEPT_UNAVAILABLE_NOTE);
  });

  it("disables Accept on a blocking finding when no revision is left", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={atLimit} onAction={() => undefined} />,
    );
    expect(html).toContain(`<p class="finding-accept-guard"`);
    expect(html).toContain(ACCEPT_UNAVAILABLE_NOTE);
    expect(html).toMatch(
      /aria-describedby="finding-details-finding-unsupported-claim-accept-guard [^"]+"[^>]*disabled="">Accept<\/button>/u,
    );
    // The margin note's Accept is unavailable too.
    expect(html).toContain(`title="${ACCEPT_UNAVAILABLE_NOTE}"`);
  });

  it("nudges an accepted blocking finding toward Reject or Override at the round limit", () => {
    const accepted = {
      ...atLimit,
      findings: atLimit.findings.map((finding) =>
        finding.severity === "error" ? { ...finding, decision: "accepted" as const } : finding,
      ),
    };
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={accepted} onAction={() => undefined} />,
    );
    expect(html).toContain("Accepted · no revision left");
    expect(html).not.toContain("Accepted · revision required");
    expect(html).toContain(ACCEPTED_WITHOUT_REVISION_NUDGE);
  });
});

describe("coverage panel", () => {
  it("labels coverage verdicts as information that never blocks approval", () => {
    const html = renderToStaticMarkup(
      <RequirementCoveragePanel
        coverage={{
          instructionsVersion: "coverage-judgement-v1",
          summary: { judged: 0, satisfied: 0, notSatisfied: 0, invalid: 0, unanswered: 0 },
          assessments: [],
        }}
        sections={fixture.artifact.sections}
        collapsed={false}
        onToggle={() => undefined}
        onLocateBlock={() => undefined}
      />,
    );
    expect(html).toContain(
      `<h2>Requirement coverage</h2><p class="coverage-information-note">${COVERAGE_INFORMATION_NOTE}</p>`,
    );
  });
});
