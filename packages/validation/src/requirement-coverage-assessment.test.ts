import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isRequirementCoveredByBlock } from "./requirement-coverage.js";
import {
  assessRequirementCoverage,
  requirementCoverageBases,
  requirementCoverageRationales,
  requirementCoverageStatuses,
} from "./requirement-coverage-assessment.js";

type Artifact = Parameters<typeof isRequirementCoveredByBlock>[1];

function artifactOf(blocks: readonly { readonly id: string; readonly text: string }[]): Artifact {
  return { sections: [{ blocks }] } as unknown as Artifact;
}

const blocks = [
  { id: "b-edu", text: "MSc in Computer Science, Distributed Systems, 2012 to 2014" },
  { id: "b-startup", text: "Joined an early-stage startup as employee five." },
  { id: "b-corp", text: "Worked at a large enterprise company, gaining experience." },
  { id: "b-obs", text: "Operated Prometheus dashboards and alerting for payment services." },
  { id: "b-obs-2", text: "Operated Prometheus dashboards for the ledger team." },
];
const artifact = artifactOf(blocks);

const requirements = [
  { id: "deg", text: "Computer-science or quantitative degree preferred." },
  { id: "deg-miss", text: "Quantitative degree required." },
  { id: "mat", text: "Early-stage startup experience." },
  { id: "mat-miss", text: "Seed stage company experience." },
  { id: "lex", text: "Experience operating Prometheus or Datadog dashboards." },
  { id: "lex-miss", text: "Designing and training production machine learning models." },
  { id: "gap", text: "Native-level fluency in Mandarin." },
];

describe("requirement coverage assessment", () => {
  const assessments = assessRequirementCoverage(requirements, artifact, new Set(["gap"]));
  const byId = new Map(assessments.map((item) => [item.requirementId, item]));
  const get = (id: string) => {
    const item = byId.get(id);
    if (item === undefined) throw new Error(`Missing assessment ${id}.`);
    return item;
  };

  it("returns one assessment per requirement in requirement order", () => {
    expect(assessments.map((item) => item.requirementId)).toEqual(requirements.map((r) => r.id));
  });

  it("defines the reserved statuses and bases without producing them", () => {
    expect(requirementCoverageStatuses).toContain("needs-judgement");
    expect(requirementCoverageBases).toContain("semantic-candidate");
    expect(requirementCoverageBases).toContain("judgement");
    for (const item of assessments) {
      expect(item.status).not.toBe("needs-judgement");
      expect(["lexical", "protected-rule"]).toContain(item.basis);
    }
  });

  it("matches the existing covered and uncovered outcomes", () => {
    for (const requirement of requirements) {
      if (requirement.id === "gap") continue;
      expect(get(requirement.id).status === "covered").toBe(
        isRequirementCoveredByBlock(requirement, artifact),
      );
    }
    expect(get("deg").status).toBe("covered");
    expect(get("deg-miss").status).toBe("uncovered");
    expect(get("mat").status).toBe("covered");
    expect(get("mat-miss").status).toBe("uncovered");
    expect(get("lex").status).toBe("covered");
    expect(get("lex-miss").status).toBe("uncovered");
  });

  it("marks degree and maturity requirements as protected-rule", () => {
    for (const id of ["deg", "deg-miss", "mat", "mat-miss"]) {
      expect(get(id).basis).toBe("protected-rule");
    }
  });

  it("marks other requirements as lexical and explicit gaps as explicit-gap", () => {
    expect(get("lex").basis).toBe("lexical");
    expect(get("lex-miss").basis).toBe("lexical");
    expect(get("gap")).toMatchObject({ status: "explicit-gap", basis: "lexical", evidence: [] });
  });

  it("points evidence at the satisfying block and leaves uncovered evidence empty", () => {
    expect(get("deg").evidence).toEqual([{ blockId: "b-edu" }]);
    expect(get("mat").evidence).toEqual([{ blockId: "b-startup" }]);
    expect(get("lex").evidence).toEqual([{ blockId: "b-obs" }]);
    for (const id of ["deg-miss", "mat-miss", "lex-miss", "gap"]) {
      expect(get(id).evidence).toEqual([]);
    }
  });

  it("uses fixed rationales that quote no requirement or block text", () => {
    const fixed = new Set<string>(Object.values(requirementCoverageRationales));
    for (const item of assessments) expect(fixed.has(item.rationale)).toBe(true);
    expect(get("deg").rationale).toBe(requirementCoverageRationales.degreeCovered);
    expect(get("mat-miss").rationale).toBe(requirementCoverageRationales.maturityUncovered);
    expect(get("lex").rationale).toBe(requirementCoverageRationales.lexicalCovered);
    for (const text of [...requirements.map((r) => r.text), ...blocks.map((b) => b.text)]) {
      for (const item of assessments) expect(item.rationale).not.toContain(text);
    }
  });

  it("freezes the result, its assessments, and their evidence", () => {
    expect(Object.isFrozen(assessments)).toBe(true);
    for (const item of assessments) {
      expect(Object.isFrozen(item)).toBe(true);
      expect(Object.isFrozen(item.evidence)).toBe(true);
      for (const evidence of item.evidence) expect(Object.isFrozen(evidence)).toBe(true);
    }
  });
});

describe("requirement coverage assessment on the #727 fixture", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../evaluations/fixtures/requirement-coverage/semantic-coverage-cases.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    readonly blocks: readonly { readonly id: string; readonly text: string }[];
    readonly requirements: readonly { readonly id: string; readonly text: string }[];
  };
  const fixtureArtifact = artifactOf(fixture.blocks);

  it("agrees with the existing rule for every requirement", () => {
    const assessments = assessRequirementCoverage(fixture.requirements, fixtureArtifact);
    expect(assessments).toHaveLength(fixture.requirements.length);
    const blockIds = new Set(fixture.blocks.map((block) => block.id));
    for (const [index, requirement] of fixture.requirements.entries()) {
      const item = assessments[index];
      expect(item?.requirementId).toBe(requirement.id);
      expect(item?.status === "covered").toBe(
        isRequirementCoveredByBlock(requirement, fixtureArtifact),
      );
      expect(item?.evidence.length === 0).toBe(item?.status !== "covered");
      for (const evidence of item?.evidence ?? [])
        expect(blockIds.has(evidence.blockId)).toBe(true);
    }
  });
});
