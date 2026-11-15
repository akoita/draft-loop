// One-off live check for the Anthropic SDK 1.x update: one tiny Claude Haiku call on the
// direct Claude API and one on Vertex AI in the EU, each capped at 16 output tokens.
// Run from the repository root on a machine with ANTHROPIC_API_KEY and Google ADC:
//   DRAFT_LOOP_VERTEX_PROJECT=<staging project id> node scripts/anthropic-sdk-live-check.mjs
import console from "node:console";
import { createRequire } from "node:module";
import process from "node:process";
import { URL } from "node:url";

const require = createRequire(new URL("../packages/model-gateway/package.json", import.meta.url));
const { default: Anthropic } = await import(require.resolve("@anthropic-ai/sdk"));
const { AnthropicVertex } = await import(require.resolve("@anthropic-ai/vertex-sdk"));

const model = "claude-haiku-5-5";
const request = {
  model,
  max_tokens: 16,
  messages: [{ role: "user", content: "Reply with the single word: ready" }],
};

async function check(name, run) {
  try {
    const message = await run();
    const text = message.content
      .map((block) => block.text ?? "")
      .join("")
      .trim();
    console.log(
      `${name}: OK model=${message.model} stop=${message.stop_reason} text=${JSON.stringify(text)} usage=${JSON.stringify(message.usage)}`,
    );
    return true;
  } catch (error) {
    console.log(
      `${name}: FAILED status=${error?.status ?? "-"} ${String(error?.message ?? error).slice(0, 300)}`,
    );
    return false;
  }
}

const results = [];
if (process.env.ANTHROPIC_API_KEY) {
  results.push(await check("direct", () => new Anthropic().messages.create(request)));
} else {
  console.log("direct: SKIPPED (no ANTHROPIC_API_KEY)");
}
if (process.env.DRAFT_LOOP_VERTEX_PROJECT) {
  const vertex = new AnthropicVertex({
    projectId: process.env.DRAFT_LOOP_VERTEX_PROJECT,
    region: "eu",
    baseURL: "https://aiplatform.eu.rep.googleapis.com/v1",
    defaultHeaders: { "anthropic-version": "vertex-2023-10-16" },
  });
  results.push(await check("vertex-eu", () => vertex.messages.create(request)));
} else {
  console.log("vertex-eu: SKIPPED (no DRAFT_LOOP_VERTEX_PROJECT)");
}
process.exitCode = results.length > 0 && results.every(Boolean) ? 0 : 1;
