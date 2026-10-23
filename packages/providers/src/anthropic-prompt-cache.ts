import type {
  MessageCreateParamsNonStreaming,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { JsonValue, ModelRequest } from "./index.js";

type PromptLayout = Pick<MessageCreateParamsNonStreaming, "system" | "messages">;

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The system prompt and user message of a Claude request.
 *
 * Without a cache layout, the request goes as it always has: the system prompt, then the input as
 * one JSON message. With one, the run-stable system instructions come first, then the run-stable
 * input members as one JSON block carrying the request's only cache breakpoint, with a one-hour
 * lifetime so later author calls of the run read it from the cache. The call's own instructions
 * and the rest of the input follow the breakpoint; the words sent are the same either way.
 */
export function anthropicPromptLayout(
  request: Pick<ModelRequest, "systemPrompt" | "input" | "promptCache">,
  serialize: (value: JsonValue) => string,
): PromptLayout {
  const { promptCache, input } = request;
  if (
    promptCache === undefined ||
    !isJsonObject(input) ||
    promptCache.stableInputMembers < 1 ||
    promptCache.stableInputMembers > Object.keys(input).length
  ) {
    return {
      system: request.systemPrompt,
      messages: [{ role: "user", content: serialize(input) }],
    };
  }
  const entries = Object.entries(input);
  const stable = Object.fromEntries(entries.slice(0, promptCache.stableInputMembers));
  const perCall = Object.fromEntries(entries.slice(promptCache.stableInputMembers));
  const content: TextBlockParam[] = [
    {
      type: "text",
      text: serialize(stable),
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ];
  if (promptCache.callInstructions.trim() !== "") {
    content.push({ type: "text", text: promptCache.callInstructions });
  }
  if (Object.keys(perCall).length > 0) content.push({ type: "text", text: serialize(perCall) });
  return { system: promptCache.systemPrompt, messages: [{ role: "user", content }] };
}
