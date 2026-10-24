import type { ModelSelection } from "@draft-loop/domain";

import type { createVertexAnthropicClient } from "./vertex-client.js";

/** Synthetic requests and a scripted Vertex AI endpoint, shared by the gateway's tests. */
export const model: ModelSelection = {
  company: "anthropic",
  modelId: "claude-sonnet-5-5",
  role: "author",
  promptTemplateVersion: "author-v1",
};

const policy = {
  allowTransmission: true,
  allowedCompanies: ["anthropic", "openai"],
  sensitiveData: false,
  sensitiveDataAcknowledged: false,
} as const;

const schema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
} as const;

export const request = {
  contextSnapshotId: "snapshot-1",
  model,
  systemPrompt: "Return the requested data as JSON.",
  input: { question: "What is the answer?" },
  outputSchema: schema,
  outputName: "answer_schema",
  dataPolicy: policy,
};

/** A streamed Messages response, as Vertex AI sends it from `streamRawPredict`. */
export function streamedMessage(modelId: string, text = '{"answer":"yes"}'): string {
  const events: [string, unknown][] = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg-1",
          type: "message",
          role: "assistant",
          model: modelId,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 0 },
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
        delta: { type: "text_delta", text },
      },
    ],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 500 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  ];
  return events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

/** A Google auth client that hands out a fixed token, standing in for the runtime identity. */
export const auth = {
  authClient: {
    projectId: "synthetic-project",
    getRequestHeaders: async () => new Headers({ authorization: "Bearer synthetic-token" }),
  } as unknown as NonNullable<
    Parameters<typeof createVertexAnthropicClient>[0]["auth"]
  >["authClient"],
};

/**
 * Vertex AI answering every call with `status`: a streamed message of `reply` on 200, an error
 * otherwise. The reply defaults to the Sonnet answer the author tests expect.
 */
export function scriptedVertex(
  status = 200,
  reply: { readonly modelId: string; readonly text: string } = {
    modelId: "claude-sonnet-5-5",
    text: '{"answer":"yes"}',
  },
) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, headers: new Headers(init?.headers), body });
    if (status !== 200) {
      return new Response(JSON.stringify({ error: { code: status, message: "Not offered." } }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(streamedMessage(reply.modelId, reply.text), {
      status: 200,
      headers: { "content-type": "text/event-stream", "request-id": "vertex-request-1" },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
}
