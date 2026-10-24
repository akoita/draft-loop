import type {
  ResponseCreateParamsNonStreaming,
  ResponseInputText,
} from "openai/resources/responses/responses.js";

import type { JsonValue, ModelRequest } from "./index.js";

type PromptLayout = Pick<
  ResponseCreateParamsNonStreaming,
  "instructions" | "input" | "prompt_cache_key" | "prompt_cache_options"
>;

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The instructions, input and prompt-cache settings of an OpenAI request.
 *
 * OpenAI's implicit cache writes a breakpoint at the end of every prompt, at a price above
 * uncached input, and a later call reads it only if it repeats that whole prompt. Calls of a run
 * differ after their shared prefix, so every request turns the implicit breakpoint off.
 *
 * - **Without a cache layout:** the request caches nothing and sends the system prompt and the
 *   input as one JSON message, as it always has.
 * - **With one:** the run-stable instructions come first, then the run-stable input members as
 *   one JSON part carrying the request's only breakpoint. The call's own instructions and the
 *   rest of the input follow it, and the run's context snapshot keys the cache, so later calls
 *   of the run read the prefix instead of writing it again.
 */
export function openAIPromptLayout(
  request: Pick<ModelRequest, "systemPrompt" | "input" | "promptCache" | "contextSnapshotId">,
  serialize: (value: JsonValue) => string,
): PromptLayout {
  const { promptCache, input } = request;
  const explicitOnly = { prompt_cache_options: { mode: "explicit" as const } };
  if (
    promptCache === undefined ||
    !isJsonObject(input) ||
    promptCache.stableInputMembers < 1 ||
    promptCache.stableInputMembers > Object.keys(input).length
  ) {
    return {
      instructions: request.systemPrompt,
      input: [{ role: "user", content: [{ type: "input_text", text: serialize(input) }] }],
      ...explicitOnly,
    };
  }
  const entries = Object.entries(input);
  const stable = Object.fromEntries(entries.slice(0, promptCache.stableInputMembers));
  const perCall = Object.fromEntries(entries.slice(promptCache.stableInputMembers));
  const content: ResponseInputText[] = [
    {
      type: "input_text",
      text: serialize(stable),
      prompt_cache_breakpoint: { mode: "explicit" },
    },
  ];
  if (promptCache.callInstructions.trim() !== "") {
    content.push({ type: "input_text", text: promptCache.callInstructions });
  }
  if (Object.keys(perCall).length > 0) {
    content.push({ type: "input_text", text: serialize(perCall) });
  }
  return {
    instructions: promptCache.systemPrompt,
    input: [{ role: "user", content }],
    prompt_cache_key: request.contextSnapshotId,
    ...explicitOnly,
  };
}
