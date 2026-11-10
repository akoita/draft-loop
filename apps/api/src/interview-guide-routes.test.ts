import { type ApplicationService, WorkspaceNotFoundError } from "@draft-loop/application";
import { type FactUsageSettings, factUsageKey } from "@draft-loop/application/fact-usage";
import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import type { ResearchBrief } from "@draft-loop/schemas/research-brief";
import { createMemoryCareerInterviewSessionStore } from "@draft-loop/storage/career-interview-sessions";
import type { ConsentLedger, ConsentState } from "@draft-loop/storage/consent-ledger";
import {
  createMemoryResearchBriefStore,
  type ResearchBriefStore,
} from "@draft-loop/storage/research-briefs";
import { createMemorySavedApplicationMaterialStore } from "@draft-loop/storage/saved-application-material";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import type { ResearchRuns } from "./research-runs.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const authorization = `Bearer ${ownerToken}`;
const url = "/v1/workspaces/owner/applications/app_fixture0001/interview-guide";

// An invented career record and job post; the contact fact must never reach the model.
const profile = {
  updatedAt: "2026-11-05T08:00:00.000Z",
  facts: [
    { id: "t", category: "role", subjectId: "job", field: "title", value: "Data Analyst" },
    { id: "s", category: "skill", field: "tool", value: "SQL reporting" },
    { id: "h", category: "role", subjectId: "old", field: "title", value: "Night Porter" },
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

const essentialItems = {
  items: [
    {
      section: "read-first",
      heading: "",
      text: "As a Data Analyst you lead with reporting.",
      trap: "",
    },
    { section: "company", heading: "", text: "Example Corp builds tools for clinics.", trap: "" },
    {
      section: "defense",
      heading: "Kubernetes",
      text: "You have not run Kubernetes yourself. You once worked as a Night Porter.",
      trap: "",
    },
    {
      section: "questions",
      heading: "How do you report?",
      text: "Your SQL reporting as a Data Analyst answers it.",
      trap: "Do not claim you invented the warehouse.",
    },
  ],
};

/** Links each sentence as a reviewer would: the candidate's role, the employer, or a gap. */
function linksFor(input: { sentences: { id: string; text: string }[] }) {
  return {
    links: input.sentences.map((sentence) => {
      if (/Data Analyst/u.test(sentence.text)) {
        return {
          sentence_id: sentence.id,
          kind: "candidate",
          fact_ids: ["t"],
          company_fact_ids: [],
        };
      }
      if (/Example Corp/u.test(sentence.text)) {
        return {
          sentence_id: sentence.id,
          kind: "employer",
          fact_ids: [],
          company_fact_ids: ["fnd_1"],
        };
      }
      if (/not run Kubernetes/u.test(sentence.text)) {
        return {
          sentence_id: sentence.id,
          kind: "candidate",
          fact_ids: ["gap_1"],
          company_fact_ids: [],
        };
      }
      if (/Night Porter/u.test(sentence.text)) {
        return {
          sentence_id: sentence.id,
          kind: "candidate",
          fact_ids: ["h"],
          company_fact_ids: [],
        };
      }
      // An unsupported claim about the candidate: the check leaves it out.
      return { sentence_id: sentence.id, kind: "candidate", fact_ids: [], company_fact_ids: [] };
    }),
  };
}

interface Call {
  readonly version: string;
  readonly input: Record<string, unknown>;
}

function scriptedRoute(
  writer: readonly object[],
  calls: Call[],
  costUsd = 0.002,
): AnthropicRouteBuilder {
  let written = 0;
  return ({ configuredModel }) => ({
    provider: "anthropic",
    route: "anthropic-api",
    execute: async (request) => {
      expect(request.model).toEqual(configuredModel);
      const version = request.model.promptTemplateVersion;
      calls.push({ version, input: request.input as Record<string, unknown> });
      let output: object;
      if (version === "interview-guide-v1") {
        output = writer[written] ?? writer.at(-1) ?? { items: [] };
        written += 1;
      } else {
        output = linksFor(request.input as never);
      }
      return {
        output,
        contextSnapshotId: request.contextSnapshotId,
        provider: "anthropic",
        company: "anthropic",
        route: "anthropic-api",
        modelId: request.model.modelId,
        providerRequestId: null,
        structuredOutputSha256: "0".repeat(64),
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        cost: { estimatedUsd: costUsd },
      } as never;
    },
  });
}

async function freshBrief(store: ResearchBriefStore, createdAt = new Date().toISOString()) {
  const source = (id: string, topic: string) => ({
    id,
    kind: "web-result" as const,
    url: `https://example.org/${id}`,
    title: `Page ${id}`,
    excerpt: "A fictional page.",
    published_on: "2026-10-03",
    topic,
    reliability: "press",
  });
  const brief = {
    id: "rbr_fixture0001",
    workspace_id: "owner",
    application_id: "app_fixture0001",
    queries: ["Example Corp"],
    from_date: "2025-11-08",
    sources: [source("src_1", "company"), source("src_2", "role"), source("src_3", "field")],
    findings: [
      { id: "fnd_1", text: "Example Corp builds tools for clinics.", source_ids: ["src_1"] },
    ],
    dropped: { flagged: 0, outdated: 0 },
    search_provider: "scripted",
    model: { provider: "anthropic", model: "claude-haiku-5-5" },
    cost_usd: 0.05,
    created_at: createdAt,
  } as ResearchBrief;
  await store.insert(brief);
}

let app: FastifyInstance;
let logs: string[];

async function build(options: {
  route?: AnthropicRouteBuilder;
  consent?: ConsentState;
  usage?: FactUsageSettings;
  researchBriefs?: ResearchBriefStore;
  runs?: ResearchRuns;
}) {
  logs = [];
  const consents = { current: async () => options.consent ?? {} } as unknown as ConsentLedger;
  const drafts = createMemorySavedApplicationMaterialStore();
  app = await buildApi({
    ownerToken,
    logger: { level: "info", stream: { write: (line: string) => logs.push(line) } },
    application: {
      service,
      workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
      enqueueRun: async () => undefined,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      monthUsage: async () => [],
      consents,
      applicationMaterialDrafts: drafts,
      ...(options.usage === undefined
        ? {}
        : {
            factUsage: {
              read: async () => options.usage as FactUsageSettings,
              change: async () => options.usage as FactUsageSettings,
            },
          }),
      ...(options.researchBriefs === undefined ? {} : { researchBriefs: options.researchBriefs }),
      ...(options.runs === undefined ? {} : { researchRuns: options.runs }),
      careerInterview: {
        sessions: createMemoryCareerInterviewSessionStore(),
        allowProviderData: true,
        ...(options.route === undefined ? {} : { route: options.route }),
      },
    },
  });
  return drafts;
}

const post = (payload: object) =>
  app.inject({ method: "POST", url, headers: { authorization }, payload });

const essential = { stage: "screen", depth: "essential", topics: ["salary"] };

afterEach(async () => {
  await app.close();
});

describe("interview guide route", () => {
  it("drafts an essential guide, checks every sentence and saves it with its details", async () => {
    const calls: Call[] = [];
    const researchBriefs = createMemoryResearchBriefStore();
    await freshBrief(researchBriefs);
    const drafts = await build({
      consent: granted,
      route: scriptedRoute([essentialItems], calls),
      researchBriefs,
    });
    const response = await post({
      details: { ...essential, never_say: ["my old manager"] },
      research: "skip",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.kind).toBe("interview-guide");
    expect(body.interview_details.never_say).toEqual(["my old manager"]);
    expect(body.prompt_version).toBe("interview-guide-v1");
    expect(body.research_brief_id).toBe("rbr_fixture0001");
    // Salary was picked and no source covers it: it is reported, never filled from memory.
    expect(body.unsourced_topics).toEqual(["salary"]);
    // The unsupported trap was left out; the defense line stands on the gap and a real fact.
    expect(body.dropped_sentences).toEqual(["Do not claim you invented the warehouse."]);
    const sections = body.items.map((item: { section: string }) => item.section);
    expect(sections).toEqual([
      "read-first",
      "company",
      "defense",
      "questions",
      "never-say",
      "sources",
      "sources",
      "sources",
    ]);
    const company = body.items[1];
    expect(company.company_citations).toEqual([
      { finding_id: "fnd_1", text: "Example Corp builds tools for clinics." },
    ]);
    const defense = body.items[2];
    expect(defense.citations.map((citation: { fact_id: string }) => citation.fact_id)).toEqual([
      "h",
    ]);
    expect(body.items[4].text).toBe("my old manager");
    // Two calls: the writer, then the claim check on its own route and model.
    expect(calls.map((call) => call.version)).toEqual([
      "interview-guide-v1",
      "cover-letter-claims-v1",
    ]);
    const sent = JSON.stringify(calls);
    expect(sent).not.toContain("candidate@example.test");
    expect(sent).not.toContain("my old manager");
    expect(logs.join("\n")).not.toContain("Data Analyst");
    const saved = await drafts.get("owner", body.id);
    expect(saved?.interview_details?.depth).toBe("essential");
  });

  it("queues guide research when the candidate approved and the brief cannot serve", async () => {
    const queued: unknown[] = [];
    const runs: ResearchRuns = {
      queue: async (job) => {
        queued.push(job);
        return "queued";
      },
      state: async () => ({ status: "pending" }),
    };
    const calls: Call[] = [];
    await build({
      consent: granted,
      route: scriptedRoute([essentialItems], calls),
      researchBriefs: createMemoryResearchBriefStore(),
      runs,
    });
    const response = await post({ details: essential, research: "approved" });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "researching", research: { status: "pending" } });
    expect(queued).toEqual([
      {
        workspaceId: "owner",
        applicationId: "app_fixture0001",
        guide: { depth: "essential", salary: true },
      },
    ]);
    expect(calls).toEqual([]);
  });

  it("reuses a recent brief that covers the guide's topics instead of searching again", async () => {
    const queued: unknown[] = [];
    const researchBriefs = createMemoryResearchBriefStore();
    await freshBrief(researchBriefs);
    await build({
      consent: granted,
      route: scriptedRoute([essentialItems], []),
      researchBriefs,
      runs: {
        queue: async (job) => {
          queued.push(job);
          return "queued";
        },
        state: async () => undefined,
      },
    });
    const response = await post({
      details: { stage: "screen", depth: "essential" },
      research: "approved",
    });
    expect(response.statusCode).toBe(200);
    expect(queued).toEqual([]);
    expect(response.json().unsourced_topics).toBeUndefined();
  });

  it("writes an extensive guide in three calls and writes one part again from a saved guide", async () => {
    const calls: Call[] = [];
    const part = (section: string, text: string) => ({ section, heading: "", text, trap: "" });
    const context = { items: [part("company", "Example Corp builds tools for clinics.")] };
    const story = { items: [part("pitch", "Open as a Data Analyst.")] };
    const practice = { items: [part("checklist", "Reread your notes as a Data Analyst.")] };
    const rewritten = {
      items: [part("pitch", "Start with your SQL reporting as a Data Analyst.")],
    };
    const researchBriefs = createMemoryResearchBriefStore();
    await freshBrief(researchBriefs);
    await build({
      consent: granted,
      route: scriptedRoute([context, story, practice, rewritten], calls),
      researchBriefs,
    });
    const details = { stage: "combined", depth: "extensive" };
    const first = await post({ details, research: "skip" });
    expect(first.statusCode).toBe(200);
    const guide = first.json();
    const sectionsOf = (items: { section: string }[]) => items.map((item) => item.section);
    expect(sectionsOf(guide.items)).toEqual([
      "company",
      "matrix",
      "matrix",
      "pitch",
      "checklist",
      "sources",
      "sources",
      "sources",
    ]);
    expect(calls.filter((call) => call.version === "interview-guide-v1")).toHaveLength(3);

    const again = await post({ details, research: "skip", parts: ["story"], based_on: guide.id });
    expect(again.statusCode).toBe(200);
    const next = again.json();
    expect(next.based_on).toBe(guide.id);
    expect(next.items.find((item: { section: string }) => item.section === "pitch").text).toBe(
      "Start with your SQL reporting as a Data Analyst.",
    );
    expect(next.items.find((item: { section: string }) => item.section === "company").text).toBe(
      "Example Corp builds tools for clinics.",
    );
    expect(calls.filter((call) => call.version === "interview-guide-v1")).toHaveLength(4);
  });

  it("refuses parts without a saved extensive guide, and a guide of another kind", async () => {
    await build({ consent: granted, route: scriptedRoute([essentialItems], []) });
    const essentialParts = await post({ details: essential, research: "skip", parts: ["story"] });
    expect(essentialParts.statusCode).toBe(400);
    const missing = await post({
      details: { stage: "final", depth: "extensive" },
      research: "skip",
      parts: ["story"],
      based_on: "amd_missingmissingmissing",
    });
    expect(missing.statusCode).toBe(404);
  });

  it("keeps never-said facts from the model and lists them under never say", async () => {
    const calls: Call[] = [];
    await build({
      consent: granted,
      route: scriptedRoute([essentialItems], calls),
      usage: {
        schemaVersion: 1,
        sections: {},
        facts: {
          [factUsageKey({ category: "role", field: "title", value: "Night Porter" })]: "never-say",
        },
      },
    });
    const response = await post({ details: essential, research: "skip" });
    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(calls[0]?.input)).not.toContain("Night Porter");
    const neverSay = response
      .json()
      .items.filter((item: { section: string }) => item.section === "never-say");
    expect(neverSay.map((item: { text: string }) => item.text)).toEqual([
      expect.stringContaining("Night Porter"),
    ]);
  });

  it("refuses without consent, without a route, and when the next call could pass the cap", async () => {
    await build({ route: scriptedRoute([essentialItems], []) });
    expect((await post({ details: essential, research: "skip" })).statusCode).toBe(403);
    await app.close();
    await build({ consent: granted });
    expect((await post({ details: essential, research: "skip" })).statusCode).toBe(503);
    await app.close();
    await build({ consent: granted, route: scriptedRoute([essentialItems], [], 0.19) });
    const capped = await post({ details: essential, research: "skip" });
    expect(capped.statusCode).toBe(409);
    expect(capped.json().error.code).toBe("cost_cap_reached");
  });
});
