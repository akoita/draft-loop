import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { JsonObject, ModelRequest, ModelResponse } from "@draft-loop/providers";
import type { ApplicationPlan, ApplicationPlanReview } from "@draft-loop/schemas/application-plan";
import { CV_HEADER_PLACEHOLDERS } from "@draft-loop/validation";
import { describe, expect, it } from "vitest";

import { createProviderApplicationPlanner, runPlansApplication } from "./application-plan-agent.js";
import { applicationPlanAuthorInstructions } from "./application-plan-prompts.js";
import {
  authorPromptSupportsApplicationPlan,
  authorPromptSupportsTargetedRevision,
  createAuthorAdjudicationPrompt,
} from "./author-adjudication.js";
import { fullerBulletInstructions } from "./author-bullet-prompts.js";
import {
  coherentStatementInstructions,
  singleStatementInstructions,
} from "./author-fact-prompts.js";
import { pageTargetLengthInstructions } from "./author-length-prompts.js";
import { structuredRoleInstructions } from "./author-structure-prompts.js";
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

describe("author prompt cli-author-v13", () => {
  it("is v11 plus the structured-role guidance, replacing v12's bullet guidance", () => {
    const v11 = createAuthorAdjudicationPrompt("cli-author-v11", undefined);
    const v12 = createAuthorAdjudicationPrompt("cli-author-v12", undefined);
    const v13 = createAuthorAdjudicationPrompt("cli-author-v13", undefined);
    expect(v13.systemPrompt).toBe(`${v11.systemPrompt}${structuredRoleInstructions}`);
    expect(v13.providerInput).toEqual(v11.providerInput);
    expect(authorPromptSupportsApplicationPlan("cli-author-v13")).toBe(true);
    expect(v13.systemPrompt).toContain("Bullet markers should be several lines apart");
    expect(v13.systemPrompt).toContain("context paragraph block of 1 to 3 lines");
    expect(v13.systemPrompt).toContain("at most 2 to 4 substantive bullet blocks");
    expect(v13.systemPrompt).toContain("roughly 45 to 70 words");
    expect(v13.systemPrompt).toContain("about 12 to 20 bullets in total");
    expect(v13.systemPrompt).toContain("never more than 4 bullet blocks in a row");
    expect(v13.systemPrompt).toContain("paragraph blocks of the form `Label: items`");
    expect(v13.systemPrompt).toContain("never a fragment copied from a source");
    expect(v13.systemPrompt).toContain("does not override the grounding rules");
    expect(v13.systemPrompt).not.toContain(fullerBulletInstructions);
    expect(v12.systemPrompt).toContain(fullerBulletInstructions);
    expect(v12.systemPrompt).not.toContain("context paragraph block");
  });
});

describe("author prompt cli-author-v14", () => {
  it("is v13 plus the page-target length guidance", () => {
    const v13 = createAuthorAdjudicationPrompt("cli-author-v13", undefined);
    const v14 = createAuthorAdjudicationPrompt("cli-author-v14", undefined);
    expect(v14.systemPrompt).toBe(`${v13.systemPrompt}${pageTargetLengthInstructions}`);
    expect(v14.providerInput).toEqual(v13.providerInput);
    expect(authorPromptSupportsApplicationPlan("cli-author-v14")).toBe(true);
    expect(v14.systemPrompt).toContain("context.writingPolicy.preferences.pageTarget");
    expect(v14.systemPrompt).toContain("When it is two-page or absent, use the counts above");
    expect(v14.systemPrompt).toContain("about 6 to 9 bullets in total");
    expect(v14.systemPrompt).toContain("Keep every role's title, employer and dates either way");
    expect(v13.systemPrompt).not.toContain("Write to the page target");
  });
});

describe("author prompt cli-author-v15", () => {
  it("is v14 plus the single-statement guidance", () => {
    const v14 = createAuthorAdjudicationPrompt("cli-author-v14", undefined);
    const v15 = createAuthorAdjudicationPrompt("cli-author-v15", undefined);
    expect(v15.systemPrompt).toBe(`${v14.systemPrompt}${singleStatementInstructions}`);
    expect(v15.providerInput).toEqual(v14.providerInput);
    expect(authorPromptSupportsApplicationPlan("cli-author-v15")).toBe(true);
    expect(authorPromptSupportsTargetedRevision("cli-author-v15")).toBe(true);
    expect(v15.systemPrompt).toContain("State each fact once.");
    expect(v15.systemPrompt).toContain("never restates an experience bullet");
    expect(v15.systemPrompt).toContain("groups evidence from across the candidate's roles");
    expect(v15.systemPrompt).toContain(
      "When findings include code repeated-fact, its message names each section",
    );
    expect(v15.systemPrompt).toContain("unless pendingAdjudication rejects that finding");
    expect(v14.systemPrompt).not.toContain("State each fact once.");
  });
});

describe("author prompt cli-author-v16", () => {
  it("is v15 plus one statement per bullet, a real summary and a placeholder header", () => {
    const v15 = createAuthorAdjudicationPrompt("cli-author-v15", undefined);
    const v16 = createAuthorAdjudicationPrompt("cli-author-v16", undefined);
    expect(v16.systemPrompt).toBe(`${v15.systemPrompt}${coherentStatementInstructions}`);
    expect(v16.providerInput).toEqual(v15.providerInput);
    expect(authorPromptSupportsApplicationPlan("cli-author-v16")).toBe(true);
    expect(authorPromptSupportsTargetedRevision("cli-author-v16")).toBe(true);
    expect(v16.systemPrompt).toContain("Never join separate facts in one bullet with semicolons");
    expect(v16.systemPrompt).toContain("Write the summary as 2 to 3 sentences");
    expect(v16.systemPrompt).toContain("Keep each fact in the role or project where it happened");
    expect(v16.systemPrompt).toContain("Every Core areas label names the content that follows it");
    for (const placeholder of CV_HEADER_PLACEHOLDERS) {
      expect(v16.systemPrompt).toContain(placeholder);
    }
    expect(v16.systemPrompt).toContain("never invent a value");
    expect(v15.systemPrompt).not.toContain("[Your name]");
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

function plannerWith(responses: JsonObject[], authorProfile?: unknown) {
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
        ...(authorProfile === undefined ? {} : { profile: authorProfile }),
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

  it("caps the plan at its own budget, or at the selected profile's budget", async () => {
    const legacy = plannerWith([aliased(plan)]);
    await legacy.planner.plan(request(legacy.context));
    expect(legacy.requests[0]?.maxOutputTokens).toBe(4_096);

    // Profile-aware adapters reject a request budget that differs from the profile's.
    const profiled = plannerWith([aliased(plan)], { runtime: { maxOutputTokens: 32_768 } });
    await profiled.planner.plan(request(profiled.context));
    expect(profiled.requests[0]?.maxOutputTokens).toBe(32_768);
  });

  it("has the critic model review the plan", async () => {
    const { planner, requests, context } = plannerWith([{ verdict: "accept", points: [] }]);
    const execution = await planner.review({ ...request(context), plan });
    expect(execution.output.verdict).toBe("accept");
    expect(requests[0]?.model.role).toBe("critic");
    expect(JSON.stringify(requests[0]?.input)).toContain("applicationPlan");
  });

  it("brings a long or over-full critic review within the schema's limits (#1983)", async () => {
    const long = `${"Lead with the platform migration and its measured outcome ".repeat(6)}end`;
    const points = [
      { text: long, themeRank: 1 },
      { text: "Rank two is a gap.", themeRank: 9 },
      { text: "   ", themeRank: null },
      ...Array.from({ length: 5 }, (_, index) => ({ text: `Point ${index}`, themeRank: null })),
    ];
    const { planner, context } = plannerWith([{ verdict: "revise", points }]);
    const execution = await planner.review({ ...request(context), plan });
    const reviewed = execution.output.points;
    expect(reviewed).toHaveLength(5);
    expect(reviewed[0]?.text.length).toBeLessThanOrEqual(240);
    expect(reviewed[0]?.text.endsWith("…")).toBe(true);
    expect(reviewed[1]).toEqual({ text: "Rank two is a gap.", themeRank: null });
    expect(reviewed.some(({ text }) => text.trim() === "")).toBe(false);
  });

  it("names the schema issue when a review still fails, without its text", async () => {
    const { planner, context } = plannerWith([{ verdict: "revise", points: [] }]);
    const rejected = await planner
      .review({ ...request(context), plan })
      .catch((error: unknown) => error);
    expect(rejected).toMatchObject({
      code: "invalid-response",
      diagnostics: [{ code: "custom", path: "points" }],
    });
  });

  it("names the failed checks when a first plan is rejected, without its text", async () => {
    const tooFewThemes = aliased({ ...plan, themes: plan.themes.slice(0, 1) } as ApplicationPlan);
    const { planner, context } = plannerWith([tooFewThemes]);
    const rejected = await planner.plan(request(context)).catch((error: unknown) => error);
    expect(rejected).toMatchObject({
      code: "invalid-response",
      diagnostics: expect.arrayContaining([expect.objectContaining({ path: "themes" })]),
    });
    expect(JSON.stringify(rejected)).not.toContain("Tokenisation");
  });

  it("keeps the reviewed plan when a revision breaks the plan's checks, naming them", async () => {
    const review: ApplicationPlanReview = {
      verdict: "revise",
      points: [{ text: "Lead with the gap.", themeRank: 2 }],
    };
    const tooFewThemes = aliased({ ...plan, themes: plan.themes.slice(0, 1) } as ApplicationPlan);
    const { planner, context } = plannerWith([tooFewThemes]);

    const execution = await planner.revise({ ...request(context), plan, review });

    expect(execution.output).toEqual(plan);
    expect(execution.estimatedUsd).not.toBeNull();
    expect(execution.rejectedDiagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "themes" })]),
    );
  });

  it("takes a valid revision as returned, with no rejected checks", async () => {
    const review: ApplicationPlanReview = {
      verdict: "revise",
      points: [{ text: "Tighten.", themeRank: null }],
    };
    const { planner, context } = plannerWith([aliased(plan)]);

    const execution = await planner.revise({ ...request(context), plan, review });

    expect(execution.output).toEqual(plan);
    expect(execution).not.toHaveProperty("rejectedDiagnostics");
  });

  it("plans only for runs recorded on an author prompt that states the plan", () => {
    const of = (version: string) =>
      ({ modelConfiguration: { author: { promptTemplateVersion: version } } }) as never;
    expect(runPlansApplication(of("cli-author-v11"))).toBe(true);
    expect(runPlansApplication(of("cli-author-v10"))).toBe(false);
    expect(runPlansApplication(of("unknown"))).toBe(false);
  });
});
