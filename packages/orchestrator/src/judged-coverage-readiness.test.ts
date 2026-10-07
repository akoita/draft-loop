import { createContextSnapshot, createWorkspace } from "@draft-loop/domain";
import type { DraftArtifact } from "@draft-loop/schemas";
import type { RequirementCoverageAssessment } from "@draft-loop/validation";
import { describe, expect, it, vi } from "vitest";

import {
  type AgentExecution,
  buildApplicationReadinessStoppingDecision,
  type CoverageJudgementPlan,
  type Critique,
  createOrchestrationEngine,
  InMemoryRunStore,
} from "./index.js";

const timestamp = "2026-08-12T10:00:00.000Z";
const checksum = "a".repeat(64);
const excerpt = "Clear technical communication.";

function makeContext(clarity: number) {
  return createContextSnapshot({
    id: "context-1",
    workspaceId: "workspace-1",
    createdAt: timestamp,
    jobDescription: "Build reliable local-first software.",
    requirements: [
      { id: "requirement-1", text: "TypeScript experience", priority: "critical" },
      { id: "requirement-2", text: "Clear technical communication", priority: "high" },
    ],
    candidateInstructions: "Use concise, evidence-backed language.",
    language: "en",
    outputConstraints: { format: "markdown", maxWords: 800, requiredSections: ["Summary"] },
    truthfulnessPolicy: "Do not add unsupported claims.",
    readinessRubric: {
      relevance: 0.8,
      evidence: 0.8,
      accuracy: 0.8,
      differentiation: 0.8,
      clarity,
      format: 0.8,
      credibility: 0.8,
    },
    evidenceManifest: [
      { id: "source-1", path: "/local/candidate/resume.md", mediaType: "text/markdown", checksum },
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

const context = makeContext(0.8);

/** Requirement 1 ("TypeScript experience") is worded differently, so it is lexically uncovered. */
function artifact(version = 1, padded = false): DraftArtifact {
  return {
    schemaVersion: 1,
    id: `artifact-${version}`,
    version,
    parentVersionId: version === 1 ? null : `artifact-${version - 1}`,
    createdAt: timestamp,
    language: "en",
    sections: [
      {
        id: `summary-${version}`,
        title: "Summary",
        kind: "summary",
        order: 0,
        blocks: [
          {
            id: `summary-block-${version}`,
            type: "paragraph",
            text: excerpt,
            claimIds: [`claim-${version}`],
          },
          {
            id: `experience-block-${version}`,
            type: "bullet",
            text:
              version === 1 && padded
                ? `Shipped statically typed web services for years ${"and more ".repeat(25)}`.trim()
                : "Shipped statically typed web services for years.",
            claimIds: [],
          },
        ],
      },
    ],
    claims: [
      {
        id: `claim-${version}`,
        text: excerpt,
        sectionId: `summary-${version}`,
        blockId: `summary-block-${version}`,
        substantive: true,
        status: "verified",
        evidence: [{ sourcePath: "/local/candidate/resume.md", sourceChecksum: checksum, excerpt }],
      },
    ],
    decisions: [],
  };
}

const plan: CoverageJudgementPlan = {
  assessments: [
    {
      requirementId: "requirement-1",
      status: "needs-judgement",
      basis: "semantic-candidate",
      evidence: [{ blockId: "experience-block-1", score: 0.8 }],
      rationale:
        "Possibly covered with different wording; needs judgement against the cited blocks.",
    },
    {
      requirementId: "requirement-2",
      status: "covered",
      basis: "lexical",
      evidence: [{ blockId: "summary-block-1" }],
      rationale: "Covered by deterministic token matching.",
    },
  ],
  requests: [{ requirementId: "requirement-1", candidateBlockIds: ["experience-block-1"] }],
};

const verdict = (kind: "satisfied" | "not-satisfied") => ({
  requirementId: "requirement-1",
  verdict: kind,
  citedBlockIds: ["experience-block-1"],
  rationale: "The block states the required experience.",
});

function execution<T>(output: T, provider: string, modelId: string): AgentExecution<T> {
  return {
    output,
    provider,
    modelId,
    providerRequestId: `${provider}-request-1`,
    outputChecksum: checksum,
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    estimatedUsd: 0.01,
    completedAt: timestamp,
  };
}

function fixture(
  options: {
    readonly planner?: boolean;
    readonly critiques?: readonly Critique[];
    readonly maxRounds?: number;
    readonly clarity?: number;
  } = {},
) {
  const critiques = options.critiques ?? [{ findings: [] }];
  let call = 0;
  const critic = vi.fn(async () =>
    execution(critiques[Math.min(call++, critiques.length - 1)], "openai", "critic-test"),
  );
  const planCalls = vi.fn(async () => plan);
  const engine = createOrchestrationEngine({
    author: {
      execute: async (request: { readonly round: number }) =>
        execution(
          artifact(request.round, options.clarity !== undefined),
          "anthropic",
          "author-test",
        ),
    },
    critic: { execute: critic as never },
    store: new InMemoryRunStore(),
    now: () => timestamp,
    ...(options.planner === false ? {} : { coverageJudgement: { plan: planCalls } }),
  } as never);
  const start = () =>
    engine.start({
      runId: "run-1",
      workspace: createWorkspace("workspace-1"),
      context: options.clarity === undefined ? context : makeContext(options.clarity),
      budget: { maxRounds: options.maxRounds ?? 1 },
    });
  return { engine, start, critic, planCalls };
}

const uncovered = (findings: readonly { code: string; requirementId?: string }[]) =>
  findings.filter(
    (finding) =>
      finding.code === "uncovered-requirement" && finding.requirementId === "requirement-1",
  );

describe("judged coverage in readiness", () => {
  it("counts a requirement judged satisfied as covered and lets the draft pass", async () => {
    const { engine, start } = fixture({
      critiques: [{ findings: [], coverageJudgements: [verdict("satisfied")] }],
    });

    const result = await start();

    expect(uncovered(result.findings)).toEqual([]);
    expect(result.state).toBe("awaiting-approval");
    expect(result.latestEvaluation?.ready).toBe(true);
    expect(result.latestEvaluation?.scoreVector.relevance).toBe(1);
    const approved = await engine.approve("run-1");
    expect(approved.readinessDecision).toMatchObject({ applicationReady: true, blockers: [] });
    expect(
      approved.readinessDecision?.deterministicChecks.filter(
        (check) => check.code === "uncovered-requirement",
      ),
    ).toEqual([]);
  });

  it.each([
    ["judged not-satisfied", [{ findings: [], coverageJudgements: [verdict("not-satisfied")] }]],
    ["left unjudged", [{ findings: [] }]],
  ] satisfies readonly (readonly [string, readonly Critique[]])[])(
    "keeps a requirement %s blocking",
    async (_name, critiques) => {
      const { engine, start } = fixture({ critiques });

      const result = await start();

      expect(uncovered(result.findings)).toMatchObject([{ severity: "error" }]);
      expect(result.latestEvaluation?.ready).toBe(false);
      expect(result.latestEvaluation?.scoreVector.relevance).toBeLessThan(0.8);
      await expect(engine.approve("run-1")).rejects.toThrow(/not application-ready/iu);
    },
  );

  it("changes the score vector only through relevance", async () => {
    const baseline = await fixture({ planner: false }).start();
    const judged = await fixture({
      critiques: [{ findings: [], coverageJudgements: [verdict("satisfied")] }],
    }).start();

    if (judged.latestEvaluation === null || baseline.latestEvaluation === null) {
      throw new Error("both runs reach a readiness evaluation");
    }
    const { relevance: judgedRelevance, ...judgedRest } = judged.latestEvaluation.scoreVector;
    const { relevance: baselineRelevance, ...baselineRest } = baseline.latestEvaluation.scoreVector;
    expect(judgedRest).toEqual(baselineRest);
    expect(judgedRelevance).toBeGreaterThan(baselineRelevance);
  });

  it("evaluates identically to a run without the planner when nothing is judged", async () => {
    const baseline = await fixture({ planner: false }).start();
    const result = await fixture().start();

    expect(result.findings).toEqual(baseline.findings);
    expect(result.latestEvaluation).toEqual(baseline.latestEvaluation);
    expect(result.scoreHistory).toEqual(baseline.scoreHistory);
    expect(result.state).toBe(baseline.state);
  });

  it("does not apply a judgement from an earlier round to the current artifact", async () => {
    // A long round-1 block misses the clarity threshold without raising an error finding,
    // so the run revises into round 2 instead of stopping.
    const { engine, start, critic } = fixture({
      maxRounds: 2,
      clarity: 0.9,
      critiques: [
        {
          findings: [],
          coverageJudgements: [verdict("satisfied")],
        },
        { findings: [] },
      ],
    });

    const result = await start();

    expect(critic).toHaveBeenCalledTimes(2);
    expect(result.round).toBe(2);
    expect(result.state).toBe("awaiting-approval");
    await expect(engine.approve("run-1")).rejects.toThrow(/not application-ready/iu);
  });
});

describe("application readiness decision", () => {
  const judgedAssessments: readonly RequirementCoverageAssessment[] = [
    {
      requirementId: "requirement-1",
      status: "covered",
      basis: "judgement",
      evidence: [{ blockId: "experience-block-1" }],
      rationale: "The block states the required experience.",
    },
  ];
  const input = {
    artifact: artifact(),
    context,
    critiqueFindings: [],
    round: 1,
    budget: { maxRounds: 3 },
    priorScoreHistory: [],
    createdAt: timestamp,
  };

  it("does not treat a judged-satisfied requirement as a deterministic error", () => {
    const decision = buildApplicationReadinessStoppingDecision({
      ...input,
      coverageAssessments: judgedAssessments,
    });

    expect(decision.applicationReady).toBe(true);
    expect(decision.deterministicChecks.map((check) => check.code)).not.toContain(
      "uncovered-requirement",
    );
  });

  it("blocks on the uncovered requirement without a judgement", () => {
    const decision = buildApplicationReadinessStoppingDecision(input);

    expect(decision.applicationReady).toBe(false);
    expect(decision.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "deterministic-error",
          checkCode: "uncovered-requirement",
          requirementId: "requirement-1",
        }),
      ]),
    );
  });

  it.each<RequirementCoverageAssessment["status"]>(["needs-judgement", "uncovered"])(
    "keeps blocking when the assessment is %s",
    (status) => {
      const decision = buildApplicationReadinessStoppingDecision({
        ...input,
        coverageAssessments: [
          {
            requirementId: "requirement-1",
            status,
            basis: "semantic-candidate",
            evidence: [{ blockId: "experience-block-1" }],
            rationale: "Not settled by a judgement.",
          },
        ],
      });

      expect(decision.applicationReady).toBe(false);
    },
  );
});
