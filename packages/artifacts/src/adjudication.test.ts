import type { AuthorAdjudicationPlan, DraftArtifact } from "@draft-loop/schemas";
import { authorAdjudicationPlanSchema, draftArtifactSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import {
  createArtifact,
  createArtifactVersion,
  diffArtifacts,
  traceAdjudicatedRevision,
} from "./index.js";

const evidence = {
  sourcePath: "/local/candidate/resume.md",
  sourceChecksum: "a".repeat(64),
  locator: "line:1-2",
  excerpt: "Built reliable systems.",
};

function sourceArtifact(): DraftArtifact {
  return createArtifact({
    id: "artifact-1",
    createdAt: "2026-08-25T10:00:00.000Z",
    language: "en",
    sections: [
      {
        id: "section-summary",
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          {
            id: "block-summary",
            type: "paragraph",
            text: "Engineer building reliable systems.",
            claimIds: ["claim-1"],
          },
        ],
      },
      {
        id: "section-experience",
        title: "Experience",
        kind: "experience",
        order: 1,
        blocks: [
          {
            id: "block-experience",
            type: "paragraph",
            text: "Delivered dependable services.",
            claimIds: ["claim-2"],
          },
        ],
      },
    ],
    claims: [
      {
        id: "claim-1",
        text: "Engineer building reliable systems.",
        sectionId: "section-summary",
        blockId: "block-summary",
        substantive: true,
        status: "verified",
        evidence: [evidence],
      },
      {
        id: "claim-2",
        text: "Delivered dependable services.",
        sectionId: "section-experience",
        blockId: "block-experience",
        substantive: true,
        status: "verified",
        evidence: [
          {
            ...evidence,
            sourcePath: "/local/candidate/experience.md",
          },
        ],
      },
    ],
    decisions: [],
  });
}

function revisedArtifact(source: DraftArtifact): DraftArtifact {
  const summarySection = source.sections[0];
  const summaryBlock = summarySection?.blocks[0];
  const sourceClaim = source.claims[0];
  if (summarySection === undefined || summaryBlock === undefined || sourceClaim === undefined) {
    throw new Error("artifact fixture is incomplete");
  }
  return createArtifactVersion(source, {
    id: "artifact-2",
    createdAt: "2026-08-25T10:06:00.000Z",
    language: source.language,
    sections: [
      {
        ...summarySection,
        blocks: [
          {
            ...summaryBlock,
            text: "Engineer building dependable systems.",
          },
        ],
      },
    ],
    claims: [
      {
        ...sourceClaim,
        text: "Engineer building dependable systems.",
        evidence: [
          {
            ...evidence,
            locator: "line:3-4",
          },
        ],
      },
    ],
    decisions: [],
  });
}

type FindingTarget = {
  readonly kind: "artifact" | "claim" | "section" | "requirement" | "evidence" | "rubric";
  readonly id: string;
};

function planDecision(
  findingId: string,
  target: FindingTarget,
  disposition: "accept" | "reject" | "nuance" = "accept",
) {
  return {
    findingId,
    origin: "critic" as const,
    code: `code-${findingId}`,
    severity: "warning" as const,
    target,
    recommendedAction: `action for ${findingId}`,
    rationale: `rationale for ${findingId}`,
    disposition,
    effectRequirement:
      disposition === "accept"
        ? ("revision-required" as const)
        : ("disagreement-preserved" as const),
  };
}

function plan(source: DraftArtifact = sourceArtifact()): AuthorAdjudicationPlan {
  return authorAdjudicationPlanSchema.parse({
    schemaVersion: 1,
    contextSnapshotId: "context-1",
    sourceReport: {
      schemaVersion: 1,
      createdAt: "2026-08-25T10:00:00.000Z",
      artifact: { id: source.id, version: source.version },
    },
    sourceArtifact: { id: source.id, version: source.version },
    createdAt: "2026-08-25T10:05:00.000Z",
    decisions: [
      planDecision("finding-claim", { kind: "claim", id: "claim-1" }),
      planDecision("finding-section", { kind: "section", id: "section-experience" }),
      planDecision("finding-artifact", { kind: "artifact", id: source.id }),
      planDecision("finding-evidence", { kind: "evidence", id: "evidence-1" }),
      planDecision("finding-requirement", { kind: "requirement", id: "requirement-1" }),
      planDecision("finding-rubric", { kind: "rubric", id: "accuracy" }),
      planDecision("finding-disagreement", { kind: "claim", id: "claim-1" }, "nuance"),
    ],
  });
}

describe("adjudicated artifact revisions", () => {
  it("reports added and removed sections additively", () => {
    const source = sourceArtifact();
    const added = createArtifactVersion(source, {
      id: "artifact-added",
      createdAt: "2026-08-25T10:06:00.000Z",
      language: source.language,
      sections: [
        ...source.sections,
        {
          id: "section-projects",
          title: "Projects",
          kind: "projects",
          order: 2,
          blocks: [
            {
              id: "block-projects",
              type: "paragraph",
              text: "A project.",
              claimIds: [],
            },
          ],
        },
      ],
      claims: source.claims,
      decisions: [],
    });
    const removed = revisedArtifact(source);

    expect(diffArtifacts(source, added)).toMatchObject({
      addedSectionIds: ["section-projects"],
      removedSectionIds: [],
    });
    expect(diffArtifacts(source, removed)).toMatchObject({
      addedSectionIds: [],
      removedSectionIds: ["section-experience"],
    });
  });

  it("verifies direct claim, section, and artifact effects while preserving disagreements", () => {
    const source = sourceArtifact();
    const result = traceAdjudicatedRevision({
      plan: plan(source),
      sourceArtifact: source,
      revisedArtifact: revisedArtifact(source),
      createdAt: "2026-08-25T10:07:00.000Z",
    });

    expect(result.effects).toEqual([
      { findingId: "finding-claim", status: "verified" },
      { findingId: "finding-section", status: "verified" },
      { findingId: "finding-artifact", status: "verified" },
      { findingId: "finding-evidence", status: "missing" },
      { findingId: "finding-requirement", status: "missing" },
      { findingId: "finding-rubric", status: "missing" },
      { findingId: "finding-disagreement", status: "disagreement-preserved" },
    ]);
    expect(result.valid).toBe(false);
    expect(result).not.toHaveProperty("resolved");
  });

  it("leaves evidence, requirement, and rubric effects missing unless explicitly overridden", () => {
    const source = sourceArtifact();
    const result = traceAdjudicatedRevision({
      plan: plan(source),
      sourceArtifact: source,
      revisedArtifact: revisedArtifact(source),
      createdAt: "2026-08-25T10:07:00.000Z",
      acceptedEffectOverrides: [
        {
          findingId: "finding-evidence",
          rationale: "The author confirmed the evidence issue outside the artifact diff.",
        },
        {
          findingId: "finding-requirement",
          rationale: "The author confirmed the requirement was addressed in review.",
        },
        {
          findingId: "finding-rubric",
          rationale: "The author recorded a bounded rubric-specific override.",
        },
      ],
    });

    expect(result.effects).toEqual([
      { findingId: "finding-claim", status: "verified" },
      { findingId: "finding-section", status: "verified" },
      { findingId: "finding-artifact", status: "verified" },
      {
        findingId: "finding-evidence",
        status: "overridden",
        rationale: "The author confirmed the evidence issue outside the artifact diff.",
      },
      {
        findingId: "finding-requirement",
        status: "overridden",
        rationale: "The author confirmed the requirement was addressed in review.",
      },
      {
        findingId: "finding-rubric",
        status: "overridden",
        rationale: "The author recorded a bounded rubric-specific override.",
      },
      { findingId: "finding-disagreement", status: "disagreement-preserved" },
    ]);
    expect(result.valid).toBe(true);
  });

  it("rejects source, parent, version, and override mismatches", () => {
    const source = sourceArtifact();
    const revised = revisedArtifact(source);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: createArtifact({
          id: "artifact-other",
          createdAt: source.createdAt,
          language: source.language,
          sections: source.sections,
          claims: source.claims,
          decisions: source.decisions,
        }),
        revisedArtifact: revised,
        createdAt: "2026-08-25T10:07:00.000Z",
      }),
    ).toThrow(/source artifact must match/i);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: source,
        revisedArtifact: draftArtifactSchema.parse({
          ...revised,
          parentVersionId: "artifact-other",
        }),
        createdAt: "2026-08-25T10:07:00.000Z",
      }),
    ).toThrow(/link to the source/i);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: source,
        revisedArtifact: draftArtifactSchema.parse({ ...revised, version: 3 }),
        createdAt: "2026-08-25T10:07:00.000Z",
      }),
    ).toThrow(/immediately follow/i);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: source,
        revisedArtifact: draftArtifactSchema.parse({ ...revised, id: source.id }),
        createdAt: "2026-08-25T10:07:00.000Z",
      }),
    ).toThrow(/distinct id/i);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: source,
        revisedArtifact: revised,
        createdAt: "2026-08-25T10:07:00.000Z",
        acceptedEffectOverrides: [{ findingId: "finding-unknown", rationale: "Unknown finding." }],
      }),
    ).toThrow(/unknown/i);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: source,
        revisedArtifact: revised,
        createdAt: "2026-08-25T10:07:00.000Z",
        acceptedEffectOverrides: [
          { findingId: "finding-disagreement", rationale: "Rejected override." },
        ],
      }),
    ).toThrow(/accepted adjudication/i);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: source,
        revisedArtifact: revised,
        createdAt: "2026-08-25T10:07:00.000Z",
        acceptedEffectOverrides: [
          { findingId: "finding-evidence", rationale: "First." },
          { findingId: "finding-evidence", rationale: "Second." },
        ],
      }),
    ).toThrow(/duplicated/i);
  });

  it("rejects backwards artifact and trace chronology", () => {
    const source = sourceArtifact();
    const revised = revisedArtifact(source);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: source,
        revisedArtifact: draftArtifactSchema.parse({
          ...revised,
          createdAt: "2026-08-25T09:59:00.000Z",
        }),
        createdAt: "2026-08-25T10:07:00.000Z",
      }),
    ).toThrow(/revised artifact createdAt/i);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: source,
        revisedArtifact: revised,
        createdAt: "2026-08-25T10:05:00.000Z",
      }),
    ).toThrow(/revision trace createdAt/i);
  });

  it("rejects unused overrides and returns a deterministic deeply immutable trace", () => {
    const source = sourceArtifact();
    const revised = revisedArtifact(source);
    expect(() =>
      traceAdjudicatedRevision({
        plan: plan(source),
        sourceArtifact: source,
        revisedArtifact: revised,
        createdAt: "2026-08-25T10:07:00.000Z",
        acceptedEffectOverrides: [
          { findingId: "finding-claim", rationale: "This must not replace direct proof." },
        ],
      }),
    ).toThrow(/unused/i);
    const result = traceAdjudicatedRevision({
      plan: plan(source),
      sourceArtifact: source,
      revisedArtifact: revised,
      createdAt: "2026-08-25T10:07:00.000Z",
    });

    expect(result).toEqual(traceAdjudicatedRevisionAgain(plan(source), source, revised));
    expect(result.effects[0]).toEqual({ findingId: "finding-claim", status: "verified" });
    expect(result.adjudication).toEqual(plan(source));
    expect(result).not.toHaveProperty("contextSnapshotId");
    expect(result).not.toHaveProperty("sourceArtifact");
    expect(result).not.toHaveProperty("adjudicationCreatedAt");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.adjudication)).toBe(true);
    expect(Object.isFrozen(result.adjudication.decisions)).toBe(true);
    expect(Object.isFrozen(result.revisedArtifact)).toBe(true);
    expect(Object.isFrozen(result.diff)).toBe(true);
    expect(Object.isFrozen(result.effects)).toBe(true);
    expect(Object.isFrozen(result.effects[0])).toBe(true);
  });
});

function traceAdjudicatedRevisionAgain(
  adjudicationPlan: AuthorAdjudicationPlan,
  source: DraftArtifact,
  revised: DraftArtifact,
) {
  return traceAdjudicatedRevision({
    plan: adjudicationPlan,
    sourceArtifact: source,
    revisedArtifact: revised,
    createdAt: "2026-08-25T10:07:00.000Z",
  });
}
