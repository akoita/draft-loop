import type { ModelSelection } from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import { anthropicPromptLayout } from "./anthropic-prompt-cache.js";
import {
  AnthropicAdapter,
  type AnthropicClient,
  type ModelRequest,
  type PromptCacheLayout,
} from "./index.js";

type Params = Parameters<AnthropicClient["messages"]["create"]>[0];

const model: ModelSelection = {
  company: "anthropic",
  modelId: "claude-test-exact",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const input = {
  context: { role: "Platform engineer" },
  retrievedEvidence: [{ id: "e1" }],
  round: 2,
  findings: [],
};

const promptCache: PromptCacheLayout = {
  systemPrompt: "Write the CV.",
  callInstructions: " Revise the draft.",
  stableInputMembers: 2,
};

const cached: Pick<ModelRequest, "systemPrompt" | "input" | "promptCache"> = {
  systemPrompt: "Write the CV. Revise the draft.",
  input,
  promptCache,
};

describe("Anthropic prompt layout", () => {
  it("sends the request as before without a cache layout", () => {
    expect(anthropicPromptLayout({ systemPrompt: "Answer.", input }, JSON.stringify)).toEqual({
      system: "Answer.",
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });
  });

  it("puts the run-stable input first, behind one one-hour breakpoint, then the call's part", () => {
    expect(anthropicPromptLayout(cached, JSON.stringify)).toEqual({
      system: "Write the CV.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                context: input.context,
                retrievedEvidence: input.retrievedEvidence,
              }),
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
            { type: "text", text: " Revise the draft." },
            { type: "text", text: JSON.stringify({ round: 2, findings: [] }) },
          ],
        },
      ],
    });
  });

  it("leaves out empty call instructions", () => {
    const layout = anthropicPromptLayout(
      { ...cached, promptCache: { ...promptCache, callInstructions: "" } },
      JSON.stringify,
    );

    expect(layout.messages[0]?.content).toHaveLength(2);
  });

  it.each([
    ["input that is not an object", { ...cached, input: ["a"] }],
    ["no stable member", { ...cached, promptCache: { ...promptCache, stableInputMembers: 0 } }],
    [
      "more stable members than the input has",
      { ...cached, promptCache: { ...promptCache, stableInputMembers: 5 } },
    ],
  ])("falls back to the plain layout for %s", (_name, request) => {
    expect(anthropicPromptLayout(request, JSON.stringify).system).toBe(request.systemPrompt);
  });

  it("carries the breakpoint on the Vertex AI route", async () => {
    const response = {
      id: "msg-1",
      content: [{ type: "text", text: '{"answer":"yes"}' }],
      model: model.modelId,
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    let seen: Params | undefined;
    const client: AnthropicClient = {
      messages: {
        create: (params: Params) => {
          seen = params;
          return Object.assign(Promise.resolve(response), {
            withResponse: async () => ({ data: response, request_id: "vertex-request-1" }),
          }) as ReturnType<AnthropicClient["messages"]["create"]>;
        },
      },
    };
    const adapter = new AnthropicAdapter(client, { configuredModel: model, route: "vertex-ai" });

    await adapter.execute({
      ...cached,
      contextSnapshotId: "snapshot-1",
      model,
      outputSchema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
      outputName: "answer_schema",
      dataPolicy: {
        allowTransmission: true,
        allowedCompanies: ["anthropic"],
        sensitiveData: false,
        sensitiveDataAcknowledged: false,
      },
    });

    const breakpoints = JSON.stringify(seen).match(/"cache_control"/gu) ?? [];
    expect(breakpoints).toHaveLength(1);
    expect(seen?.system).toBe("Write the CV.");
  });
});
