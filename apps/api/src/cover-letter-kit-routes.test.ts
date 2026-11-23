import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import {
  coverLetterKitModelId,
  coverLetterKitPromptVersion,
} from "@draft-loop/application/cover-letter-kit-model";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import type { ResearchBrief } from "@draft-loop/schemas/research-brief";
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
const url = `${base}/cover-letter-kit`;

// An invented career record, job post and employer; the contact fact must never reach the model.
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
      requirements: [
        { id: "r1", text: "SQL reporting", priority: "high" },
        { id: "r2", text: "Kubernetes operations", priority: "medium" },
      ],
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

const outline = [1, 2, 3, 4].map((paragraph) => ({
  paragraph,
  purpose: paragraph === 1 ? "Open on their clinic tools" : "Prove the SQL reporting",
  requirement_ids: paragraph === 1 ? [] : ["r1"],
  fact_ids: paragraph === 1 ? [] : ["s"],
  finding_ids: paragraph === 1 ? ["fnd_1"] : [],
}));

const validKit = {
  requirements: [
    { requirement_id: "r1", fact_ids: ["s", "t"] },
    { requirement_id: "r2", fact_ids: ["k"] },
  ],
  angles: [
    { note: "Lead with the SQL reporting as a Data Analyst", fact_ids: ["s"], finding_ids: [] },
    { note: "Open on their tools for clinics", fact_ids: [], finding_ids: ["fnd_1"] },
  ],
  employer_finding_ids: ["fnd_1"],
  outline,
};

interface Call {
  readonly model: string;
  readonly version: string;
  readonly input: Record<string, unknown>;
}

function scriptedRoute(answers: readonly object[], calls: Call[]): AnthropicRouteBuilder {
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
        output: answers[calls.length - 1] ?? answers.at(-1),
        contextSnapshotId: request.contextSnapshotId,
        provider: "anthropic",
        company: "anthropic",
        route: "anthropic-api",
        modelId: request.model.modelId,
        providerRequestId: null,
        structuredOutputSha256: "0".repeat(64),
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        cost: { estimatedUsd: 0.003 },
      } as never;
    },
  });
}

let app: FastifyInstance;

async function build(options: { route?: AnthropicRouteBuilder; consent?: ConsentState }) {
  const consents = { current: async () => options.consent ?? {} } as unknown as ConsentLedger;
  const drafts = createMemorySavedApplicationMaterialStore();
  const researchBriefs = createMemoryResearchBriefStore();
  await researchBriefs.insert({
    id: "rbr_fixture0001",
    workspace_id: "owner",
    application_id: "app_fixture0001",
    queries: ["Example Corp"],
    from_date: "2025-11-08",
    sources: [
      {
        id: "src_1",
        kind: "web-result",
        url: "https://example.org/src_1",
        title: "Page src_1",
        excerpt: "A fictional page.",
        published_on: "2026-10-03",
        topic: "company",
        reliability: "press",
      },
    ],
    findings: [
      { id: "fnd_1", text: "Example Corp builds tools for clinics.", source_ids: ["src_1"] },
    ],
    dropped: { flagged: 0, outdated: 0 },
    search_provider: "scripted",
    model: { provider: "anthropic", model: "claude-haiku-5-5" },
    cost_usd: 0.05,
    created_at: new Date().toISOString(),
  } as ResearchBrief);
  app = await buildApi({
    ownerToken,
    logger: false,
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      consents,
      applicationMaterialDrafts: drafts,
      researchBriefs,
      careerInterview: {
        sessions: createMemoryCareerInterviewSessionStore(),
        allowProviderData: true,
        ...(options.route === undefined ? {} : { route: options.route }),
      },
    },
  });
  return drafts;
}

const post = () => app.inject({ method: "POST", url, headers: { authorization }, payload: {} });

afterEach(async () => {
  await app.close();
});

describe("cover letter writing kit route", () => {
  it("prepares a kit on Haiku, cites the record and saves it with the application", async () => {
    const calls: Call[] = [];
    await build({ route: scriptedRoute([validKit], calls), consent: granted });

    const response = await post();

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      kind: "cover-letter-kit",
      items: [],
      research_brief_id: "rbr_fixture0001",
      model: { provider: "anthropic", model: coverLetterKitModelId },
      prompt_version: coverLetterKitPromptVersion,
      cost_usd: 0.003,
    });
    expect(body.id).toMatch(/^amd_/u);
    expect(body.kit.requirements[0]).toEqual({
      requirement_id: "r1",
      text: "SQL reporting",
      facts: [
        { fact_id: "s", text: "skill tool: SQL reporting" },
        { fact_id: "t", text: "role title: Data Analyst" },
      ],
    });
    expect(body.kit.employer_facts).toEqual([
      {
        finding_id: "fnd_1",
        text: "Example Corp builds tools for clinics.",
        published_on: "2026-10-03",
      },
    ]);
    expect(body.kit.avoid).toContain("proven track record");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toMatch(/haiku/u);
    expect(JSON.stringify(calls[0]?.input)).not.toContain("candidate@example.test");

    const listed = await app.inject({
      method: "GET",
      url: `${base}/material?kind=cover-letter-kit`,
      headers: { authorization },
    });
    expect(listed.json().drafts.map((draft: { id: string }) => draft.id)).toEqual([body.id]);
    const letters = await app.inject({
      method: "GET",
      url: `${base}/material?kind=cover-letter`,
      headers: { authorization },
    });
    expect(letters.json().drafts).toEqual([]);

    const document = await app.inject({
      method: "GET",
      url: `${base}/material/${body.id}/document?format=pdf`,
      headers: { authorization },
    });
    expect(document.statusCode).toBe(409);
    expect(document.json().error.code).toBe("not_a_document");
    // The candidate's own letter is saved beside the kit (#3279): theirs, uncited, free.
    const own = await app.inject({
      method: "POST",
      url: `${base}/material/${body.id}/versions`,
      headers: { authorization },
      payload: {
        items: [{ text: "Fictional opening, 12 reports." }, { text: "Fictional close." }],
      },
    });
    expect(own.statusCode).toBe(200);
    const letter = own.json();
    expect(letter).toMatchObject({
      kind: "cover-letter",
      written_by: "candidate",
      based_on: body.id,
      cost_usd: 0,
    });
    expect(letter.items.map((item: { text: string }) => item.text)).toEqual([
      "Fictional opening, 12 reports.",
      "Fictional close.",
    ]);
    expect(letter.items[0].unsupported_numbers).toBeUndefined();
    expect(letter.items[0].citations).toEqual([]);
    const rewritten = await app.inject({
      method: "POST",
      url: `${base}/material/${letter.id}/versions`,
      headers: { authorization },
      payload: { items: [{ text: "One fictional paragraph." }] },
    });
    expect(rewritten.json()).toMatchObject({ written_by: "candidate", based_on: letter.id });
    const letterDocument = await app.inject({
      method: "GET",
      url: `${base}/material/${letter.id}/document?format=docx`,
      headers: { authorization },
    });
    expect(letterDocument.statusCode).toBe(200);
  });

  it("refuses a kit citing an unknown fact id twice and saves nothing", async () => {
    const calls: Call[] = [];
    const unknown = {
      ...validKit,
      requirements: [{ requirement_id: "r1", fact_ids: ["f_missing"] }, validKit.requirements[1]],
    };
    const drafts = await build({ route: scriptedRoute([unknown], calls), consent: granted });

    const response = await post();

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("invalid_kit");
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1]?.input)).toContain("f_missing");
    expect(await drafts.list("owner", "app_fixture0001")).toEqual([]);
  });

  it("refuses notes written as letter sentences", async () => {
    const prose = {
      ...validKit,
      angles: [
        { note: "I built SQL reports as a Data Analyst.", fact_ids: ["s"], finding_ids: [] },
        validKit.angles[1],
      ],
    };
    await build({ route: scriptedRoute([prose], []), consent: granted });

    expect((await post()).statusCode).toBe(422);
  });

  it("needs consent and a model route, and calls no model without them", async () => {
    const calls: Call[] = [];
    await build({ route: scriptedRoute([validKit], calls) });
    const refused = await post();
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("consent_required");
    await app.close();

    await build({ consent: granted });
    const unavailable = await post();
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe("material_model_unavailable");
    expect(calls).toHaveLength(0);
  });
});
