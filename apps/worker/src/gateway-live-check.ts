import process from "node:process";
import { type JsonObject, type ModelRequest, OpenAIAdapter } from "@draft-loop/providers";

import { readModelGatewayConfig, workerProviderOptions } from "./model-routes.js";

/**
 * A manual check for the owner: one Claude call on Vertex AI and one OpenAI EU call, with
 * synthetic data only, through the worker's own gateway settings. It never runs in CI, and it
 * prints routes, models, token counts and costs, never keys.
 */
const config = readModelGatewayConfig(process.env);
if (config === undefined) {
  console.error("Set the worker's DRAFT_LOOP_VERTEX_* and DRAFT_LOOP_OPENAI_KEY_SECRET settings.");
  process.exit(1);
}
const criticModel = process.env.DRAFT_LOOP_LIVE_CRITIC_MODEL ?? "";
if (criticModel === "") {
  console.error("Set DRAFT_LOOP_LIVE_CRITIC_MODEL to the OpenAI model the critic uses.");
  process.exit(1);
}
const authorModel = process.env.DRAFT_LOOP_LIVE_AUTHOR_MODEL ?? "claude-haiku-5-5";
const options = workerProviderOptions(config);

const request = (company: string, modelId: string, role: "author" | "critic") =>
  ({
    contextSnapshotId: "gateway-live-check",
    model: { company, modelId, role, promptTemplateVersion: "gateway-live-check-v1" },
    systemPrompt: "Answer with the requested JSON only.",
    input: { question: "Is a synthetic gateway check reaching you? Answer yes." },
    outputSchema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
    outputName: "gateway_check",
    dataPolicy: {
      allowTransmission: true,
      allowedCompanies: [company],
      sensitiveData: false,
      sensitiveDataAcknowledged: false,
    },
  }) satisfies ModelRequest<JsonObject>;

const author = request("anthropic", authorModel, "author");
const authorRoute = options.providerClientFactories?.anthropicRoute?.({
  configuredModel: author.model,
});
const openAiKey = await options.resolveCredential?.("openai");
const openAiClient = options.providerClientFactories?.openai;
if (authorRoute === undefined || openAiKey === undefined || openAiClient === undefined) {
  console.error("The gateway is not fully configured: the OpenAI key could not be resolved.");
  process.exit(1);
}
const critic = request("openai", criticModel, "critic");
const criticAdapter = new OpenAIAdapter<JsonObject, JsonObject>(openAiClient(openAiKey), {
  configuredModel: critic.model,
  retry: { maxRetries: 0 },
});

for (const [step, call] of [
  ["author", () => authorRoute.execute(author)],
  ["critic", () => criticAdapter.execute(critic)],
] as const) {
  const response = await call();
  console.info(
    `${step}: route=${response.route} model=${response.modelId} input=${response.usage.inputTokens} output=${response.usage.outputTokens} cost=${response.cost.estimatedUsd ?? "unpriced"}`,
  );
}
