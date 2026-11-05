import { writeFile } from "node:fs/promises";
import process from "node:process";
import {
  type AddedHostedKnowledgeSource,
  type ApplicationService,
  type HostedKnowledgeIntake,
  type HostedSensitivityRules,
  WorkspaceNotFoundError,
} from "@draft-loop/application";
import { type AnthropicRouteBuilder, createDirectAnthropicRoute } from "@draft-loop/model-gateway";
import { createMemoryCareerInterviewSessionStore } from "@draft-loop/storage/career-interview-sessions";
import type { ConsentLedger, ConsentState } from "@draft-loop/storage/consent-ledger";

import { buildApi } from "./app.js";

/**
 * The career interview's validation walk (#2179, #2203): one conversation through the API's own
 * routes, with the real Claude API and an invented career record and invented answers, ending with
 * the candidate confirming the summary into an in-memory knowledge base. It never runs in CI. It stops before a call once the spend reaches the cap, prints models, tokens and costs,
 * never the key, and writes the transcript to the file named by
 * DRAFT_LOOP_INTERVIEW_WALK_OUT (default career-interview-walk.md).
 */

const capUsd = Number(process.env.DRAFT_LOOP_INTERVIEW_WALK_CAP_USD ?? "1");
const output = process.env.DRAFT_LOOP_INTERVIEW_WALK_OUT ?? "career-interview-walk.md";
if (!(process.env.ANTHROPIC_API_KEY ?? "").trim()) {
  console.error("Set ANTHROPIC_API_KEY to run the walk.");
  process.exit(1);
}

// Invented: one role with no outcome, a gap before it, and contact data the model never sees.
const profile = {
  updatedAt: "2026-11-05T08:00:00.000Z",
  facts: [
    { id: "t1", category: "role", subjectId: "job1", field: "title", value: "Junior analyst" },
    {
      id: "e1",
      category: "employer",
      subjectId: "job1",
      field: "name",
      value: "Fernhill Insurance",
    },
    { id: "d1", category: "date", subjectId: "job1", field: "dates", value: "2012 to 2015" },
    {
      id: "o1",
      category: "achievement",
      subjectId: "job1",
      field: "outcome",
      value: "Automated claim reports",
    },
    { id: "t2", category: "role", subjectId: "job2", field: "title", value: "Analyst" },
    { id: "e2", category: "employer", subjectId: "job2", field: "name", value: "Example Bank" },
    { id: "d2", category: "date", subjectId: "job2", field: "dates", value: "2018 to 2023" },
    { id: "s2", category: "role", subjectId: "job2", field: "scope", value: "Loan reporting" },
    { id: "m1", category: "skill", field: "name", value: "Mentoring new analysts" },
    { id: "c1", category: "contact", field: "email", value: "candidate@example.test" },
  ],
};

// Invented answers, given in order; the candidate also skips once and forgets once.
const answers: readonly ({ text: string } | { mark: "skipped" | "unknown" })[] = [
  {
    text: "I rebuilt the monthly loan reports so the risk team had them on the second working day.",
  },
  {
    text: "Before that it took about ten days, and the risk team kept their own spreadsheet copies.",
  },
  { mark: "unknown" },
  { text: "I wrote the queries and the checks, and agreed the definitions with the risk lead." },
  { mark: "skipped" },
  { text: "The risk team stopped keeping their spreadsheet copies after the second quarter." },
  { text: "That is all I can think of for now." },
];

const service = {
  readWorkspace: async (root: string) => {
    if (root !== "/tenants/owner/workspaces/owner") throw new WorkspaceNotFoundError(root);
    return { id: "owner" };
  },
  listCanonicalCandidateProfileVersions: async () => [{ workspaceId: "owner", profile }],
  listApplications: async () => [],
} as unknown as ApplicationService;

const consent = {
  "provider-transmission": {
    id: "walk-consent",
    workspaceId: "owner",
    kind: "provider-transmission",
    action: "granted",
    basis: "consent",
    providers: ["anthropic"],
    recordedBy: "owner",
    recordedAt: "2026-11-05T07:00:00.000Z",
  },
} as unknown as ConsentState;

// The knowledge base a confirmed summary goes to, in memory: what the publisher writes is kept so
// the transcript can show the source, its evidence kind and its sensitivity rules.
const walkBaseId = "kb_walk";
const published: { name: string; mediaType: string; text: string; kind?: string }[] = [];
const ruleIds: string[] = [];
const knowledgeIntake = {
  maxSourceBytes: 1_000_000,
  addFileSource: async (command) => {
    published.push({
      name: command.displayName,
      mediaType: command.mediaType,
      text: new TextDecoder().decode(command.bytes),
    });
    const id = `src_walk_${published.length}`;
    return {
      created: true,
      source: { id, knowledgeBaseId: command.knowledgeBaseId, displayName: command.displayName },
      latestVersion: { id: `${id}_v1`, mediaType: command.mediaType },
    } as unknown as AddedHostedKnowledgeSource;
  },
} as HostedKnowledgeIntake;
const rulesView = () => ({
  knowledgeBaseId: walkBaseId,
  version: ruleIds.length,
  checksum: null,
  createdAt: null,
  rules: ruleIds.map((id) => ({ id })),
});
const sensitivityRules = {
  list: async () => rulesView(),
  add: async (_base: string, _rule: unknown, id?: string) => {
    ruleIds.push(id ?? `rule_${ruleIds.length + 1}`);
    return rulesView();
  },
} as unknown as HostedSensitivityRules;
const sourceEvidenceKinds = {
  appendCandidateKnowledgeSourceEvidenceKindOverride: async (
    _base: string,
    _source: string,
    override: { kind: string },
  ) => {
    const last = published.at(-1);
    if (last !== undefined) last.kind = override.kind;
  },
};

let spentUsd = 0;
const calls: string[] = [];
const direct = createDirectAnthropicRoute({
  resolveCredential: async () => process.env.ANTHROPIC_API_KEY,
});
const capped: AnthropicRouteBuilder = (input) => {
  const route = direct(input);
  return {
    ...route,
    execute: async (request) => {
      if (spentUsd >= capUsd) throw new Error(`The walk reached its US$${capUsd} cap.`);
      const response = await route.execute(request);
      spentUsd += response.cost.estimatedUsd ?? 0;
      calls.push(
        `${response.modelId} in=${response.usage.inputTokens} out=${response.usage.outputTokens} cost=${response.cost.estimatedUsd ?? "unpriced"}`,
      );
      return response;
    },
  };
};

const ownerToken = "walk-owner-token-0123456789abcdef0123";
const app = await buildApi({
  ownerToken,
  logger: false,
  application: {
    service,
    workspaceRoot: (workspaceId) => `/tenants/owner/workspaces/${workspaceId}`,
    enqueueRun: async () => undefined,
    budgetCeiling: { maxRounds: 1, maxCostUsd: capUsd, maxDurationMs: 600_000 },
    monthUsage: async () => [],
    consents: { current: async () => consent } as unknown as ConsentLedger,
    knowledgeIntake,
    sensitivityRules,
    sourceEvidenceKinds: sourceEvidenceKinds as never,
    careerInterview: {
      sessions: createMemoryCareerInterviewSessionStore(),
      allowProviderData: true,
      route: capped,
    },
  },
});

const sessions = "/v1/workspaces/owner/career-interview/sessions";
const call = async (url: string, payload?: object) => {
  const reply = await app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${ownerToken}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  if (reply.statusCode !== 200)
    throw new Error(`${url} answered ${reply.statusCode}: ${reply.body}`);
  return reply.json();
};

interface Topic {
  key: string;
  kind: string;
  reason: string;
  status: string;
  turns: { role: string; text: string; mark?: string }[];
  summary?: string;
}

const lines: string[] = ["# Career interview walk", ""];
try {
  const started = await call(sessions);
  const id = started.session.id as string;
  const topics = started.session.topics as Topic[];
  lines.push("## Proposal", "", started.proposal, "", "Topics found:", "");
  for (const topic of topics) lines.push(`- ${topic.kind}: ${topic.reason}`);
  const key = topics[0]?.key;
  if (key === undefined) throw new Error("The record produced no topic.");
  let current = await call(`${sessions}/${id}/actions`, { action: "accept", topic_key: key });
  for (const answer of answers) {
    const topic = (current.session.topics as Topic[]).find((each) => each.key === key);
    if (topic?.status !== "open") break;
    current = await call(`${sessions}/${id}/actions`, {
      action: "answer",
      topic_key: key,
      ...answer,
    });
  }
  const topic = (current.session.topics as Topic[]).find((each) => each.key === key);
  lines.push("", `## Conversation (${topic?.status})`, "");
  for (const turn of topic?.turns ?? []) {
    const speaker = turn.role === "interviewer" ? "Interviewer" : "Candidate";
    lines.push(`- **${speaker}:** ${turn.mark === undefined ? turn.text : `(${turn.mark})`}`);
  }
  lines.push("", "## Summary for confirmation", "", topic?.summary ?? "(none)");
  if (topic?.status === "summarised") {
    const confirmed = await call(`${sessions}/${id}/actions`, {
      action: "confirm",
      topic_key: key,
      knowledge_base_id: walkBaseId,
      tier: "normal",
    });
    const after = (confirmed.session.topics as Topic[]).find((each) => each.key === key);
    const source = published.at(-1);
    lines.push(
      "",
      "## Confirmed into evidence",
      "",
      `Topic status: ${after?.status}. Source: ${confirmed.published_source_id ?? "(none)"}, kind ${source?.kind ?? "(none)"}, ${source?.mediaType ?? "-"}, ${ruleIds.length} sensitivity rules.`,
      "",
      "```text",
      source?.text.trimEnd() ?? "(nothing written)",
      "```",
    );
  } else {
    lines.push("", "## Confirmed into evidence", "", "Not reached: the topic was not summarised.");
  }
  const model = current.session.model;
  lines.push(
    "",
    "## Calls",
    "",
    `Model: ${model?.model ?? "none"} (${model?.provider ?? "-"})`,
    "",
  );
  for (const each of calls) lines.push(`- ${each}`);
  lines.push("", `Spent: US$${spentUsd.toFixed(4)} of a US$${capUsd} cap.`);
} finally {
  await app.close();
  await writeFile(output, `${lines.join("\n")}\n`);
  console.info(
    `calls=${calls.length} spent=US$${spentUsd.toFixed(4)} cap=US$${capUsd} transcript=${output}`,
  );
}
