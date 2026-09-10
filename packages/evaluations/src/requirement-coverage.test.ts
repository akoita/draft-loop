import { readFileSync } from "node:fs";
import type { DraftArtifact, JobRequirement } from "@draft-loop/schemas";
import { jobRequirementSchema } from "@draft-loop/schemas";
import { isRequirementCoveredByBlock, validateDraftArtifact } from "@draft-loop/validation";
import { describe, expect, it } from "vitest";
import { evaluateReadiness } from "./index.js";

function artifact(texts: readonly string[]): DraftArtifact {
  return {
    schemaVersion: 1,
    id: "coverage-artifact",
    version: 1,
    parentVersionId: null,
    createdAt: "2026-08-12T10:00:00.000Z",
    language: "en",
    claims: [],
    decisions: [],
    sections: texts.map((text, i) => ({
      id: `section-${i}`,
      title: "Experience",
      kind: "experience",
      order: i,
      blocks: [{ id: `block-${i}`, type: "bullet", text, claimIds: [] }],
    })),
  };
}

const requirement: JobRequirement = {
  id: "docs",
  text: "Write public library documentation, integration guides, and migration paths.",
  priority: "critical",
};
const context = {
  requirements: [requirement],
  outputConstraints: { requiredSections: [] },
  readinessRubric: {
    relevance: 0.8,
    evidence: 0,
    accuracy: 0,
    differentiation: 0,
    clarity: 0,
    format: 0,
    credibility: 0,
  },
};

function relevance(draft: DraftArtifact, gaps: readonly string[] = []) {
  return evaluateReadiness(draft, context, { explicitGapRequirementIds: gaps }).scoreVector
    .relevance;
}

const unrelated = [
  "Maintained a public library catalog.",
  "Prepared internal documentation and integration checks.",
  "Planned infrastructure migration paths.",
];

describe("shared block-local requirement coverage", () => {
  it("does not pool unrelated matches across sections or blocks", () => {
    const draft = artifact(unrelated);
    expect(relevance(draft)).toBe(0);
    expect(validateDraftArtifact(draft, context).issues).toContainEqual(
      expect.objectContaining({
        code: "uncovered-requirement",
        requirementId: "docs",
        severity: "error",
      }),
    );
    const combined = {
      ...draft,
      sections: [{ ...draft.sections[0]!, blocks: draft.sections.flatMap((s) => s.blocks) }],
    };
    expect(relevance(combined)).toBe(0);
    expect(isRequirementCoveredByBlock(requirement, combined)).toBe(false);
  });

  it("matches coherent documentation work in both validation and scoring", () => {
    const draft = artifact([
      "Wrote public library documentation, integration guides, and migration paths.",
    ]);
    expect(relevance(draft)).toBe(1);
    expect(
      validateDraftArtifact(draft, context).issues.filter((i) => i.category === "coverage"),
    ).toEqual([]);
  });

  it("preserves explicit gap precedence over matching text", () => {
    const draft = artifact([requirement.text]);
    expect(relevance(draft, [requirement.id])).toBe(0);
    expect(validateDraftArtifact(draft, context, [requirement.id]).issues).toContainEqual(
      expect.objectContaining({ code: "explicit-gap", requirementId: requirement.id }),
    );
  });

  it.each([
    ["Python systems", ["ＰＹＴＨＯＮ services"], true],
    ["Python Python Python systems", ["Systems"], true],
    ["Python systems cloud", ["Python"], false],
    ["and the or", ["and the or"], false],
    ["Python", [], false],
    ["Python systems", ["Python\nsystems"], true],
  ] as const)("retains normalized half-token matching for %s", (text, blocks, expected) => {
    expect(isRequirementCoveredByBlock({ text }, artifact(blocks))).toBe(expected);
  });
});

describe("degree coverage in validation and readiness", () => {
  const degree = {
    id: "degree",
    text: "Computer-science or quantitative degree preferred.",
    priority: "low" as const,
  };
  const degreeContext = { ...context, requirements: [degree] };

  it.each([
    ["MSc in Computer Science, Distributed Systems, 2012 to 2014", true],
    ["Computer science coursework for a quantitative degree", false],
    ["MSc in Literature", false],
    ["No degree in Computer Science", false],
  ] as const)("uses the strict rule consistently for %s", (text, covered) => {
    const draft = artifact([text]);
    expect(evaluateReadiness(draft, degreeContext).scoreVector.relevance).toBe(covered ? 1 : 0);
    const findings = validateDraftArtifact(draft, degreeContext).issues;
    expect(findings.some((issue) => issue.code === "uncovered-requirement")).toBe(!covered);
  });

  it("preserves explicit gaps and the configured relevance threshold", () => {
    const draft = artifact(["MSc in Computer Science"]);
    const evaluation = evaluateReadiness(draft, degreeContext, {
      explicitGapRequirementIds: [degree.id],
    });
    expect(
      evaluation.thresholdResults.find((result) => result.dimension === "relevance"),
    ).toMatchObject({ score: 0, threshold: 0.8, meets: false });
    expect(validateDraftArtifact(draft, degreeContext, [degree.id]).issues).toContainEqual(
      expect.objectContaining({ code: "explicit-gap", requirementId: degree.id }),
    );
  });
});

describe("alternative and maturity coverage in validation and readiness", () => {
  function agree(text: string, block: string, covered: boolean): void {
    const single = { id: "single", text, priority: "low" as const };
    const singleContext = { ...context, requirements: [single] };
    const draft = artifact([block]);
    expect(evaluateReadiness(draft, singleContext).scoreVector.relevance).toBe(covered ? 1 : 0);
    const findings = validateDraftArtifact(draft, singleContext).issues;
    expect(findings.some((issue) => issue.code === "uncovered-requirement")).toBe(!covered);
    expect(isRequirementCoveredByBlock(single, draft)).toBe(covered);
  }

  it.each([
    [
      "Early-stage startup experience.",
      "Built internal tools at a 40-person startup, gaining broad experience.",
      false,
    ],
    [
      "Experience with Prometheus or OpenTelemetry.",
      "Instrumented services with OpenTelemetry.",
      true,
    ],
    [
      "Experience with Prometheus, OpenTelemetry, or Datadog.",
      "Instrumented services with OpenTelemetry.",
      true,
    ],
    [
      "Production experience with Prometheus or OpenTelemetry.",
      "Instrumented production services with OpenTelemetry.",
      true,
    ],
  ] as const)("resolves %s consistently in both consumers", (text, block, covered) => {
    agree(text, block, covered);
  });

  it.each([
    ["Early-stage startup experience.", "Joined an early-stage startup as employee five.", true],
    [
      "Seed-stage company experience.",
      "Worked at a large enterprise company, gaining experience.",
      false,
    ],
    ["Experience with Prometheus or Datadog.", "Instrumented services with OpenTelemetry.", false],
    ["Experience with Prometheus or OpenTelemetry.", "Maintained a public library catalog.", false],
  ] as const)("keeps %s conservative in both consumers", (text, block, covered) => {
    agree(text, block, covered);
  });

  it.each([
    [
      "Early-stage or growth-stage experience.",
      "Joined an early-stage startup, gaining experience.",
      true,
    ],
    [
      "Early-stage or growth-stage experience.",
      "Joined a large enterprise, gaining experience.",
      false,
    ],
    ["Series A or Series B experience.", "Joined a Series A company, gaining experience.", false],
  ] as const)("guards %s per alternative branch", (text, block, covered) => {
    agree(text, block, covered);
  });

  it("does not pool one branch's tokens with another block's match", () => {
    const single = {
      id: "single",
      text: "Production experience with Prometheus or OpenTelemetry.",
      priority: "low" as const,
    };
    const draft = artifact(["Ran production services.", "Read the OpenTelemetry specification."]);
    expect(isRequirementCoveredByBlock(single, draft)).toBe(false);
    expect(
      evaluateReadiness(draft, { ...context, requirements: [single] }).scoreVector.relevance,
    ).toBe(0);
  });
});

/**
 * Provider-free measurement of the shared rule against the synthetic
 * matched-application fixture. The fixture's coverage labels are authored review
 * expectations, not a rubric, threshold, or measured parity result. This check
 * records what the rule actually decides for that reference CV and names where
 * the measurement diverges from the authored labels.
 */
describe("synthetic matched-application fixture coverage", () => {
  // The fixture lives outside this project's `src` include, so it is read at run
  // time rather than imported as a typed module.
  const matchedApplication = JSON.parse(
    readFileSync(new URL("../fixtures/matched-application/case.json", import.meta.url), "utf8"),
  ) as {
    opportunity: { requirements: readonly { id: string; text: string; priority: string }[] };
    referenceCv: { statements: readonly { id: string; text: string }[] };
    reviewExpectations: { coverage: readonly { requirementId: string; status: string }[] };
  };
  const { requirements } = matchedApplication.opportunity;
  const draft = artifact(matchedApplication.referenceCv.statements.map((s) => s.text));

  const measured: Readonly<Record<string, boolean>> = {
    // Known miss. The fixture labels r1 `supported`, but `implement`/`implemented`
    // and `contract`/`contracts` are distinct tokens, so no single statement
    // reaches half of the requirement's tokens. Stemming is out of scope: the
    // divergence is recorded here rather than resolved.
    r1: false,
    r2: true,
    r3: false,
    r4: false,
    // The degree clause of s10 is read without its trailing training clause.
    r5: true,
  };

  function agree(requirement: JobRequirement, covered: boolean): void {
    const fixtureContext = { ...context, requirements: [requirement] };
    expect(isRequirementCoveredByBlock(requirement, draft)).toBe(covered);
    expect(evaluateReadiness(draft, fixtureContext).scoreVector.relevance).toBe(covered ? 1 : 0);
    const findings = validateDraftArtifact(draft, fixtureContext).issues;
    expect(findings.some((issue) => issue.code === "uncovered-requirement")).toBe(!covered);
  }

  it.each(requirements)("measures $id consistently in both consumers", (requirement) => {
    expect(measured).toHaveProperty(requirement.id);
    agree(jobRequirementSchema.parse(requirement), measured[requirement.id] === true);
  });

  it("keeps the divergence from the authored labels visible", () => {
    const supported = matchedApplication.reviewExpectations.coverage
      .filter((label) => label.status === "supported")
      .map((label) => label.requirementId);
    expect(supported).toEqual(["r1", "r2", "r5"]);
    expect(supported.filter((id) => measured[id] !== true)).toEqual(["r1"]);
  });
});
