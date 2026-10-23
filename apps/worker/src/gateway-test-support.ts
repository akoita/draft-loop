import type { OpenAIClient } from "@draft-loop/providers";

import type { ModelRouteDependencies } from "./model-routes.js";

/**
 * Scripted Vertex AI and OpenAI EU endpoints for the worker's tests: each answers a run's calls
 * with schema-valid synthetic outputs that cite the evidence the request sent, and counts tokens
 * per call so a test can price them. Nothing here reaches the network.
 */
export const scriptedUsage = {
  vertex: { inputTokens: 1000, outputTokens: 500 },
  openai: { inputTokens: 100, outputTokens: 10 },
} as const;

interface ScriptedInput {
  readonly retrievedEvidence?: readonly { readonly id?: unknown }[];
}

/** The first evidence id a request sent, under the alias the model sees. */
function evidenceId(input: ScriptedInput): string {
  const id = input.retrievedEvidence?.[0]?.id;
  if (typeof id !== "string") throw new Error("The scripted call received no evidence.");
  return id;
}

function applicationPlan(evidence: string) {
  const theme = (title: string) => ({
    title,
    rationale: "The job centres on it.",
    requirementIds: ["typescript-services"],
    evidenceChunkIds: [evidence],
    gap: false,
  });
  return {
    themes: [theme("TypeScript services"), theme("Deterministic testing"), theme("Platform")],
    leads: {
      summaryAngle: "Lead with TypeScript services built with deterministic testing.",
      coreAreas: [
        { text: "TypeScript services", themeRank: 1 },
        { text: "Deterministic testing", themeRank: 2 },
        { text: "Platform engineering", themeRank: 3 },
      ],
    },
    cuts: [],
  };
}

function draft(evidence: string) {
  const block = (type: "paragraph" | "bullet", text: string) => ({
    type,
    text,
    claims: [{ text, substantive: true, evidenceChunkIds: [evidence] }],
  });
  return {
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [block("paragraph", "Platform engineer building TypeScript services.")],
      },
      {
        title: "Experience",
        kind: "experience",
        blocks: [block("bullet", "Built TypeScript services with deterministic testing.")],
      },
      {
        title: "Education",
        kind: "education",
        blocks: [{ type: "bullet", text: "Education information unavailable", claims: [] }],
      },
      {
        title: "Skills",
        kind: "skills",
        blocks: [block("bullet", "TypeScript services and deterministic testing.")],
      },
    ],
  };
}

/** A streamed Messages response, as Vertex AI sends it from `streamRawPredict`. */
function vertexStream(modelId: string, output: unknown): string {
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg-scripted",
          type: "message",
          role: "assistant",
          model: modelId,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: scriptedUsage.vertex.inputTokens, output_tokens: 0 },
        },
      },
    ],
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ],
    [
      "content_block_delta",
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: JSON.stringify(output) },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: scriptedUsage.vertex.outputTokens },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** The author's calls on Vertex AI: the application plan, then the draft. */
function scriptedVertexFetch(urls: string[], bodies: string[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    urls.push(url);
    bodies.push(String(init?.body));
    const body = JSON.parse(String(init?.body)) as {
      readonly messages: readonly {
        readonly content: string | readonly { readonly text: string }[];
      }[];
      readonly output_config?: unknown;
    };
    // A cached draft request leads with the run-stable input, which holds the evidence.
    const content = body.messages[0]?.content;
    const text = typeof content === "string" ? content : content?.[0]?.text;
    const request = JSON.parse(text ?? "{}") as ScriptedInput;
    const plans = JSON.stringify(body.output_config).includes('"themes"');
    const output = plans ? applicationPlan(evidenceId(request)) : draft(evidenceId(request));
    const modelId = /models\/([^:]+):/u.exec(url)?.[1] ?? "unknown";
    return new Response(vertexStream(modelId, output), {
      status: 200,
      headers: { "content-type": "text/event-stream", "request-id": "vertex-scripted" },
    });
  }) as typeof fetch;
}

type ResponseParams = Parameters<OpenAIClient["responses"]["create"]>[0];

/** The critic's calls on OpenAI's EU endpoint: the plan review, then the critique. */
function scriptedOpenAiClient(names: string[], bodies: string[]): OpenAIClient {
  return {
    responses: {
      create: async (params: ResponseParams) => {
        bodies.push(JSON.stringify(params));
        const format = (params as { readonly text?: { readonly format?: unknown } }).text?.format;
        const { name, schema } = format as { readonly name: string; readonly schema: unknown };
        names.push(name);
        const output =
          name === "application_plan_review"
            ? { verdict: "accept", points: [] }
            : {
                findings: [],
                ...(JSON.stringify(schema).includes('"coverageJudgements"')
                  ? { coverageJudgements: [] }
                  : {}),
              };
        return {
          id: "openai-scripted",
          model: params.model,
          output_text: JSON.stringify(output),
          usage: {
            input_tokens: scriptedUsage.openai.inputTokens,
            output_tokens: scriptedUsage.openai.outputTokens,
            total_tokens: scriptedUsage.openai.inputTokens + scriptedUsage.openai.outputTokens,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
          _request_id: "openai-scripted",
        } as never;
      },
    },
  } as unknown as OpenAIClient;
}

/** Route dependencies whose Vertex AI, OpenAI and Secret Manager are all scripted. */
export function scriptedGateway(openAiKeySecret: string) {
  const vertexUrls: string[] = [];
  /** Every request body the run sent, so a test can check what reached a provider. */
  const requestBodies: string[] = [];
  const openAiOutputs: string[] = [];
  const openAiKeys: string[] = [];
  const dependencies: ModelRouteDependencies = {
    secrets: {
      accessSecretVersion: async ({ name }: { readonly name: string }) => [
        { payload: { data: name === openAiKeySecret ? "synthetic-openai-key" : null } },
      ],
    } as never,
    vertex: {
      auth: {
        authClient: {
          projectId: "synthetic-project",
          getRequestHeaders: async () => new Headers({ authorization: "Bearer synthetic-token" }),
        },
      } as never,
      fetch: scriptedVertexFetch(vertexUrls, requestBodies),
    },
    openAiClient: (apiKey) => {
      openAiKeys.push(apiKey);
      return scriptedOpenAiClient(openAiOutputs, requestBodies) as never;
    },
  };
  return { dependencies, vertexUrls, requestBodies, openAiOutputs, openAiKeys };
}
