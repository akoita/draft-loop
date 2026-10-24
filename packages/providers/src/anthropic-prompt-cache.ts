import type {
  MessageCreateParamsNonStreaming,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages/messages.js";

import type { JsonSchema, JsonValue, ModelRequest } from "./index.js";

type PromptLayout = Pick<MessageCreateParamsNonStreaming, "system" | "messages">;

function isJsonObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether the request's layout splits its input at a cache breakpoint. */
function cachesInput(request: Pick<ModelRequest, "input" | "promptCache">): boolean {
  const { promptCache, input } = request;
  return (
    promptCache !== undefined &&
    isJsonObject(input) &&
    promptCache.stableInputMembers >= 1 &&
    promptCache.stableInputMembers <= Object.keys(input).length
  );
}

/** The output names a cached request shares one format with, when it names its own among them. */
function sharedOutputNames(
  request: Pick<ModelRequest, "input" | "promptCache" | "outputName">,
): readonly string[] | undefined {
  const schemas = request.promptCache?.outputSchemas;
  if (schemas === undefined || !cachesInput(request) || !(request.outputName in schemas)) {
    return undefined;
  }
  return Object.keys(schemas).sort();
}

function sharedOutputInstructions(
  request: Pick<ModelRequest, "input" | "promptCache" | "outputName">,
): string {
  return sharedOutputNames(request) === undefined
    ? ""
    : ` Return only the "${request.outputName}" member of the output object; its other members are the outputs of other calls of this run.`;
}

/**
 * The one output format every call sharing a cached prefix sends, and how to read this call's
 * output from it. Claude's prompt cache keys on the output format, so calls that asked for
 * their own formats would each write the prefix again instead of reading it. The format allows
 * exactly one member, named by output name; the call's instructions say which one to return.
 */
export function anthropicSharedOutput(
  request: Pick<ModelRequest, "input" | "promptCache" | "outputName">,
):
  | { readonly schema: JsonSchema; readonly read: (output: JsonValue) => JsonValue | undefined }
  | undefined {
  const names = sharedOutputNames(request);
  const schemas = request.promptCache?.outputSchemas;
  if (names === undefined || schemas === undefined) return undefined;
  return {
    schema: {
      type: "object",
      properties: {
        output: {
          anyOf: names.map((name) => ({
            type: "object",
            properties: { [name]: schemas[name] as JsonSchema },
            required: [name],
            additionalProperties: false,
          })),
        },
      },
      required: ["output"],
      additionalProperties: false,
    },
    read: (output) => {
      if (!isJsonObject(output) || !isJsonObject(output.output as JsonValue)) return undefined;
      const member = (output.output as { readonly [key: string]: JsonValue })[request.outputName];
      return member;
    },
  };
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
  request: Pick<ModelRequest, "systemPrompt" | "input" | "promptCache" | "outputName">,
  serialize: (value: JsonValue) => string,
): PromptLayout {
  const { promptCache, input } = request;
  if (promptCache === undefined || !isJsonObject(input) || !cachesInput(request)) {
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
  const callInstructions = `${promptCache.callInstructions}${sharedOutputInstructions(request)}`;
  if (callInstructions.trim() !== "") content.push({ type: "text", text: callInstructions });
  if (Object.keys(perCall).length > 0) content.push({ type: "text", text: serialize(perCall) });
  return { system: promptCache.systemPrompt, messages: [{ role: "user", content }] };
}
