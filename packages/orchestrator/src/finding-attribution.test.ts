import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import {
  buildIndependentReadinessReport,
  type IndependentReadinessEvaluationProjection,
} from "@draft-loop/evaluations";
import type {
  AdjudicatedRevisionTrace,
  DraftArtifact,
  IndependentReadinessReport,
  IndependentReadinessReportFindingInput,
} from "@draft-loop/schemas";
import {
  adjudicatedRevisionTraceSchema,
  independentReadinessReportSchema,
  readinessDimensions,
  revisionFindingClassificationSchema,
} from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import { buildAuthorAdjudicationPlan } from "./adjudication.js";
import {
  attributeRevision,
  classifyRevisionFindings,
  findingIdentity,
  normalizeFindingCode,
} from "./finding-attribution.js";
import {
  type AgentExecution,
  type AuthorRequest,
  type Critique,
  createOrchestrationEngine,
  type ExecutionRecord,
  InMemoryRunStore,
  type RunSnapshot,
} from "./index.js";

const sourceCreatedAt = "2026-08-12T10:00:00.000Z";
const reportCreatedAt = "2026-08-12T10:01:00.000Z";
const engineNow = "2026-08-12T10:07:00.000Z";
const checksum = "a".repeat(64);

function context() {
  return createContextSnapshot({
    id: "context-1",
    workspaceId: "workspace-1",
    createdAt: sourceCreatedAt,
    jobDescription: "Build reliable local-first software.",
    requirements: [{ id: "requirement-1", text: "TypeScript experience", priority: "critical" }],
    candidateInstructions: "Use concise, evidence-backed language.",
    language: "en",
    outputConstraints: { format: "markdown", maxWords: 800, requiredSections: ["Summary"] },
    truthfulnessPolicy: "Do not add unsupported claims.",
    readinessRubric: {
      relevance: 0.8,
      evidence: 0.8,
      accuracy: 0.8,
      differentiation: 0.8,
      clarity: 0.8,
      format: 0.8,
      credibility: 0.8,
    },
    evidenceManifest: [
      { id: "source-1", path: "/local/resume.md", mediaType: "text/markdown", checksum },
    ],
    modelConfiguration: {
      author: {
        company: "anthropic",
        modelId: "author-test",
        role: "author",
        promptTemplateVersion: "author-v1",
      },
      critic: {
        company: "openai",
        modelId: "critic-test",
        role: "critic",
        promptTemplateVersion: "critic-v1",
      },
      requireProviderDiversity: true,
    },
  });
}

/** Three single-block sections; `suffix` mints fresh ids the way every real revision does. */
function artifact(options: {
  readonly version: number;
  readonly suffix: string;
  readonly summary: string;
  readonly experience: string;
  readonly skills: string;
}): DraftArtifact {
  const { suffix } = options;
  const parts = [
    { name: "summary", kind: "summary", text: options.summary },
    { name: "experience", kind: "experience", text: options.experience },
    { name: "skills", kind: "skills", text: options.skills },
  ] as const;
  return {
    schemaVersion: 1,
    id: `artifact-${options.version}`,
    version: options.version,
    parentVersionId: options.version === 1 ? null : `artifact-${options.version - 1}`,
    createdAt: options.version === 1 ? sourceCreatedAt : "2026-08-12T10:06:00.000Z",
    language: "en",
    sections: parts.map((part, order) => ({
      id: `section-${part.name}-${suffix}`,
      title: part.name,
      kind: part.kind,
      order,
      blocks: [
        {
          id: `block-${part.name}-${suffix}`,
          type: "paragraph" as const,
          text: part.text,
          claimIds: [`claim-${part.name}-${suffix}`],
        },
      ],
    })),
    claims: parts.map((part) => ({
      id: `claim-${part.name}-${suffix}`,
      text: part.text,
      sectionId: `section-${part.name}-${suffix}`,
      blockId: `block-${part.name}-${suffix}`,
      substantive: true,
      status: "verified" as const,
      evidence: [
        {
          sourcePath: "/local/resume.md",
          sourceChecksum: checksum,
          locator: "line:1-2",
          excerpt: part.text,
        },
      ],
    })),
    decisions: [],
  };
}

const source = artifact({
  version: 1,
  suffix: "v1",
  summary: "Engineer.",
  experience: "Delivered services.",
  skills: "TypeScript.",
});
const revised = artifact({
  version: 2,
  suffix: "v2",
  summary: "TypeScript engineer building reliable local-first systems.",
  experience: "Delivered dependable services.",
  skills: "TypeScript.",
});

function finding(
  id: string,
  code: string,
  target: IndependentReadinessReportFindingInput["target"],
  severity: "error" | "warning" = "error",
): IndependentReadinessReportFindingInput {
  return {
    id,
    code,
    category: "quality",
    severity,
    rationale: `Rationale for ${id}.`,
    target,
    recommendedAction: `Action for ${id}.`,
    confidence: 0.8,
  };
}

const evaluation: IndependentReadinessEvaluationProjection = {
  scores: readinessDimensions.map((dimension) => ({ dimension, score: 0.8, rationale: "ok" })),
  thresholdResults: readinessDimensions.map((dimension) => ({
    dimension,
    score: 0.8,
    threshold: 0.7,
    meets: true,
  })),
  meetsRubric: true,
};

function report(
  findings: readonly IndependentReadinessReportFindingInput[],
): IndependentReadinessReport {
  return independentReadinessReportSchema.parse(
    buildIndependentReadinessReport({
      metadata: {
        contextSnapshotId: "context-1",
        artifact: { id: source.id, version: source.version },
        createdAt: reportCreatedAt,
      },
      summary: "A bounded readiness report for the source artifact.",
      independentReview: {
        authorLineage: "anthropic:author-v1",
        criticLineage: "openai:critic-v1",
        lineagesDistinct: true,
        required: true,
      },
      inputAssessment: { status: "complete", missingInputs: [] },
      evaluation,
      deterministicFindings: findings,
      criticFindings: [],
    }),
  );
}

const reportFindings = [
  finding("f-summary", "weak-summary", { kind: "claim", id: "claim-summary-v1" }),
  finding("f-experience", "vague-experience", { kind: "section", id: "section-experience-v1" }),
  finding("f-skills", "Skills_Order", { kind: "section", id: "section-skills-v1" }, "warning"),
  finding("f-rejected", "tone", { kind: "claim", id: "claim-skills-v1" }),
];

function plan() {
  return buildAuthorAdjudicationPlan({
    report: report(reportFindings),
    sourceArtifact: source,
    createdAt: "2026-08-12T10:05:00.000Z",
    decisions: reportFindings.map(({ id }) => ({
      findingId: id,
      disposition: id === "f-rejected" ? ("reject" as const) : ("accept" as const),
      rationale: `Decision for ${id}.`,
    })),
  });
}

describe("normalizeFindingCode and findingIdentity", () => {
  it("normalizes case and punctuation in the code", () => {
    expect(normalizeFindingCode("Weak_Bullet ")).toBe("weak-bullet");
    expect(normalizeFindingCode("--Weak..bullet--")).toBe("weak-bullet");
  });

  it("matches a claim finding to the same block across artifacts with different ids", () => {
    const before = findingIdentity(
      { code: "weak", target: { kind: "claim", id: "claim-summary-v1" } },
      source,
    );
    const after = findingIdentity(
      { code: "WEAK", target: { kind: "claim", id: "claim-summary-v2" } },
      revised,
    );
    expect(before).toBe("weak|claim|summary#0/b0");
    expect(after).toBe(before);
  });

  it("treats two claims of one block with one code as the same finding", () => {
    const twoClaims = {
      ...source,
      claims: [
        ...source.claims,
        { ...source.claims[0], id: "claim-summary-extra" } as DraftArtifact["claims"][number],
      ],
    };
    expect(
      findingIdentity(
        { code: "weak", target: { kind: "claim", id: "claim-summary-extra" } },
        twoClaims,
      ),
    ).toBe(
      findingIdentity(
        { code: "weak", target: { kind: "claim", id: "claim-summary-v1" } },
        twoClaims,
      ),
    );
  });

  it("keeps different codes, target kinds and blocks apart", () => {
    const claim = { kind: "claim", id: "claim-summary-v1" } as const;
    const base = findingIdentity({ code: "weak", target: claim }, source);
    expect(findingIdentity({ code: "weaker", target: claim }, source)).not.toBe(base);
    expect(
      findingIdentity(
        { code: "weak", target: { kind: "section", id: "section-summary-v1" } },
        source,
      ),
    ).not.toBe(base);
    expect(
      findingIdentity({ code: "weak", target: { kind: "claim", id: "claim-skills-v1" } }, source),
    ).not.toBe(base);
  });

  it("uses stable ids for requirements and a bare marker for the artifact", () => {
    expect(
      findingIdentity(
        { code: "gap", target: { kind: "requirement", id: "requirement-1" } },
        source,
      ),
    ).toBe("gap|requirement|requirement-1");
    expect(
      findingIdentity({ code: "gap", target: { kind: "artifact", id: source.id } }, source),
    ).toBe(findingIdentity({ code: "gap", target: { kind: "artifact", id: revised.id } }, revised));
  });

  it("falls back to the raw id when a target cannot be resolved", () => {
    expect(
      findingIdentity({ code: "weak", target: { kind: "claim", id: "claim-gone" } }, source),
    ).toBe("weak|claim|unresolved:claim-gone");
  });
});

describe("attributeRevision", () => {
  it("lists changed blocks with the accepted findings that targeted them", () => {
    const attribution = attributeRevision({
      plan: plan(),
      sourceArtifact: source,
      revisedArtifact: revised,
    });
    expect(attribution.blocks).toEqual([
      {
        blockKey: "summary#0/b0",
        blockId: "block-summary-v2",
        change: "changed",
        findingIds: ["f-summary"],
      },
      {
        blockKey: "experience#0/b0",
        blockId: "block-experience-v2",
        change: "changed",
        findingIds: ["f-experience"],
      },
    ]);
    // The skills block did not change, so its accepted finding is not attributed to any block.
    expect(attribution.unattributedFindingIds).toEqual(["f-skills"]);
    expect(attribution.findings.map(({ findingId }) => findingId).sort()).toEqual(
      reportFindings.map(({ id }) => id).sort(),
    );
  });

  it("marks added and removed blocks", () => {
    const grown = {
      ...revised,
      sections: revised.sections.map((section) =>
        section.kind === "skills"
          ? {
              ...section,
              blocks: [
                ...section.blocks,
                { id: "block-extra", type: "paragraph" as const, text: "More.", claimIds: [] },
              ],
            }
          : section,
      ),
    };
    const attribution = attributeRevision({
      plan: plan(),
      sourceArtifact: source,
      revisedArtifact: grown,
    });
    expect(attribution.blocks.at(-1)).toEqual({
      blockKey: "skills#0/b1",
      blockId: "block-extra",
      change: "added",
      findingIds: ["f-skills"],
    });
    const shrunk = { ...revised, sections: revised.sections.slice(0, 2) };
    expect(
      attributeRevision({
        plan: plan(),
        sourceArtifact: source,
        revisedArtifact: shrunk,
      }).blocks.at(-1),
    ).toMatchObject({ blockKey: "skills#0/b0", change: "removed", findingIds: ["f-skills"] });
  });
});

describe("attributeRevision from a targeted revision's edits", () => {
  const replaceEdits = [
    {
      op: "replace" as const,
      sourceBlockKey: "summary#0/b0",
      revisedBlockKey: "summary#0/b0",
      findingIds: ["f-summary", "f-skills", "f-rejected"],
    },
    {
      op: "replace" as const,
      sourceBlockKey: "experience#0/b0",
      revisedBlockKey: "experience#0/b0",
      findingIds: ["f-experience"],
    },
  ];

  it("uses the findings each edit names, even where the diff would not tie them to a block", () => {
    const attribution = attributeRevision({
      plan: plan(),
      sourceArtifact: source,
      revisedArtifact: revised,
      edits: replaceEdits,
    });
    expect(attribution.source).toBe("edits");
    // f-skills targets the unchanged skills section; the diff leaves it unattributed.
    expect(attribution.blocks).toEqual([
      {
        blockKey: "summary#0/b0",
        blockId: "block-summary-v2",
        change: "changed",
        // The rejected finding an edit names is not an accepted decision, so it is not attributed.
        findingIds: ["f-summary", "f-skills"],
      },
      {
        blockKey: "experience#0/b0",
        blockId: "block-experience-v2",
        change: "changed",
        findingIds: ["f-experience"],
      },
    ]);
    expect(attribution.unattributedFindingIds).toEqual([]);
    expect(attribution.findings).toEqual(
      attributeRevision({ plan: plan(), sourceArtifact: source, revisedArtifact: revised })
        .findings,
    );
  });

  it("keeps the derived attribution, without a source, when there are no edits", () => {
    const derived = attributeRevision({
      plan: plan(),
      sourceArtifact: source,
      revisedArtifact: revised,
    });
    expect(derived).not.toHaveProperty("source");
  });

  it("maps an insert to an added block and a delete to a removed block", () => {
    const grown = {
      ...revised,
      sections: revised.sections.map((section) =>
        section.kind === "skills"
          ? {
              ...section,
              blocks: [
                ...section.blocks,
                { id: "block-extra", type: "paragraph" as const, text: "More.", claimIds: [] },
              ],
            }
          : section,
      ),
    };
    const inserted = attributeRevision({
      plan: plan(),
      sourceArtifact: source,
      revisedArtifact: grown,
      edits: [{ op: "insert", revisedBlockKey: "skills#0/b1", findingIds: ["f-skills"] }],
    });
    expect(inserted.blocks).toEqual([
      {
        blockKey: "skills#0/b1",
        blockId: "block-extra",
        change: "added",
        findingIds: ["f-skills"],
      },
    ]);
    expect([...inserted.unattributedFindingIds].sort()).toEqual(["f-experience", "f-summary"]);

    const shrunk = { ...revised, sections: revised.sections.slice(0, 2) };
    const deleted = attributeRevision({
      plan: plan(),
      sourceArtifact: source,
      revisedArtifact: shrunk,
      edits: [{ op: "delete", sourceBlockKey: "skills#0/b0", findingIds: ["f-skills"] }],
    });
    expect(deleted.blocks).toEqual([
      {
        blockKey: "skills#0/b0",
        blockId: "block-skills-v1",
        change: "removed",
        findingIds: ["f-skills"],
      },
    ]);
  });

  it("merges a delete and an insert that land on one position, and drops an edit whose block is gone", () => {
    const attribution = attributeRevision({
      plan: plan(),
      sourceArtifact: source,
      revisedArtifact: revised,
      edits: [
        { op: "delete", sourceBlockKey: "summary#0/b0", findingIds: ["f-summary"] },
        { op: "insert", revisedBlockKey: "summary#0/b0", findingIds: ["f-skills"] },
        { op: "replace", revisedBlockKey: "skills#0/b9", findingIds: ["f-experience"] },
      ],
    });
    expect(attribution.blocks).toEqual([
      {
        blockKey: "summary#0/b0",
        blockId: "block-summary-v2",
        change: "changed",
        findingIds: ["f-summary", "f-skills"],
      },
    ]);
    expect(attribution.unattributedFindingIds).toEqual(["f-experience"]);
  });
});

function traceOf(): AdjudicatedRevisionTrace {
  const attribution = attributeRevision({
    plan: plan(),
    sourceArtifact: source,
    revisedArtifact: revised,
  });
  return adjudicatedRevisionTraceSchema.parse({
    schemaVersion: 2,
    attribution,
    adjudication: plan(),
    revisedArtifact: { id: revised.id, version: revised.version, parentVersionId: source.id },
    createdAt: engineNow,
    diff: {
      addedClaimIds: [],
      removedClaimIds: [],
      changedClaimIds: [],
      changedEvidenceClaimIds: [],
      addedSectionIds: [],
      removedSectionIds: [],
      changedSectionIds: [],
    },
    effects: plan().decisions.map(({ findingId, disposition }) =>
      disposition === "accept"
        ? { findingId, status: "overridden", rationale: "Override." }
        : { findingId, status: "disagreement-preserved" },
    ),
    valid: true,
  });
}

/** The plan sorts its findings, so compare by id rather than by position. */
function byId<T extends { readonly findingId: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => (left.findingId < right.findingId ? -1 : 1));
}

describe("classifyRevisionFindings", () => {
  it("classifies resolved, persisting and new findings", () => {
    const classification = classifyRevisionFindings({
      trace: traceOf(),
      reviewedArtifact: revised,
      deterministicFindings: [],
      critiqueFindings: [
        // Same code and block as f-experience, raised against the new ids: persisting.
        {
          id: "c-1",
          code: "Vague-Experience",
          category: "quality",
          severity: "error",
          message: "Still vague.",
          sectionId: "section-experience-v2",
        },
        // Same identity again: collapses into the one persisting entry.
        {
          id: "c-2",
          code: "vague_experience",
          category: "quality",
          severity: "warning",
          message: "Also vague.",
          sectionId: "section-experience-v2",
        },
        // Matches no adjudicated finding: new.
        {
          id: "c-3",
          code: "missing-metrics",
          category: "quality",
          severity: "warning",
          message: "No metrics.",
          claimId: "claim-experience-v2",
        },
        // A rejected finding recurring is a preserved disagreement, not a new finding.
        {
          id: "c-4",
          code: "tone",
          category: "quality",
          severity: "error",
          message: "Tone.",
          claimId: "claim-skills-v2",
        },
      ],
    });

    expect(
      classification && { ...classification, findings: byId(classification.findings) },
    ).toEqual({
      schemaVersion: 1,
      reviewedArtifact: { id: "artifact-2", version: 2 },
      findings: [
        {
          status: "new",
          findingId: "critic:2:c-3",
          findingIdentity: "missing-metrics|claim|experience#0/b0",
          severity: "warning",
        },
        {
          status: "persisting",
          findingId: "f-experience",
          findingIdentity: "vague-experience|section|experience#0",
          severity: "error",
          currentFindingId: "critic:0:c-1",
        },
        {
          status: "resolved",
          findingId: "f-skills",
          findingIdentity: "skills-order|section|skills#0",
          severity: "warning",
        },
        {
          status: "resolved",
          findingId: "f-summary",
          findingIdentity: "weak-summary|claim|summary#0/b0",
          severity: "error",
        },
      ],
      summary: { resolved: 2, persisting: 1, new: 1 },
    });
    expect(JSON.stringify(classification)).not.toContain("Still vague");
    expect(revisionFindingClassificationSchema.parse(classification)).toEqual(classification);
  });

  it("counts deterministic findings and lets judged coverage settle its own", () => {
    const classification = classifyRevisionFindings({
      trace: traceOf(),
      reviewedArtifact: revised,
      deterministicFindings: [
        { code: "weak-summary", severity: "error", message: "m", claimId: "claim-summary-v2" },
        {
          code: "uncovered-requirement",
          severity: "error",
          message: "m",
          requirementId: "requirement-1",
        },
      ],
      critiqueFindings: [],
      judgedRequirementIds: ["requirement-1"],
    });
    expect(classification?.summary).toEqual({ resolved: 2, persisting: 1, new: 0 });
    expect(
      classification?.findings.find(({ findingId }) => findingId === "f-summary"),
    ).toMatchObject({
      status: "persisting",
      findingId: "f-summary",
      currentFindingId: "deterministic:0:weak-summary",
    });
  });

  it("returns nothing for an unattributed trace or a different reviewed artifact", () => {
    const { attribution: _attribution, ...rest } = traceOf();
    expect(
      classifyRevisionFindings({
        trace: { ...rest, schemaVersion: 1 },
        reviewedArtifact: revised,
        deterministicFindings: [],
        critiqueFindings: [],
      }),
    ).toBeUndefined();
    expect(
      classifyRevisionFindings({
        trace: traceOf(),
        reviewedArtifact: source,
        deterministicFindings: [],
        critiqueFindings: [],
      }),
    ).toBeUndefined();
  });
});

function execution<T>(output: T): AgentExecution<T> {
  return {
    output,
    provider: "anthropic",
    modelId: "model-test",
    providerRequestId: "request-1",
    outputChecksum: checksum,
    inputTokens: 1,
    outputTokens: 1,
    totalTokens: 2,
    estimatedUsd: 0,
    completedAt: engineNow,
  };
}

describe("engine classification of an adjudicated revision", () => {
  it("stores resolved, persisting and new findings with the next critic execution", async () => {
    const critiques: Critique[] = [
      { findings: [] },
      {
        findings: [
          {
            id: "c-1",
            code: "vague-experience",
            category: "quality",
            severity: "error",
            message: "Still vague.",
            sectionId: "section-experience-v2",
          },
          {
            id: "c-2",
            code: "missing-metrics",
            category: "quality",
            severity: "warning",
            message: "No metrics.",
            claimId: "claim-experience-v2",
          },
        ],
      },
    ];
    const store = new InMemoryRunStore();
    const engine = createOrchestrationEngine({
      author: {
        execute: async (request: AuthorRequest) =>
          execution(request.round === 1 ? source : revised),
      },
      critic: { execute: async () => execution(critiques.shift() ?? { findings: [] }) },
      store,
      now: () => engineNow,
    });
    const request = {
      runId: "run-1",
      workspace: createWorkspace("workspace-1"),
      context: context(),
      budget: { maxRounds: 2 },
    };
    expect((await engine.start(request)).state).toBe("awaiting-approval");

    await engine.requestAdjudicatedRevision("run-1", {
      report: report(reportFindings),
      decisions: reportFindings.map(({ id }) => ({
        findingId: id,
        disposition: id === "f-rejected" ? ("reject" as const) : ("accept" as const),
        rationale: `Decision for ${id}.`,
      })),
      acceptedEffectOverrides: [
        { findingId: "f-skills", rationale: "The skills section is already in order." },
      ],
    });
    const completed = await engine.resume("run-1", { context: context() });

    const revision = completed.executionHistory.find(({ step }) => step === "revision");
    expect(revision?.adjudicatedRevisionTrace).toMatchObject({
      schemaVersion: 2,
      attribution: {
        blocks: [
          { blockKey: "summary#0/b0", findingIds: ["f-summary"] },
          { blockKey: "experience#0/b0", findingIds: ["f-experience"] },
        ],
        unattributedFindingIds: ["f-skills"],
      },
    });
    const critics = completed.executionHistory.filter(({ step }) => step === "critic");
    expect(critics[0]?.findingClassification).toBeUndefined();
    const classification = critics.at(-1)?.findingClassification;
    expect(classification?.summary).toEqual({ resolved: 2, persisting: 1, new: 1 });
    expect(
      byId(classification?.findings ?? []).map(({ status, findingId }) => [status, findingId]),
    ).toEqual([
      ["new", "critic:1:c-2"],
      ["persisting", "f-experience"],
      ["resolved", "f-skills"],
      ["resolved", "f-summary"],
    ]);
  });

  it("records edit-sourced attribution and keeps it when the stored execution is replayed", async () => {
    class FlakyStore extends InMemoryRunStore {
      public failNextRevisionSnapshot = true;

      public override async saveRun(snapshot: RunSnapshot): Promise<void> {
        if (
          this.failNextRevisionSnapshot &&
          snapshot.executionHistory.some(({ step }) => step === "revision")
        ) {
          this.failNextRevisionSnapshot = false;
          throw new Error("synthetic snapshot failure");
        }
        return super.saveRun(snapshot);
      }
    }
    const store = new FlakyStore();
    let authorCalls = 0;
    const engine = createOrchestrationEngine({
      author: {
        execute: async (request: AuthorRequest) => {
          authorCalls += 1;
          return request.round === 1
            ? execution(source)
            : {
                ...execution(revised),
                revisionMode: "patch" as const,
                appliedEdits: [
                  {
                    op: "replace" as const,
                    sourceBlockKey: "summary#0/b0",
                    revisedBlockKey: "summary#0/b0",
                    findingIds: ["f-summary", "f-skills"],
                  },
                  {
                    op: "replace" as const,
                    sourceBlockKey: "experience#0/b0",
                    revisedBlockKey: "experience#0/b0",
                    findingIds: ["f-experience"],
                  },
                ],
              };
        },
      },
      critic: { execute: async () => execution({ findings: [] }) },
      store,
      now: () => engineNow,
    });
    await engine.start({
      runId: "run-1",
      workspace: createWorkspace("workspace-1"),
      context: context(),
      budget: { maxRounds: 2 },
    });
    await engine.requestAdjudicatedRevision("run-1", {
      report: report(reportFindings),
      decisions: reportFindings.map(({ id }) => ({
        findingId: id,
        disposition: id === "f-rejected" ? ("reject" as const) : ("accept" as const),
        rationale: `Decision for ${id}.`,
      })),
      acceptedEffectOverrides: [],
    });
    await expect(engine.resume("run-1", { context: context() })).rejects.toThrow(/synthetic/);
    expect(authorCalls).toBe(2);

    const resumed = await engine.resume("run-1", { context: context() });
    expect(authorCalls).toBe(2);
    expect(resumed.state).toBe("awaiting-approval");
    const revision = resumed.executionHistory.find(({ step }) => step === "revision");
    expect(revision?.revisionMode).toBe("patch");
    expect(revision?.adjudicatedRevisionTrace).toMatchObject({
      schemaVersion: 2,
      attribution: {
        source: "edits",
        blocks: [
          { blockKey: "summary#0/b0", findingIds: ["f-summary", "f-skills"] },
          { blockKey: "experience#0/b0", findingIds: ["f-experience"] },
        ],
        unattributedFindingIds: [],
      },
    });
    expect(resumed.adjudicationRuntime?.trace?.attribution?.source).toBe("edits");
  });

  it("replays a stored version 1 trace unchanged and adds no classification", async () => {
    /** Stores the revision as a pre-attribution record, then loses the first snapshot save. */
    class LegacyStore extends InMemoryRunStore {
      public failNextRevisionSnapshot = true;

      public override async saveExecution(record: ExecutionRecord): Promise<void> {
        const { adjudicatedRevisionTrace: trace, ...rest } = record;
        if (trace === undefined) return super.saveExecution(record);
        const { attribution: _attribution, ...legacy } = trace;
        return super.saveExecution({
          ...rest,
          adjudicatedRevisionTrace: { ...legacy, schemaVersion: 1 },
        });
      }

      public override async saveRun(snapshot: RunSnapshot): Promise<void> {
        if (
          this.failNextRevisionSnapshot &&
          snapshot.executionHistory.some(({ step }) => step === "revision")
        ) {
          this.failNextRevisionSnapshot = false;
          throw new Error("synthetic snapshot failure");
        }
        return super.saveRun(snapshot);
      }
    }
    const store = new LegacyStore();
    let authorCalls = 0;
    const engine = createOrchestrationEngine({
      author: {
        execute: async (request: AuthorRequest) => {
          authorCalls += 1;
          return execution(request.round === 1 ? source : revised);
        },
      },
      critic: { execute: async () => execution({ findings: [] }) },
      store,
      now: () => engineNow,
    });
    await engine.start({
      runId: "run-1",
      workspace: createWorkspace("workspace-1"),
      context: context(),
      budget: { maxRounds: 2 },
    });
    await engine.requestAdjudicatedRevision("run-1", {
      report: report(reportFindings),
      decisions: reportFindings.map(({ id }) => ({
        findingId: id,
        disposition: "reject" as const,
        rationale: `Decision for ${id}.`,
      })),
    });
    await expect(engine.resume("run-1", { context: context() })).rejects.toThrow(/synthetic/);
    expect(authorCalls).toBe(2);

    const resumed = await engine.resume("run-1", { context: context() });
    expect(authorCalls).toBe(2);
    expect(resumed.state).toBe("awaiting-approval");
    expect(resumed.adjudicationRuntime?.trace?.schemaVersion).toBe(1);
    expect(resumed.adjudicationRuntime?.trace).not.toHaveProperty("attribution");
    expect(
      resumed.executionHistory.every((record) => record.findingClassification === undefined),
    ).toBe(true);
  });
});
