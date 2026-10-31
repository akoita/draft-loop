import type { ContextSnapshot, ScoredEvidenceChunk } from "@draft-loop/domain";
import type { JsonObject, ModelRequest } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { createProviderApplicationPlanner } from "./application-plan-agent.js";
import { applicationPlanSystemPrompt } from "./application-plan-prompts.js";
import { createProviderAuthorAgent } from "./provider-author-agent.js";

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
      promptTemplateVersion: "cli-author-v14",
    },
    critic: {
      company: "openai",
      modelId: "c",
      role: "critic",
      promptTemplateVersion: "cli-critic-v5",
    },
  },
} as unknown as ContextSnapshot;

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
  };
}

describe("author run prefix", () => {
  it("gives the plan's author calls the first draft's cached prefix", async () => {
    const planRequests: ModelRequest<JsonObject>[] = [];
    const planner = createProviderApplicationPlanner({
      promptContext: context,
      dataPolicy,
      createAdapter: recordingAdapter(planRequests),
      author: { company: "anthropic", modelId: "a" },
      critic: { company: "openai", modelId: "c" },
      userError: (message) => new Error(message),
    });
    const planRequest = {
      executionId: "run:plan",
      runId: "run",
      context,
      retrievedEvidence: evidence,
    };
    await expect(planner.plan(planRequest)).rejects.toThrow("recorded");

    const draftRequests: ModelRequest<JsonObject>[] = [];
    const author = createProviderAuthorAgent({
      context,
      promptContext: context,
      dataPolicy,
      createAdapter: recordingAdapter(draftRequests),
      authorCompany: "anthropic",
      authorModel: "a",
      authorProposalCaptureDirectory: undefined,
      userError: (message) => new Error(message),
    });
    await expect(
      author.execute({
        executionId: "run:draft",
        runId: "run",
        round: 1,
        context,
        currentArtifact: null,
        findings: [],
        retrievedEvidence: evidence,
      }),
    ).rejects.toThrow("recorded");

    const [plan] = planRequests;
    expect(plan?.promptCache?.stableInputMembers).toBe(5);
    expect(plan?.promptCache?.callInstructions).toBe(applicationPlanSystemPrompt);
    expect(plan?.systemPrompt).toBe(
      `${plan?.promptCache?.systemPrompt}\n\n${applicationPlanSystemPrompt}`,
    );
    expect(cachedPrefix(plan)).toEqual(cachedPrefix(draftRequests[0]));
    expect(cachedPrefix(plan).stable).toContain('"retrievedEvidence"');

    // Claude's cache keys on the output format too, so both calls list the same outputs.
    const [draft] = draftRequests;
    expect(plan?.promptCache?.outputSchemas).toEqual(draft?.promptCache?.outputSchemas);
    for (const sent of [plan, draft]) {
      expect(sent?.promptCache?.outputSchemas?.[sent.outputName]).toEqual(sent?.outputSchema);
    }
  });

  it("gives the critic's plan review the critiques' prefix, not the author's", async () => {
    const requests: ModelRequest<JsonObject>[] = [];
    const planner = createProviderApplicationPlanner({
      promptContext: context,
      dataPolicy,
      createAdapter: recordingAdapter(requests),
      author: { company: "anthropic", modelId: "a" },
      critic: { company: "openai", modelId: "c" },
      userError: (message) => new Error(message),
    });
    const plan = { themes: [], leads: { summaryAngle: "x", coreAreas: [] }, cuts: [] };
    await expect(
      planner.review({
        executionId: "run:review",
        runId: "run",
        context,
        retrievedEvidence: evidence,
        plan,
      }),
    ).rejects.toThrow("recorded");
    expect(requests[0]?.promptCache?.systemPrompt).toContain("independent DraftLoop critic");
    expect(requests[0]?.promptCache?.systemPrompt).not.toContain("DraftLoop CV author");
    expect(Object.keys(requests[0]?.input ?? {}).slice(0, 3)).toEqual([
      "context",
      "retrievedEvidence",
      "achievementPlan",
    ]);
  });
});
