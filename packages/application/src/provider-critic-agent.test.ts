import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import { CallCostBudgetError } from "@draft-loop/orchestrator";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it, vi } from "vitest";

import { worstCallCostUsd } from "./call-cost-guard.js";
import { coverageJudgementInstructions } from "./critic-adjudication.js";
import { critiqueOutputSchemaWithCoverageJudgements } from "./critic-critique-contract.js";
import { omittedAccomplishmentCode } from "./critic-omission.js";
import { omissionCheckOutputSchema, omissionCheckSystemPrompt } from "./critic-omission-check.js";
import { defaultModelProfileRegistry } from "./model-profiles.js";
import { createProviderCriticAgent } from "./provider-critic-agent.js";
import { criticOutputBudget } from "./run-model-profiles.js";

// The model-facing artifact projection is covered elsewhere; here only the request layout matters.
vi.mock("./provider-artifact-input.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  modelFacingArtifactWithEvidenceTable: (artifact: DraftArtifact) => artifact,
  modelFacingArtifactWithCompactEvidenceTable: (
    artifact: DraftArtifact,
    _context: unknown,
    retrievedEvidence: readonly { readonly id: string }[],
  ) => ({ ...artifact, compactFor: retrievedEvidence.map(({ id }) => id) }),
}));

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
  requirements: [{ id: "requirement", text: "TypeScript tools", priority: "critical" }],
  modelConfiguration: {
    author: { company: "anthropic", modelId: "a", role: "author" },
    critic: {
      company: "openai",
      modelId: "c",
      role: "critic",
      promptTemplateVersion: "cli-critic-v5",
    },
  },
} as unknown as ContextSnapshot;

const artifact = {
  sections: [{ id: "experience", blocks: [{ id: "block-1", text: "Built TypeScript tools." }] }],
} as unknown as DraftArtifact;

/** Records each request and answers with the shared format's output, coverage list included. */
function recordingCritic(requests: ModelRequest<JsonObject>[], runContext = context) {
  return createProviderCriticAgent({
    context: runContext,
    promptContext: runContext,
    dataPolicy: () => ({}) as ModelRequest<JsonObject>["dataPolicy"],
    criticCompany: "openai",
    criticModel: "c",
    userError: (message) => new Error(message),
    createAdapter: async () => ({
      execute: async (request: ModelRequest<JsonObject>) => {
        requests.push(request);
        return {
          output: { findings: [], coverageJudgements: [] },
          provider: "openai",
          modelId: "c",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: { estimatedUsd: 0 },
        } as unknown as ModelResponse<JsonObject>;
      },
    }),
  });
}

const critique = (round: number, coverageJudgementRequests?: readonly object[]) => ({
  executionId: `run:critic:${round}`,
  runId: "run",
  round,
  artifact,
  deterministicFindings: [],
  retrievedEvidence: evidence,
  ...(coverageJudgementRequests === undefined ? {} : { coverageJudgementRequests }),
});

describe("provider critic agent", () => {
  it("gives every critique of a run the same cached prefix and output format", async () => {
    const requests: ModelRequest<JsonObject>[] = [];
    const critic = recordingCritic(requests);
    const first = await critic.execute(critique(1) as never);
    await critic.execute(
      critique(2, [{ requirementId: "requirement", candidateBlockIds: ["block-1"] }]) as never,
    );

    const [plain, judged] = requests;
    for (const request of [plain, judged]) {
      expect(request?.outputSchema).toBe(critiqueOutputSchemaWithCoverageJudgements);
      expect(request?.promptCache?.stableInputMembers).toBe(3);
      expect(Object.keys(request?.input ?? {}).slice(0, 3)).toEqual([
        "context",
        "retrievedEvidence",
        "achievementPlan",
      ]);
    }
    expect(judged?.promptCache?.systemPrompt).toBe(plain?.promptCache?.systemPrompt);
    expect(plain?.promptCache?.callInstructions).toBe("");
    expect(judged?.promptCache?.callInstructions).toBe(coverageJudgementInstructions);
    // A provider without a cache still gets the whole prompt for the call.
    expect(plain?.systemPrompt).toBe(plain?.promptCache?.systemPrompt);
    expect(judged?.systemPrompt).toContain(coverageJudgementInstructions);

    // The shared format's empty coverage list is not recorded for a critique that judged none.
    expect(first.output).not.toHaveProperty("coverageJudgements");
  });

  it("sends the compact evidence table from critic v6 on, citing retrieved chunks (#1986)", async () => {
    const v6 = {
      ...context,
      modelConfiguration: {
        ...context.modelConfiguration,
        critic: { ...context.modelConfiguration.critic, promptTemplateVersion: "cli-critic-v6" },
      },
    } as ContextSnapshot;
    const requests: ModelRequest<JsonObject>[] = [];
    await recordingCritic(requests, v6).execute(critique(1) as never);
    await recordingCritic(requests).execute(critique(1) as never);

    const [compact, full] = requests;
    expect(compact?.input.artifact).toMatchObject({ compactFor: ["chunk-0", "chunk-1"] });
    expect(compact?.systemPrompt).toContain("reference-table-v2");
    expect(full?.input.artifact).not.toHaveProperty("compactFor");
    expect(full?.systemPrompt).not.toContain("reference-table-v2");
  });

  describe("omission check (critic v9, #2039)", () => {
    const v9 = {
      ...context,
      modelConfiguration: {
        ...context.modelConfiguration,
        critic: { ...context.modelConfiguration.critic, promptTemplateVersion: "cli-critic-v9" },
      },
    } as ContextSnapshot;
    const plan = {
      themes: [
        {
          title: "TypeScript tooling",
          rationale: "Central.",
          requirementIds: ["requirement"],
          evidenceChunkIds: ["chunk-1"],
          gap: false,
        },
      ],
      leads: { summaryAngle: "Tooling", coreAreas: [{ text: "Tools", themeRank: 1 }] },
      cuts: [],
    };
    const omission = {
      chunkId: "chunk-1",
      themeId: "theme-1",
      accomplishment: "Built TypeScript tools in 2021",
      role: "Engineer",
      status: "left-out",
      move: "Add it to the experience section.",
    };
    const response = (output: JsonObject, estimatedUsd: number | null, inputTokens: number) =>
      ({
        output,
        provider: "openai",
        modelId: "c",
        usage: {
          inputTokens,
          outputTokens: 10,
          totalTokens: inputTokens + 10,
          cachedInputTokens: 5,
        },
        cost: { estimatedUsd },
      }) as unknown as ModelResponse<JsonObject>;

    /** Answers the check with one omission and the critique with the given findings. */
    function twoCallCritic(
      requests: ModelRequest<JsonObject>[],
      findings: readonly JsonObject[],
      remainingCostUsd?: number,
    ) {
      const critic = createProviderCriticAgent({
        context: v9,
        promptContext: v9,
        dataPolicy: () => ({}) as ModelRequest<JsonObject>["dataPolicy"],
        criticCompany: "openai",
        criticModel: "c",
        userError: (message) => new Error(message),
        createAdapter: async () => ({
          execute: async (request: ModelRequest<JsonObject>) => {
            requests.push(request);
            return request.outputName === "omission_check"
              ? response({ omissions: [omission] }, 0.1, 100)
              : response({ findings, coverageJudgements: [] }, 0.5, 1000);
          },
        }),
      });
      return critic.execute({
        ...critique(1),
        applicationPlan: plan,
        ...(remainingCostUsd === undefined ? {} : { remainingCostUsd }),
      } as never);
    }

    it("asks the check first, with the CV text and the theme chunks only, then the critique", async () => {
      const requests: ModelRequest<JsonObject>[] = [];
      const execution = await twoCallCritic(requests, [
        { id: "f1", code: "quality-x", category: "quality", severity: "warning", message: "m" },
        {
          id: "f2",
          code: omittedAccomplishmentCode,
          category: "coverage",
          severity: "error",
          message: "the critique's own omission",
        },
      ]);

      const [check, critiqueCall] = requests;
      expect(check?.outputName).toBe("omission_check");
      expect(check?.systemPrompt).toBe(omissionCheckSystemPrompt);
      expect(check?.outputSchema).toBe(omissionCheckOutputSchema);
      expect(check?.promptCache).toBeUndefined();
      // The selected profile's budget, like every critic call: an adapter refuses any other (#2044).
      expect(check?.maxOutputTokens).toBe(criticOutputBudget(v9.modelConfiguration.critic));
      expect(check?.maxOutputTokens).toBe(critiqueCall?.maxOutputTokens);
      expect(check?.input).toEqual({
        cv: "## undefined\nBuilt TypeScript tools.",
        themes: [{ id: "theme-1", title: "TypeScript tooling", requirementIds: ["requirement"] }],
        cuts: [],
        chunks: [{ id: "chunk-1", themeIds: ["theme-1"], text: "Built TypeScript tools in 2021." }],
      });
      expect(critiqueCall?.outputName).toBe("draft_critique");
      expect(critiqueCall?.systemPrompt).not.toContain("omission");

      // The check's answers replace the critique's own omission findings, and both calls are billed.
      expect(execution.output.findings).toEqual([
        { id: "f1", code: "quality-x", category: "quality", severity: "warning", message: "m" },
        {
          id: "omission-1",
          code: omittedAccomplishmentCode,
          category: "coverage",
          severity: "error",
          message:
            'The CV left out "Built TypeScript tools in 2021" (chunk-1, Engineer; serves theme-1 TypeScript tooling). Move: Add it to the experience section.',
        },
      ]);
      expect(execution).toMatchObject({
        inputTokens: 1100,
        outputTokens: 20,
        totalTokens: 1120,
        cachedInputTokens: 10,
        estimatedUsd: 0.6,
      });
    });

    it("skips the check when the run has nothing to compare, and on earlier critic versions", async () => {
      const requests: ModelRequest<JsonObject>[] = [];
      const critic = createProviderCriticAgent({
        context: v9,
        promptContext: v9,
        dataPolicy: () => ({}) as ModelRequest<JsonObject>["dataPolicy"],
        criticCompany: "openai",
        criticModel: "c",
        userError: (message) => new Error(message),
        createAdapter: async () => ({
          execute: async (request: ModelRequest<JsonObject>) => {
            requests.push(request);
            return response({ findings: [], coverageJudgements: [] }, 0.5, 1000);
          },
        }),
      });
      // No plan, and no critical or high requirement with an achievement: nothing to compare.
      const execution = await critic
        .execute({
          ...critique(1),
          retrievedEvidence: [],
        } as never)
        .catch((error: Error) => error);
      expect(execution).toBeInstanceOf(Error); // no evidence at all refuses the critique itself
      requests.length = 0;
      await recordingCritic(requests).execute({ ...critique(1), applicationPlan: plan } as never);
      expect(requests.map(({ outputName }) => outputName)).toEqual(["draft_critique"]);
    });

    it("carries the check's bill on the error when the guard then refuses the critique", async () => {
      const requests: ModelRequest<JsonObject>[] = [];
      const priced = defaultModelProfileRegistry.resolve("standard-anthropic-critic", 1, "critic");
      const v9Priced = {
        ...v9,
        modelConfiguration: {
          ...v9.modelConfiguration,
          critic: {
            ...v9.modelConfiguration.critic,
            company: priced.provider,
            modelId: priced.modelId,
            profile: priced,
          },
        },
      } as ContextSnapshot;
      const critic = createProviderCriticAgent({
        context: v9Priced,
        promptContext: v9Priced,
        dataPolicy: () => ({}) as ModelRequest<JsonObject>["dataPolicy"],
        criticCompany: priced.provider,
        criticModel: priced.modelId,
        userError: (message) => new Error(message),
        createAdapter: async () => ({
          execute: async (request: ModelRequest<JsonObject>) => {
            requests.push(request);
            return response({ omissions: [omission] }, 0.1, 100);
          },
        }),
      });
      await critic
        .execute({ ...critique(1), applicationPlan: plan } as never)
        .catch(() => undefined);
      // Enough for the check's worst case once, not for the critique after it: the critique's
      // prompt is larger and it carries the same output budget.
      const check = requests[0];
      const worstCheck = worstCallCostUsd(check as ModelRequest<JsonObject>);
      expect(worstCheck).toBeGreaterThan(0);
      requests.length = 0;
      const error = await critic
        .execute({
          ...critique(1),
          applicationPlan: plan,
          remainingCostUsd: (worstCheck ?? 0) + 0.05,
        } as never)
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(CallCostBudgetError);
      expect(requests.map(({ outputName }) => outputName)).toEqual(["omission_check"]);
      expect(requests[0]?.maxOutputTokens).toBe(priced.runtime.maxOutputTokens);
      expect((error as { billed?: unknown }).billed).toEqual({
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110, cachedInputTokens: 5 },
        cost: { estimatedUsd: 0.1 },
      });
    });
  });
});
