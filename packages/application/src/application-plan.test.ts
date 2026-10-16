import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import type { ApplicationPlan } from "@draft-loop/schemas/application-plan";
import { describe, expect, it } from "vitest";

import { createProviderApplicationPlanner, runPlansApplication } from "./application-plan-agent.js";
import { applicationPlanAuthorInstructions } from "./application-plan-prompts.js";
import {
  authorPromptSupportsApplicationPlan,
  createAuthorAdjudicationPrompt,
} from "./author-adjudication.js";
import { fullerBulletInstructions } from "./author-bullet-prompts.js";
import { createCriticAdjudicationPrompt } from "./critic-adjudication.js";
import { withApplicationPlan } from "./critic-application-plan.js";
import { criticCoverageJudgementParts } from "./critic-critique-contract.js";
import {
  emphasisPlanThemeSourceInstructions,
  emphasisThemeSourceInstructions,
} from "./critic-emphasis.js";

const chunkId = "c".repeat(64);
const otherChunkId = "d".repeat(64);
const evidence = [chunkId, otherChunkId].map(
  (id, ordinal): ScoredEvidenceChunk => ({
    id,
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal,
    lineStart: 1,
    lineEnd: 2,
    checksum: "a".repeat(64),
    text: `Evidence ${ordinal}`,
    rank: ordinal,
  }),
);

const theme = (title: string, ids: string[], gap = false) => ({
  title,
  rationale: "The job centres on it.",
  requirementIds: ["requirement-1"],
  evidenceChunkIds: ids,
  gap,
});
const plan: ApplicationPlan = {
  themes: [
    theme("Tokenisation", [chunkId]),
    theme("Payments", [otherChunkId]),
    theme("Kubernetes", [], true),
  ],
  leads: {
    summaryAngle: "Lead with tokenisation delivery.",
    coreAreas: [
      { text: "Tokenisation", themeRank: 1 },
      { text: "Payments", themeRank: 2 },
      { text: "Platform", themeRank: 1 },
    ],
  },
  cuts: [{ action: "compress", target: "Certification list", reason: "The job ignores it." }],
};

describe("author prompt cli-author-v11", () => {
  it("states and sends the plan on the first draft", () => {
    const prompt = createAuthorAdjudicationPrompt(
      "cli-author-v11",
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      plan,
    );
    expect(prompt.systemPrompt).toContain(applicationPlanAuthorInstructions);
    expect(prompt.providerInput.applicationPlan).toEqual(plan);
    expect(authorPromptSupportsApplicationPlan("cli-author-v11")).toBe(true);
  });

  it("leaves earlier versions unchanged, even when handed a plan", () => {
    for (const version of ["cli-author-v9", "cli-author-v10"]) {
      const without = createAuthorAdjudicationPrompt(version, undefined);
      const handed = createAuthorAdjudicationPrompt(
        version,
        undefined,
        undefined,
        [],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        plan,
      );
      expect(handed).toEqual(without);
      expect(handed.systemPrompt).not.toContain("applicationPlan");
      expect(handed.providerInput).not.toHaveProperty("applicationPlan");
      expect(authorPromptSupportsApplicationPlan(version)).toBe(false);
    }
  });

  it("v11 without a plan matches v10 apart from the stated plan guidance", () => {
    const v10 = createAuthorAdjudicationPrompt("cli-author-v10", undefined);
    const v11 = createAuthorAdjudicationPrompt("cli-author-v11", undefined);
    expect(v11.systemPrompt).toBe(`${v10.systemPrompt}${applicationPlanAuthorInstructions}`);
    expect(v11.providerInput).toEqual(v10.providerInput);
  });
});

describe("author prompt cli-author-v12", () => {
  it("is v11 plus the fuller-bullets guidance, and still plans the application", () => {
    const v11 = createAuthorAdjudicationPrompt("cli-author-v11", undefined);
    const v12 = createAuthorAdjudicationPrompt("cli-author-v12", undefined);
    expect(v12.systemPrompt).toBe(`${v11.systemPrompt}${fullerBulletInstructions}`);
    expect(v12.providerInput).toEqual(v11.providerInput);
    expect(authorPromptSupportsApplicationPlan("cli-author-v12")).toBe(true);
    expect(v12.systemPrompt).toContain("3 to 5 substantive bullets");
    expect(v12.systemPrompt).toContain("open each line with a short label and a colon");
    expect(v12.systemPrompt).toContain("never a fragment copied from a source");
    expect(v12.systemPrompt).toContain("does not override the grounding rules");
    expect(v11.systemPrompt).not.toContain("fuller bullets");
  });
});

describe("critic theme source", () => {
  const parts = () =>
    criticCoverageJudgementParts(undefined, { requirements: [] }, { sections: [] });

  it("uses the plan's themes in the v5 emphasis review", () => {
    const withPlan = withApplicationPlan(parts(), plan, "cli-critic-v5");
    const prompt = withPlan.systemPrompt(createCriticAdjudicationPrompt("cli-critic-v5"));
    expect(prompt).toContain(emphasisPlanThemeSourceInstructions);
    expect(prompt).not.toContain(emphasisThemeSourceInstructions);
    expect(withPlan.input.applicationPlan).toEqual(plan);
  });

  it("derives themes from context without a plan, and leaves older critics alone", () => {
    const without = withApplicationPlan(parts(), undefined, "cli-critic-v5");
    expect(without.systemPrompt(createCriticAdjudicationPrompt("cli-critic-v5"))).toContain(
      emphasisThemeSourceInstructions,
    );
    expect(without.input).not.toHaveProperty("applicationPlan");
    const older = withApplicationPlan(parts(), plan, "cli-critic-v4");
    expect(older.input).not.toHaveProperty("applicationPlan");
    expect(older.systemPrompt(createCriticAdjudicationPrompt("cli-critic-v4"))).toBe(
      createCriticAdjudicationPrompt("cli-critic-v4"),
    );
  });
});

function plannerWith(responses: JsonObject[]) {
  const requests: ModelRequest<JsonObject>[] = [];
  const context = {
    id: "context-1",
    requirements: [{ id: "requirement-1", text: "x", priority: "critical" }],
    modelConfiguration: {
      author: {
        company: "anthropic",
        modelId: "a",
        role: "author",
        promptTemplateVersion: "cli-author-v11",
      },
      critic: {
        company: "openai",
        modelId: "c",
        role: "critic",
        promptTemplateVersion: "cli-critic-v5",
      },
    },
  } as unknown as ContextSnapshot;
  const planner = createProviderApplicationPlanner({
    promptContext: context,
    dataPolicy: () => ({}) as ModelRequest<JsonObject>["dataPolicy"],
    createAdapter: async (company) => ({
      execute: async (request) => {
        requests.push(request);
        return {
          provider: company,
          modelId: "m",
          providerRequestId: "req-1",
          structuredOutputSha256: "b".repeat(64),
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: { estimatedUsd: 0.01 },
          output: responses.shift() ?? {},
        } as unknown as ModelResponse<JsonObject>;
      },
    }),
    author: { company: "anthropic", modelId: "a" },
    critic: { company: "openai", modelId: "c" },
    userError: (message) => new Error(message),
  });
  return { planner, requests, context };
}

describe("provider application planner", () => {
  const request = (context: ContextSnapshot) => ({
    executionId: "run-1:plan:plan",
    runId: "run-1",
    context,
    retrievedEvidence: evidence,
  });
  const aliased = (value: ApplicationPlan): JsonObject =>
    JSON.parse(
      JSON.stringify(value).replaceAll(chunkId, "E1").replaceAll(otherChunkId, "E2"),
    ) as JsonObject;

  it("sends evidence under aliases and maps the plan back to real ids", async () => {
    const { planner, requests, context } = plannerWith([aliased(plan)]);
    const execution = await planner.plan(request(context));
    expect(execution.output).toEqual(plan);
    expect(JSON.stringify(requests[0]?.input)).not.toContain(chunkId);
    expect(JSON.stringify(requests[0]?.outputSchema)).toContain('"enum":["E1","E2"]');
    expect(requests[0]?.model.role).toBe("author");
  });

  it("rejects a plan that cites an evidence or requirement id the request lacks", async () => {
    const unknownEvidence = aliased(plan);
    (unknownEvidence.themes as JsonObject[])[0] = {
      ...theme("Tokenisation", ["ghost"]),
    } as JsonObject;
    const { planner, context } = plannerWith([unknownEvidence]);
    await expect(planner.plan(request(context))).rejects.toMatchObject({
      code: "invalid-response",
    });
    const unknownRequirement = aliased({
      ...plan,
      themes: [{ ...plan.themes[0], requirementIds: ["nope"] }, plan.themes[1], plan.themes[2]],
    } as ApplicationPlan);
    const second = plannerWith([unknownRequirement]);
    await expect(second.planner.plan(request(second.context))).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("has the critic model review the plan", async () => {
    const { planner, requests, context } = plannerWith([{ verdict: "accept", points: [] }]);
    const execution = await planner.review({ ...request(context), plan });
    expect(execution.output.verdict).toBe("accept");
    expect(requests[0]?.model.role).toBe("critic");
    expect(JSON.stringify(requests[0]?.input)).toContain("applicationPlan");
  });

  it("plans only for runs recorded on an author prompt that states the plan", () => {
    const of = (version: string) =>
      ({ modelConfiguration: { author: { promptTemplateVersion: version } } }) as never;
    expect(runPlansApplication(of("cli-author-v11"))).toBe(true);
    expect(runPlansApplication(of("cli-author-v10"))).toBe(false);
    expect(runPlansApplication(of("unknown"))).toBe(false);
  });
});
