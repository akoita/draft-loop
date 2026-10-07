import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReviewCoverageView } from "./coverage-contract.js";
import { coverageSummaryLine, RequirementCoveragePanel } from "./coverage-panel.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const fixture = createFixtureReviewState();
const knownBlock = fixture.artifact.sections[0]?.blocks[0];
const knownTitle = fixture.artifact.sections[0]?.title;
if (knownBlock === undefined || knownTitle === undefined) throw new Error("fixture has no block");

const coverage: ReviewCoverageView = {
  instructionsVersion: "coverage-judgement-v1",
  summary: { judged: 3, satisfied: 2, notSatisfied: 1, invalid: 0, unanswered: 0 },
  assessments: [
    {
      requirementId: "req-lexical",
      status: "covered",
      basis: "lexical",
      evidence: [{ blockId: knownBlock.id }],
      rationale: "Covered by matching wording in one CV block.",
    },
    {
      requirementId: "req-rule",
      status: "covered",
      basis: "protected-rule",
      evidence: [],
      rationale: "Covered under the strict degree rule.",
    },
    {
      requirementId: "req-candidate",
      status: "needs-judgement",
      basis: "semantic-candidate",
      evidence: [{ blockId: "block-not-in-draft" }],
      rationale: "Candidate awaiting judgement.",
    },
    {
      requirementId: "req-judged",
      status: "uncovered",
      basis: "judgement",
      evidence: [],
      rationale: "The block does not show the skill.",
    },
    {
      requirementId: "req-gap",
      status: "explicit-gap",
      basis: "lexical",
      evidence: [],
      rationale: "Marked as an explicit gap by the author.",
    },
  ],
};

function render(value: ReviewCoverageView, collapsed = false): string {
  return renderToStaticMarkup(
    <RequirementCoveragePanel
      coverage={value}
      sections={fixture.artifact.sections}
      collapsed={collapsed}
      onToggle={() => undefined}
      onLocateBlock={() => undefined}
    />,
  );
}

describe("coverage summary line", () => {
  it("reads like the CLI summary and names the instructions version", () => {
    expect(coverageSummaryLine(coverage)).toBe(
      "3 judged · 2 satisfied · 1 not satisfied · instructions coverage-judgement-v1",
    );
  });

  it("adds invalid and unanswered counts only when present", () => {
    expect(
      coverageSummaryLine({
        ...coverage,
        instructionsVersion: null,
        summary: { judged: 1, satisfied: 1, notSatisfied: 0, invalid: 2, unanswered: 1 },
      }),
    ).toBe("1 judged · 1 satisfied · 0 not satisfied · 2 invalid · 1 unanswered");
  });

  it("is omitted when the critic judged nothing", () => {
    expect(
      coverageSummaryLine({
        ...coverage,
        summary: { judged: 0, satisfied: 0, notSatisfied: 0, invalid: 0, unanswered: 0 },
      }),
    ).toBeNull();
  });
});

describe("requirement coverage panel", () => {
  it("lists every requirement with a spelled-out status and basis", () => {
    const html = render(coverage);

    expect(html).toContain('aria-label="requirement coverage"');
    expect(html).toContain("<h2>Requirement coverage</h2>");
    expect(html).toContain("3 judged · 2 satisfied · 1 not satisfied");
    expect(html.match(/class="coverage-row /gu)).toHaveLength(5);

    for (const status of ["Covered", "Needs judgement", "Uncovered", "Explicit gap"]) {
      expect(html).toContain(`>${status}</span>`);
    }
    for (const basis of [
      "matching wording",
      "strict rule",
      "semantic candidate (needs judgement)",
      "critic judgement",
    ]) {
      expect(html).toContain(`Assessed by ${basis}`);
    }
    for (const assessment of coverage.assessments) {
      expect(html).toContain(assessment.requirementId);
      expect(html).toContain(assessment.rationale);
    }
  });

  it("renders the rows as a labelled list", () => {
    const html = render(coverage);
    expect(html).toContain(
      '<ul class="coverage-list" aria-label="Requirement coverage assessments">',
    );
    expect(html).toContain('aria-label="Draft blocks cited for req-lexical"');
  });

  it("links a cited block that exists in the draft and shows other ids as plain text", () => {
    const html = render(coverage);

    expect(html).toContain(
      `${knownTitle}<span class="coverage-block-id"> · ${knownBlock.id}</span>`,
    );
    expect(html).toContain('<button class="coverage-block coverage-block-link" type="button"');
    expect(html).toContain(", show in the draft</span>");
    expect(html).toContain('<span class="coverage-block">block-not-in-draft</span>');
    expect(html.match(/coverage-block-link/gu)).toHaveLength(1);
  });

  it("omits the summary line when nothing was judged and folds with the panel toggle", () => {
    const html = render(
      {
        instructionsVersion: null,
        summary: { judged: 0, satisfied: 0, notSatisfied: 0, invalid: 0, unanswered: 0 },
        assessments: coverage.assessments.slice(0, 1),
      },
      true,
    );

    expect(html).not.toContain("coverage-summary");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="coverage-panel-body"');
    expect(html).toContain('id="coverage-panel-body" hidden=""');
  });
});

describe("coverage in the review workspace", () => {
  it("shows the panel when the review state carries coverage", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={{ ...fixture, coverage }} onAction={() => undefined} />,
    );
    expect(html).toContain('aria-label="requirement coverage"');
    expect(html).toContain("req-judged");
  });

  it("hides the panel when coverage is null or absent", () => {
    for (const state of [{ ...fixture, coverage: null }, fixture]) {
      const html = renderToStaticMarkup(
        <ReviewWorkspace state={state} onAction={() => undefined} />,
      );
      expect(html).not.toContain("requirement coverage");
      expect(html).not.toContain("Requirement coverage");
    }
  });
});
