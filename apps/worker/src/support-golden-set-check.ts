import process from "node:process";
import { catalogModelPricing } from "@draft-loop/application";
import {
  createSupportAssistant,
  gradeSupportGoldenReply,
  type SupportGoldenResult,
  type SupportModel,
  type SupportUsageLedger,
  summarizeSupportGoldenRun,
  supportGoldenSet,
  supportPromptVersion,
} from "@draft-loop/support";

import { readModelGatewayConfig, workerProviderOptions } from "./model-routes.js";

/**
 * The support assistant's paid check (#2884): the 40 golden questions through the worker's own
 * Claude route, with a synthetic account and no member data. It never runs in CI. It runs as a
 * manually started job, stops before any call that could pass DRAFT_LOOP_SUPPORT_CHECK_CAP_USD
 * (default 0.50), and prints one line per question and a summary, never a key.
 */
const capUsd = Number(process.env.DRAFT_LOOP_SUPPORT_CHECK_CAP_USD ?? "0.5");
if (!(Number.isFinite(capUsd) && capUsd > 0 && capUsd <= 1)) {
  console.error("DRAFT_LOOP_SUPPORT_CHECK_CAP_USD must be above 0 and at most 1.");
  process.exit(1);
}
const config = readModelGatewayConfig(process.env);
if (config === undefined) {
  console.error("Set the worker's DRAFT_LOOP_VERTEX_* or direct Claude settings.");
  process.exit(1);
}

const model = {
  company: "anthropic",
  modelId: process.env.DRAFT_LOOP_SUPPORT_CHECK_MODEL ?? "claude-haiku-5-5",
  role: "author",
  promptTemplateVersion: supportPromptVersion,
} as const;
if (!/^claude-(haiku|sonnet)-/.test(model.modelId)) {
  console.error("The check runs on a Haiku or Sonnet model only.");
  process.exit(1);
}
const pricing = catalogModelPricing(model);
const route = workerProviderOptions(config).providerClientFactories?.anthropicRoute?.({
  configuredModel: model,
  ...(pricing === undefined ? {} : { pricing }),
});
if (route === undefined) {
  console.error("The worker has no Claude route.");
  process.exit(1);
}

let spentUsd = 0;
// The dearest call so far, as the reserve kept before the next one; a first guess until then.
let largestCallUsd = 0.02;
let questionUsd = 0;
let capReached = false;

const supportModel: SupportModel = async (request) => {
  if (spentUsd + largestCallUsd > capUsd) {
    capReached = true;
    throw new Error(`The next call could pass the US$${capUsd} cap.`);
  }
  const response = await route.execute({
    contextSnapshotId: "support-golden-set-check",
    model,
    systemPrompt: request.systemPrompt,
    input: request.input as never,
    promptCache: {
      systemPrompt: request.systemPrompt,
      callInstructions: "",
      stableInputMembers: 1,
      lifetime: "1h",
    },
    outputSchema: request.outputSchema as never,
    outputName: request.outputName,
    maxOutputTokens: request.maxOutputTokens,
    dataPolicy: {
      allowTransmission: true,
      allowedCompanies: ["anthropic"],
      sensitiveData: false,
      sensitiveDataAcknowledged: false,
    },
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  });
  const cost = response.cost.estimatedUsd;
  if (cost === undefined || cost === null) {
    // Without a price the cap cannot hold, so the check stops here.
    console.error(`No price for ${response.modelId}; stopping.`);
    process.exit(1);
  }
  spentUsd += cost;
  questionUsd += cost;
  largestCallUsd = Math.max(largestCallUsd, cost);
  return {
    output: response.output,
    modelId: response.modelId,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    estimatedUsd: cost,
  };
};

// Invented: one plan, one finished run and one failed run, no names and no CV.
const runs = [
  {
    run_id: "run_check_0001",
    application_id: "app_check_0001",
    state: "completed",
    error_code: null,
    recoverable: null,
    wait_seconds: null,
    updated_at: "2026-11-17T09:00:00.000Z",
  },
  {
    run_id: "run_check_0002",
    application_id: "app_check_0002",
    state: "failed",
    error_code: "provider-rate-limited",
    recoverable: true,
    wait_seconds: 120,
    updated_at: "2026-11-17T10:00:00.000Z",
  },
] as const;
const account = {
  accountSummary: async () => ({
    plan: "individual",
    credits: 3,
    counters: [{ name: "prepare_calls", used: 2, limit: 20 }],
  }),
  recentRuns: async (limit: number) => runs.slice(0, limit),
  runStatus: async (runId: string) => runs.find((run) => run.run_id === runId) ?? null,
  serviceStatus: async () => ({ state: "operational" as const, codes: [] }),
};
const usage: SupportUsageLedger = {
  questionsToday: async () => 0,
  costTodayUsd: async () => spentUsd,
  countQuestion: async () => undefined,
  record: async () => undefined,
};

const assistant = createSupportAssistant({
  model: supportModel,
  account,
  usage,
  limits: { dailyCostCapUsd: capUsd, memberDailyQuestions: supportGoldenSet.length },
  timeoutMs: 30_000,
});

const results: SupportGoldenResult[] = [];
for (const question of supportGoldenSet) {
  questionUsd = 0;
  const reply = await assistant.answer({
    memberId: "check-member",
    conversationId: `sup_check_${question.id}`,
    language: question.language,
    question: question.question,
  });
  const result = gradeSupportGoldenReply(question, reply, questionUsd);
  results.push(result);
  const detail =
    reply.mode === "assistant" ? `outcome=${reply.outcome}` : `fallback=${reply.reason}`;
  console.info(
    `${result.verdict.padEnd(19)} ${question.id} ${detail} cited=${result.cited.join(",") || "-"} cost=${questionUsd.toFixed(4)}`,
  );
  if (capReached || (reply.mode === "guide_search" && reply.reason === "cost_cap")) break;
}

const summary = summarizeSupportGoldenRun(supportGoldenSet, results);
console.info(
  [
    `Support check on ${model.modelId}: ${summary.asked} of ${supportGoldenSet.length} questions asked.`,
    `Answered correctly: ${summary.counts.answered_correctly} of ${summary.answerable} answerable.`,
    `Refused correctly: ${summary.counts.refused_correctly} of ${summary.refusals} refusals.`,
    `Wrong source: ${summary.counts.wrong_source}. Should have refused: ${summary.counts.should_have_refused}. Refused an answerable question: ${summary.counts.refused_answerable}. Asked for a person: ${summary.counts.needs_person}. Fell back to search: ${summary.counts.fell_back}.`,
    `Spent US$${summary.totalUsd.toFixed(4)} of a US$${capUsd} cap; US$${summary.usdPerAnswer?.toFixed(4) ?? "n/a"} per answer.`,
  ].join("\n"),
);
// A check where the model never answered says nothing about the answers, so the job fails.
if (summary.counts.fell_back === summary.asked) process.exitCode = 1;
