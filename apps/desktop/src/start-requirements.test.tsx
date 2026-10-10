import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { OpportunityLatestBrief } from "./bridge.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import { LatestRequirementsBriefView, StartRequirementsSourceView } from "./start-requirements.js";
import {
  isJobRequirementRefusal,
  latestBriefNote,
  latestBriefTitle,
  offersRequirementsExtraction,
  rawJobDescriptionLabel,
  requirementRefusalAction,
  reviewedRequirementsLabel,
  reviewedRequirementsSelection,
} from "./start-requirements-model.js";
import { startReviewBlockers } from "./start-review-blockers.js";

const reviewed: OpportunityLatestBrief = {
  workspaceId: "w",
  briefId: "target-role",
  version: 3,
  status: "reviewed",
  requirementCount: 18,
  criticalCount: 4,
};
const draft: OpportunityLatestBrief = {
  ...reviewed,
  version: 4,
  status: "draft",
  requirementCount: 1,
  criticalCount: 0,
};

describe("reviewed requirements selection", () => {
  it("is the latest reviewed version that the host holds as the selection", () => {
    const selection = reviewedRequirementsSelection(reviewed, {
      briefId: "target-role",
      version: 3,
    });
    expect(selection).toEqual({
      briefId: "target-role",
      version: 3,
      requirementCount: 18,
      criticalCount: 4,
    });
    expect(reviewedRequirementsLabel(selection as never)).toBe(
      "Using reviewed requirements: brief v3 · 18 requirements · 4 critical",
    );
  });

  it("is absent for no brief, a draft, or a version the host does not select", () => {
    const selected = { briefId: "target-role", version: 3 };
    expect(reviewedRequirementsSelection(null, selected)).toBeNull();
    expect(reviewedRequirementsSelection(undefined, selected)).toBeNull();
    expect(reviewedRequirementsSelection(draft, { briefId: "target-role", version: 4 })).toBeNull();
    expect(
      reviewedRequirementsSelection(reviewed, { briefId: "target-role", version: 2 }),
    ).toBeNull();
    expect(reviewedRequirementsSelection(reviewed, null)).toBeNull();
  });
});

describe("setup card 01 latest brief", () => {
  it("offers a restarted draft for review and says it cannot start a run", () => {
    const html = renderToStaticMarkup(
      <LatestRequirementsBriefView
        latest={draft}
        action={<button type="button">Review requirements</button>}
      />,
    );
    expect(html).toContain("Requirements brief v4 (draft)");
    expect(html).toContain("Review requirements");
    expect(latestBriefNote(draft)).toContain("cannot start a run until you review it");
  });

  it("says no requirements were found instead of offering to review an empty draft", () => {
    const html = renderToStaticMarkup(
      <LatestRequirementsBriefView
        latest={{ ...draft, requirementCount: 0, criticalCount: 0 }}
        action={<button type="button">Review requirements</button>}
      />,
    );
    expect(html).toContain("No requirements were found in this job text");
    expect(html).toContain("Extract again, or paste the job text");
    expect(html).not.toContain("Review requirements");
  });

  it("offers a reviewed brief for viewing and says runs start from it", () => {
    expect(latestBriefTitle(reviewed)).toBe("Requirements brief v3 (reviewed)");
    expect(latestBriefNote(reviewed)).toBe(
      "18 requirements, 4 critical. Runs start from these requirements.",
    );
  });
});

describe("start panel requirements source", () => {
  const selection = reviewedRequirementsSelection(reviewed, { briefId: "target-role", version: 3 });
  if (selection === null) throw new Error("selection expected");

  it("states the reviewed requirements and offers the raw job description", () => {
    const html = renderToStaticMarkup(
      <StartRequirementsSourceView
        selection={selection}
        useJobDescription={false}
        onUseJobDescription={() => undefined}
        onUseReviewed={() => undefined}
      />,
    );
    expect(html).toContain("Using reviewed requirements: brief v3 · 18 requirements · 4 critical");
    expect(html).toContain("Use the raw job description instead");
  });

  it("states the raw job description and offers to go back to the brief", () => {
    const html = renderToStaticMarkup(
      <StartRequirementsSourceView
        selection={selection}
        useJobDescription
        onUseJobDescription={() => undefined}
        onUseReviewed={() => undefined}
      />,
    );
    expect(html).toContain(rawJobDescriptionLabel);
    expect(html).toContain("Use the reviewed requirements (brief v3)");
  });
});

describe("guided requirement blocker", () => {
  const problem =
    "Requirement 1 in the job description has 196 words, too long to match against individual CV lines. List each requirement on its own bullet line, or use a reviewed opportunity brief.";
  const collecting = (setup: Record<string, unknown>) => ({
    ...createFixtureReviewState(),
    state: "collecting" as const,
    runId: "pending",
    setup: { ...createFixtureReviewState().setup, ...setup },
  });
  const binding = {
    workspaceId: "w",
    createOpportunity: async () => {
      throw new Error("not used");
    },
    writingModel: { company: "anthropic", model: "claude-opus-4-5" },
    disabled: false,
  } as never;

  it("offers Extract requirements into a brief next to the parser refusal", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={collecting({ ready: false, nextSteps: [problem], jobRequirementProblem: problem })}
        onAction={() => undefined}
        jobRequirements={binding}
      />,
    );
    expect(html).toContain(problem);
    expect(html).toContain("Extract requirements into a brief");
  });

  it("offers no extraction when the host cannot create briefs", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={collecting({ ready: false, nextSteps: [problem], jobRequirementProblem: problem })}
        onAction={() => undefined}
      />,
    );
    expect(html).toContain(problem);
    expect(html).not.toContain("Extract requirements into a brief");
  });

  it("offers a fresh extraction, not a review, when the latest draft has no requirements", () => {
    const empty = { ...draft, requirementCount: 0, criticalCount: 0 };
    const selection = reviewedRequirementsSelection(reviewed, {
      briefId: "target-role",
      version: 3,
    });
    expect(requirementRefusalAction(empty, null, true)).toBe("extract-again");
    expect(requirementRefusalAction(empty, null, false)).toBeNull();
    expect(requirementRefusalAction(draft, null, true)).toBe("review-draft");
    expect(requirementRefusalAction(null, null, true)).toBe("extract");
    expect(requirementRefusalAction(empty, selection, true)).toBe("use-reviewed");
    expect(offersRequirementsExtraction(empty)).toBe(true);
    expect(offersRequirementsExtraction(undefined)).toBe(true);
    expect(offersRequirementsExtraction(draft)).toBe(false);
    expect(offersRequirementsExtraction(reviewed)).toBe(false);
  });

  it("recognizes only the refusal itself as the guided blocker", () => {
    expect(isJobRequirementRefusal(problem, problem)).toBe(true);
    expect(isJobRequirementRefusal("Add a target job description.", problem)).toBe(false);
    expect(isJobRequirementRefusal(problem, null)).toBe(false);
  });

  it("blocks a start from the raw job description on the refusal, even with a ready setup", () => {
    const base = {
      setupReady: true,
      nextSteps: [],
      transmissionReady: true,
      startDisabledReason: null,
    };
    expect(startReviewBlockers(base)).toEqual([]);
    expect(startReviewBlockers({ ...base, rawJobRequirementProblem: problem })).toEqual([problem]);
    expect(
      startReviewBlockers({
        ...base,
        nextSteps: [problem],
        setupReady: false,
        rawJobRequirementProblem: problem,
      }),
    ).toEqual([problem]);
  });
});
