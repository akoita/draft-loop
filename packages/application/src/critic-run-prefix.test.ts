import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { JsonObject, ModelRequest } from "@draft-loop/providers";
import type { DraftArtifact } from "@draft-loop/schemas";
import type { ApplicationPlan } from "@draft-loop/schemas/application-plan";
import { describe, expect, it } from "vitest";

import { createProviderApplicationPlanner } from "./application-plan-agent.js";
import { applicationPlanReviewSystemPrompt } from "./application-plan-prompts.js";
import { candidateDirectionCriticInstructions } from "./candidate-direction.js";
import { coverageJudgementInstructions } from "./critic-adjudication.js";
import { createProviderCriticAgent } from "./provider-critic-agent.js";

const evidence: readonly ScoredEvidenceChunk[] = [0, 1].map((ordinal) => ({
  id: `chunk-${ordinal}`,
  workspaceId: "workspace",
  sourceId: "source",
  ordinal,
  lineStart: ordinal + 1,
  lineEnd: ordinal + 1,
  checksum: "b".repeat(64),
  text: `Built TypeScript tools in 202${ordinal}.`,
  rank: ordinal,
}));

const context = {
  id: "context",
  language: "en",
  evidenceManifest: [{ id: "source", path: "/private/resume.md", checksum: "a".repeat(64) }],
  requirements: [{ id: "requirement", text: "TypeScript tools", priority: "critical" }],
  outputConstraints: { requiredSections: [] },
  modelConfiguration: {
    author: {
      company: "anthropic",
      modelId: "a",
      role: "author",
      promptTemplateVersion: "cli-author-v16",
    },
    critic: {
      company: "anthropic",
      modelId: "c",
      role: "critic",
      promptTemplateVersion: "cli-critic-v6",
    },
  },
} as unknown as ContextSnapshot;

const artifact = {
  sections: [{ id: "experience", blocks: [{ id: "block-1", text: "Built TypeScript tools." }] }],
  claims: [],
} as unknown as DraftArtifact;

const plan: ApplicationPlan = {
  themes: [
    {
      title: "TypeScript tooling",
      rationale: "The job centres on it.",
      requirementIds: ["requirement"],
      evidenceChunkIds: ["chunk-0"],
      gap: false,
    },
    {
      title: "Platform work",
      rationale: "Mentioned throughout.",
      requirementIds: [],
      evidenceChunkIds: ["chunk-1"],
      gap: false,
    },
    {
      title: "Leadership",
      rationale: "Asked for once.",
      requirementIds: [],
      evidenceChunkIds: [],
      gap: true,
    },
  ],
  leads: {
    summaryAngle: "A tooling engineer.",
    coreAreas: [{ text: "TypeScript tooling", themeRank: 1 }],
  },
  cuts: [],
};

/** An adapter that records each request and then fails, since only the requests matter here. */
function recordingAdapter(requests: ModelRequest<JsonObject>[]) {
  return async () => ({
    execute: async (request: ModelRequest<JsonObject>): Promise<never> => {
      requests.push(request);
      throw new Error("recorded");
    },
  });
}

const dataPolicy = () => ({}) as ModelRequest<JsonObject>["dataPolicy"];

/** The part of a request a prompt cache keys on: the run instructions and the stable members. */
function cachedPrefix(request: ModelRequest<JsonObject> | undefined) {
  const layout = request?.promptCache;
  const members = Object.entries(request?.input ?? {}).slice(0, layout?.stableInputMembers ?? 0);
  return {
    systemPrompt: layout?.systemPrompt,
    stable: JSON.stringify(Object.fromEntries(members)),
    outputSchemas: layout?.outputSchemas,
  };
}

async function recordedReview(): Promise<ModelRequest<JsonObject> | undefined> {
  const requests: ModelRequest<JsonObject>[] = [];
  const planner = createProviderApplicationPlanner({
    promptContext: context,
    dataPolicy,
    createAdapter: recordingAdapter(requests),
    author: { company: "anthropic", modelId: "a" },
    critic: { company: "anthropic", modelId: "c" },
    userError: (message) => new Error(message),
  });
  await expect(
    planner.review({
      executionId: "run:plan:review",
      runId: "run",
      context,
      retrievedEvidence: evidence,
      plan,
    }),
  ).rejects.toThrow("recorded");
  return requests[0];
}

async function recordedCritiques(
  rounds: readonly {
    readonly round: number;
    readonly coverage?: boolean;
    readonly direction?: boolean;
  }[],
): Promise<ModelRequest<JsonObject>[]> {
  const requests: ModelRequest<JsonObject>[] = [];
  const critic = createProviderCriticAgent({
    context,
    promptContext: context,
    dataPolicy,
    createAdapter: recordingAdapter(requests),
    criticCompany: "anthropic",
    criticModel: "c",
    userError: (message) => new Error(message),
  });
  for (const { round, coverage, direction } of rounds) {
    await expect(
      critic.execute({
        executionId: `run:critic:${round}`,
        runId: "run",
        round,
        context,
        artifact,
        deterministicFindings: [],
        retrievedEvidence: evidence,
        applicationPlan: plan,
        ...(coverage === true
          ? {
              coverageJudgementRequests: [
                { requirementId: "requirement", candidateBlockIds: ["block-1"] },
              ],
            }
          : {}),
        ...(direction === true
          ? { candidateDirection: { text: "Lead with the tooling work.", round } }
          : {}),
      } as never),
    ).rejects.toThrow("recorded");
  }
  return requests;
}

describe("critic run prefix", () => {
  it("gives the plan review and every critique of a run one cached prefix (#1986)", async () => {
    const review = await recordedReview();
    const [plain, judged, directed] = await recordedCritiques([
      { round: 1 },
      { round: 2, coverage: true },
      { round: 3, coverage: true, direction: true },
    ]);

    expect(review?.promptCache?.stableInputMembers).toBe(3);
    expect(review?.promptCache?.callInstructions).toBe(applicationPlanReviewSystemPrompt);
    expect(review?.systemPrompt).toBe(
      `${review?.promptCache?.systemPrompt}\n\n${applicationPlanReviewSystemPrompt}`,
    );
    for (const critique of [plain, judged, directed]) {
      expect(cachedPrefix(critique)).toEqual(cachedPrefix(review));
    }
    expect(cachedPrefix(review).stable).toContain('"retrievedEvidence"');
    expect(cachedPrefix(review).stable).toContain('"achievementPlan"');
    // The review cites the chunks by the ids the critiques use, not by the author's aliases.
    expect(JSON.stringify(review?.input)).toContain('"chunk-0"');
    expect(JSON.stringify(review?.input)).not.toContain('"E1"');

    // Claude's cache keys on the output format too, so every critic call lists the same outputs.
    for (const sent of [review, plain, judged, directed]) {
      expect(sent?.promptCache?.outputSchemas?.[sent.outputName]).toEqual(sent?.outputSchema);
    }
    expect(Object.keys(review?.promptCache?.outputSchemas ?? {}).sort()).toEqual([
      "application_plan_review",
      "draft_critique",
    ]);
  });

  it("sends the round's coverage and direction instructions after the cached prefix", async () => {
    const [plain, judged, directed] = await recordedCritiques([
      { round: 1 },
      { round: 2, coverage: true },
      { round: 3, coverage: true, direction: true },
    ]);

    expect(plain?.promptCache?.callInstructions).toBe("");
    expect(judged?.promptCache?.callInstructions).toBe(coverageJudgementInstructions);
    expect(directed?.promptCache?.callInstructions).toBe(
      `${coverageJudgementInstructions}\n\n${candidateDirectionCriticInstructions}`,
    );
    // The cached prompt never carries a round's own instructions.
    for (const critique of [plain, judged, directed]) {
      expect(critique?.promptCache?.systemPrompt).not.toContain(coverageJudgementInstructions);
      expect(critique?.promptCache?.systemPrompt).not.toContain(
        candidateDirectionCriticInstructions,
      );
    }
    // A provider without a cache still gets the whole prompt for the call.
    expect(directed?.systemPrompt).toContain(coverageJudgementInstructions);
    expect(directed?.systemPrompt).toContain(candidateDirectionCriticInstructions);
    expect(directed?.input).toHaveProperty("candidateDirection");
    expect(directed?.input).toHaveProperty("coverageJudgementRequests");
  });

  it("keeps a run without a plan on the plain emphasis prompt", async () => {
    const requests: ModelRequest<JsonObject>[] = [];
    const critic = createProviderCriticAgent({
      context,
      promptContext: context,
      dataPolicy,
      createAdapter: recordingAdapter(requests),
      criticCompany: "anthropic",
      criticModel: "c",
      userError: (message) => new Error(message),
    });
    await expect(
      critic.execute({
        executionId: "run:critic:1",
        runId: "run",
        round: 1,
        context,
        artifact,
        deterministicFindings: [],
        retrievedEvidence: evidence,
      } as never),
    ).rejects.toThrow("recorded");
    const [planned] = await recordedCritiques([{ round: 1 }]);
    expect(requests[0]?.promptCache?.systemPrompt).not.toContain("input.applicationPlan.themes");
    expect(planned?.promptCache?.systemPrompt).toContain("input.applicationPlan.themes");
    expect(planned?.systemPrompt).toBe(planned?.promptCache?.systemPrompt);
  });
});
