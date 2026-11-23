import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import {
  coverLetterClaimCheckModelId,
  coverLetterClaimCheckPromptVersion,
} from "@draft-loop/application/cover-letter-claims-model";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import { createMemoryCareerInterviewSessionStore } from "@draft-loop/storage/career-interview-sessions";
import type { ConsentLedger, ConsentState } from "@draft-loop/storage/consent-ledger";
import { createMemoryResearchBriefStore } from "@draft-loop/storage/research-briefs";
import { createMemorySavedApplicationMaterialStore } from "@draft-loop/storage/saved-application-material";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const base = "/v1/workspaces/owner/applications/app_fixture0001";
const url = `${base}/cover-letter-check`;

// An invented career record and job post; the contact fact must never reach the model.
const profile = {
  version: 1,
  status: "reviewed",
  updatedAt: "2026-11-05T08:00:00.000Z",
  facts: [
    { id: "t", category: "role", subjectId: "job", field: "title", value: "Data Analyst" },
    { id: "s", category: "skill", field: "tool", value: "SQL reporting" },
    { id: "k", category: "skill", field: "tool", value: "Kubernetes operations" },
    { id: "c", category: "contact", field: "email", value: "candidate@example.test" },
  ],
};

const service = {
  readWorkspace: async (root: string) => {
    if (root !== "/tenants/owner/workspaces/owner") throw new WorkspaceNotFoundError(root);
    return { id: "owner" };
  },
  listCanonicalCandidateProfileVersions: async () => [{ workspaceId: "owner", profile }],
  listApplications: async () => [],
  getApplication: async ({ applicationId }: { applicationId: string }) =>
    applicationId === "app_fixture0001"
      ? {
          id: applicationId,
          briefs: [{ briefId: "brief-1", latestVersion: 2, status: "reviewed", createdAt: "2026" }],
        }
      : undefined,
  getOpportunity: async () => ({
    brief: {
      role: { value: "Data Analyst" },
      responsibilities: [
        { text: "Build reliable SQL reporting pipelines for the clinical operations team" },
      ],
      requirements: [
        { id: "r1", text: "SQL reporting", priority: "high" },
        { id: "r2", text: "Kubernetes operations", priority: "medium" },
      ],
      priorities: [],
    },
  }),
} as unknown as ApplicationService;

const granted = {
  "provider-transmission": {
    id: "consent-1",
    workspaceId: "owner",
    kind: "provider-transmission",
    action: "granted",
    basis: "consent",
    providers: ["anthropic", "openai"],
    recordedBy: "owner",
    recordedAt: "2026-11-05T07:00:00.000Z",
  },
} as unknown as ConsentState;

const letter = [
  "As a Data Analyst I built SQL reporting for five teams.",
  "I will build reliable SQL reporting pipelines for the clinical operations team.",
].join("\n\n");

const links = {
  links: [
    {
      sentence_id: "p0.s0",
      kind: "candidate",
      fact_ids: [],
      company_fact_ids: [],
      requirement_ids: [],
    },
    {
      sentence_id: "p1.s0",
      kind: "employer",
      fact_ids: [],
      company_fact_ids: [],
      requirement_ids: ["r1"],
    },
  ],
};

interface Call {
  readonly model: string;
  readonly version: string;
  readonly input: Record<string, unknown>;
}

function scriptedRoute(answer: object, calls: Call[]): AnthropicRouteBuilder {
  return ({ configuredModel }) => ({
    provider: "anthropic",
    route: "anthropic-api",
    execute: async (request) => {
      expect(request.model).toEqual(configuredModel);
      calls.push({
        model: request.model.modelId,
        version: request.model.promptTemplateVersion,
        input: request.input as Record<string, unknown>,
      });
      return {
        output: answer,
        contextSnapshotId: request.contextSnapshotId,
        provider: "anthropic",
        company: "anthropic",
        route: "anthropic-api",
        modelId: request.model.modelId,
        providerRequestId: null,
        structuredOutputSha256: "0".repeat(64),
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        cost: { estimatedUsd: 0.002 },
      } as never;
    },
  });
}

const kit = {
  requirements: [
    {
      requirement_id: "r2",
      text: "Kubernetes operations",
      facts: [{ fact_id: "k", text: "skill tool: Kubernetes operations" }],
    },
  ],
  angles: [
    { note: "Lead with the cluster work", fact_ids: ["k"], finding_ids: [] },
    { note: "Open on their clinic tools", fact_ids: ["k"], finding_ids: [] },
  ],
  employer_facts: [],
  outline: [1, 2, 3, 4].map((paragraph) => ({
    paragraph,
    purpose: "Prove the cluster work",
    requirement_ids: [],
    fact_ids: [],
    finding_ids: [],
  })),
  avoid: ["proven track record"],
};

let app: FastifyInstance;

async function build(options: {
  route?: AnthropicRouteBuilder;
  consent?: ConsentState;
  paused?: boolean;
  withKit?: boolean;
  tally?: { count: (now: Date) => Promise<void> };
}) {
  const consents = { current: async () => options.consent ?? {} } as unknown as ConsentLedger;
  const drafts = createMemorySavedApplicationMaterialStore();
  if (options.withKit === true) {
    await drafts.insert({
      id: "amd_kit000000001",
      workspace_id: "owner",
      application_id: "app_fixture0001",
      created_at: "2026-11-09T10:00:00.000Z",
      kind: "cover-letter-kit",
      items: [],
      kit,
      model: { provider: "anthropic", model: "claude-haiku-5-5" },
      prompt_version: "cover-letter-kit-v1",
      cost_usd: 0.003,
    } as never);
  }
  app = await buildApi({
    ownerToken,
    logger: false,
    ...(options.paused === undefined ? {} : { modelCallSwitch: async () => options.paused }),
    ...(options.tally === undefined ? {} : { coverLetterChecks: options.tally }),
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      consents,
      applicationMaterialDrafts: drafts,
      researchBriefs: createMemoryResearchBriefStore(),
      careerInterview: {
        sessions: createMemoryCareerInterviewSessionStore(),
        allowProviderData: true,
        ...(options.route === undefined ? {} : { route: options.route }),
      },
    },
  } as Parameters<typeof buildApi>[0]);
  return drafts;
}

const post = (text: unknown = letter) =>
  app.inject({ method: "POST", url, headers: { authorization }, payload: { text } });

afterEach(async () => {
  await app.close();
});

describe("Check my letter route", () => {
  it("checks the claims on Haiku, reads the kit's requirements and stores nothing", async () => {
    const calls: Call[] = [];
    const drafts = await build({
      route: scriptedRoute(links, calls),
      consent: granted,
      withKit: true,
    });

    const response = await post();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.claims).toEqual({
      status: "checked",
      checked_sentences: 2,
      findings: [
        {
          paragraph: 0,
          sentence: "As a Data Analyst I built SQL reporting for five teams.",
          about: "candidate",
          reason: "no_supporting_fact",
          closest_fact: { fact_id: "s", text: "skill tool: SQL reporting" },
        },
      ],
    });
    expect(body.requirements).toEqual({
      source: "kit",
      kit_id: "amd_kit000000001",
      total: 1,
      unanswered: kit.requirements,
    });
    expect(body.wording).toContainEqual({
      code: "job_ad_echo",
      paragraph: 1,
      sentence: "I will build reliable SQL reporting pipelines for the clinical operations team.",
      match: "build reliable sql reporting pipelines for the clinical operations team",
    });
    expect(body).toMatchObject({
      model: { provider: "anthropic", model: coverLetterClaimCheckModelId },
      prompt_version: coverLetterClaimCheckPromptVersion,
      cost_usd: 0.002,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toMatch(/haiku/u);
    expect(JSON.stringify(calls[0]?.input)).not.toContain("candidate@example.test");
    // The letter is returned on, never kept: the store still holds only the kit.
    const saved = await drafts.list("owner", "app_fixture0001");
    expect(saved.map((draft) => draft.id)).toEqual(["amd_kit000000001"]);
    expect(JSON.stringify(saved)).not.toContain("five teams");
  });

  it("falls back to the brief's top requirements without a kit", async () => {
    await build({ route: scriptedRoute(links, []), consent: granted });

    const body = (await post()).json();

    expect(body.requirements.source).toBe("brief");
    expect(body.requirements.total).toBe(2);
    expect(
      body.requirements.unanswered.map((each: { requirement_id: string }) => each.requirement_id),
    ).toEqual(["r2"]);
  });

  it("skips the claim check while model calls are paused and still returns the rest", async () => {
    const calls: Call[] = [];
    await build({ route: scriptedRoute(links, calls), consent: granted, paused: true });

    const response = await post();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.claims).toEqual({
      status: "skipped",
      reason: "model_calls_paused",
      checked_sentences: 0,
      findings: [],
    });
    expect(body.wording.map((finding: { code: string }) => finding.code)).toContain("job_ad_echo");
    expect(body).toMatchObject({ model: null, prompt_version: null, cost_usd: 0 });
    expect(calls).toEqual([]);
  });

  it("skips the claim check without consent or a model route", async () => {
    const calls: Call[] = [];
    await build({ route: scriptedRoute(links, calls) });
    expect((await post()).json().claims.reason).toBe("consent_required");
    await app.close();

    await build({ consent: granted });
    expect((await post()).json().claims.reason).toBe("model_unavailable");
    expect(calls).toEqual([]);
  });

  it("refuses an empty letter and one past 8,000 characters before any model call", async () => {
    const calls: Call[] = [];
    await build({ route: scriptedRoute(links, calls), consent: granted });

    expect((await post("   ")).statusCode).toBe(400);
    expect((await post("a".repeat(8_001))).statusCode).toBe(400);
    expect(calls).toEqual([]);
  });

  it("counts each answered check for the digest, with no letter, and never fails on the count (#3282)", async () => {
    const counted: unknown[][] = [];
    await build({
      route: scriptedRoute(links, []),
      consent: granted,
      tally: {
        count: async (...args) => {
          counted.push(args);
        },
      },
    });
    expect((await post()).statusCode).toBe(200);
    await app.close();
    await build({
      consent: granted,
      paused: true,
      tally: {
        count: async (...args) => {
          counted.push(args);
        },
      },
    });
    expect((await post()).statusCode).toBe(200);
    expect((await post("   ")).statusCode).toBe(400);
    // One count per answered check, each only a time: the letter never reaches the tally.
    expect(counted).toHaveLength(2);
    expect(counted.every((args) => args.length === 1 && args[0] instanceof Date)).toBe(true);
    await app.close();

    await build({
      consent: granted,
      paused: true,
      tally: {
        count: async () => {
          throw new Error("database unavailable");
        },
      },
    });
    expect((await post()).statusCode).toBe(200);
  });

  it("answers 404 for an unknown application", async () => {
    await build({ consent: granted });
    const response = await app.inject({
      method: "POST",
      url: "/v1/workspaces/owner/applications/app_missing0001/cover-letter-check",
      headers: { authorization },
      payload: { text: letter },
    });
    expect(response.statusCode).toBe(404);
  });
});
