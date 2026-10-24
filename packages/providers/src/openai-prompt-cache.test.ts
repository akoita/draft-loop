import { describe, expect, it } from "vitest";

import type { JsonValue, ModelRequest } from "./index.js";
import { openAIPromptLayout } from "./openai-prompt-cache.js";

const serialize = (value: JsonValue) => JSON.stringify(value);

const request = {
  contextSnapshotId: "context-1",
  systemPrompt: "Run instructions.\n\nCall instructions.",
  input: { context: { id: "context-1" }, evidence: ["a"], round: 2, artifact: { id: "draft" } },
} satisfies Pick<ModelRequest, "contextSnapshotId" | "systemPrompt" | "input">;

describe("OpenAI prompt layout", () => {
  it("sends a request without a layout as before, with the implicit cache off", () => {
    expect(openAIPromptLayout(request, serialize)).toEqual({
      instructions: request.systemPrompt,
      input: [{ role: "user", content: [{ type: "input_text", text: serialize(request.input) }] }],
      prompt_cache_options: { mode: "explicit" },
    });
  });

  it("puts the one breakpoint after the run-stable input and keys the cache on the run", () => {
    const layout = openAIPromptLayout(
      {
        ...request,
        promptCache: {
          systemPrompt: "Run instructions.",
          callInstructions: "Call instructions.",
          stableInputMembers: 2,
        },
      },
      serialize,
    );

    expect(layout).toEqual({
      instructions: "Run instructions.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: serialize({ context: { id: "context-1" }, evidence: ["a"] }),
              prompt_cache_breakpoint: { mode: "explicit" },
            },
            { type: "input_text", text: "Call instructions." },
            { type: "input_text", text: serialize({ round: 2, artifact: { id: "draft" } }) },
          ],
        },
      ],
      prompt_cache_key: "context-1",
      prompt_cache_options: { mode: "explicit" },
    });
  });

  it("leaves out empty call instructions and falls back when the layout does not fit", () => {
    const cached = openAIPromptLayout(
      {
        ...request,
        promptCache: { systemPrompt: "Run.", callInstructions: " ", stableInputMembers: 4 },
      },
      serialize,
    );
    expect(cached.input).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: serialize(request.input),
            prompt_cache_breakpoint: { mode: "explicit" },
          },
        ],
      },
    ]);

    const tooMany = openAIPromptLayout(
      {
        ...request,
        promptCache: { systemPrompt: "Run.", callInstructions: "", stableInputMembers: 5 },
      },
      serialize,
    );
    expect(tooMany.instructions).toBe(request.systemPrompt);
    expect(tooMany.prompt_cache_key).toBeUndefined();
  });
});
