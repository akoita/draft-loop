import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequirementEvidenceList } from "./run-requirement-evidence.js";
import {
  normalizeRunRequirementEvidenceResult,
  type RunRequirementEvidenceView,
} from "./run-requirement-evidence-contract.js";
import { requirementEvidenceDisplay } from "./run-requirement-evidence-model.js";

const view: RunRequirementEvidenceView = {
  runId: "run-1",
  mode: "semantic",
  modelId: "embed-small",
  chunkCount: 12,
  grading: "graded",
  requirements: [
    {
      requirementId: "req-1",
      text: "Builds data pipelines",
      candidates: [
        {
          chunkId: "c1",
          origin: "both",
          score: 0.712,
          source: "cv.md",
          lineStart: 3,
          lineEnd: 7,
          grade: "supports",
        },
        {
          chunkId: "c2",
          origin: "semantic",
          score: 0.5,
          source: "projects.md",
          lineStart: 10,
          lineEnd: 10,
          grade: "does-not-support",
        },
        { chunkId: "c3", origin: "keyword", source: "cv.md", lineStart: 3, lineEnd: 7 },
      ],
    },
    { requirementId: "req-2", candidates: [] },
  ],
};

describe("requirementEvidenceDisplay", () => {
  it("drops unsupportive and repeated sources from the simple list, keeping every candidate", () => {
    const display = requirementEvidenceDisplay(view);
    expect(display.supportedCount).toBe(1);
    expect(display.rows[0]?.sources).toEqual([{ source: "cv.md", lines: "3-7" }]);
    expect(display.rows[0]?.candidates).toHaveLength(3);
    expect(display.rows[1]?.sources).toEqual([]);
  });
});

describe("RequirementEvidenceList", () => {
  it("renders requirements with and without evidence, folded by default", () => {
    const markup = renderToStaticMarkup(<RequirementEvidenceList view={view} />);
    expect(markup).toContain('<details class="run-steps requirement-evidence">');
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("Evidence for each requirement");
    expect(markup).toContain("1 of 2 requirements with evidence");
    expect(markup).toContain("Builds data pipelines");
    expect(markup).toContain("cv.md, lines 3-7");
    expect(markup).toContain("Requirement 2");
    expect(markup).toContain("No evidence found");
  });

  it("shows scores, match and grades under Advanced options", () => {
    const markup = renderToStaticMarkup(<RequirementEvidenceList view={view} />);
    const advanced = markup.slice(markup.indexOf("Advanced options"));
    expect(advanced).toContain("Ranked by meaning with embed-small, then by keywords.");
    expect(advanced).toContain("matched by meaning and keywords");
    expect(advanced).toContain("score 0.71");
    expect(advanced).toContain("supports");
    expect(advanced).toContain("projects.md, lines 10");
    expect(advanced).toContain("does not support");
    expect(advanced).toContain("not graded");
  });

  it("renders nothing for a map with no requirement", () => {
    expect(
      renderToStaticMarkup(<RequirementEvidenceList view={{ ...view, requirements: [] }} />),
    ).toBe("");
  });
});

describe("normalizeRunRequirementEvidenceResult", () => {
  it("keeps a valid map and a missing one", () => {
    expect(
      normalizeRunRequirementEvidenceResult({ workspaceId: "w", runId: "run-1", evidence: view }),
    ).toEqual({ workspaceId: "w", runId: "run-1", evidence: view });
    expect(
      normalizeRunRequirementEvidenceResult({ workspaceId: "w", runId: "run-1", evidence: null }),
    ).toEqual({ workspaceId: "w", runId: "run-1", evidence: null });
  });

  it("refuses a candidate that carries more than the contract", () => {
    const quoted = {
      ...view,
      requirements: [
        { requirementId: "r", candidates: [{ chunkId: "c", origin: "both", text: "quoted" }] },
      ],
    };
    expect(
      normalizeRunRequirementEvidenceResult({ workspaceId: "w", runId: "run-1", evidence: quoted }),
    ).toBeUndefined();
  });
});
