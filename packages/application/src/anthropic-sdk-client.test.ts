import { APIUserAbortError, type ClientOptions } from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { describe, expect, it, vi } from "vitest";
import { createAnthropicSdkClient } from "./anthropic-sdk-client.js";

const parameters: MessageCreateParamsNonStreaming = {
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 32_768,
  system: "Keep the approved system prompt unchanged.",
  messages: [{ role: "user", content: "Keep the approved input unchanged." }],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
        additionalProperties: false,
      },
    },
  },
};

function eventStream(events: readonly object[]): Response {
  const body = events
    .map((event) => {
      const value = event as { readonly type: string };
      return `event: ${value.type}\ndata: ${JSON.stringify(event)}\n\n`;
    })
    .join("");

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "request-id": "req_stream_123",
    },
  });
}

function completedMessageEvents() {
  return [
    {
      type: "message_start",
      message: {
        id: "msg_stream_123",
        type: "message",
        role: "assistant",
        content: [],
        model: parameters.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 17, output_tokens: 1 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: '{"answer":"streamed"}' },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 23 },
    },
    { type: "message_stop" },
  ];
}

describe("Anthropic SDK streaming client", () => {
  it("streams the configured request and assembles the final message and request ID", async () => {
    const fetchRequests: { readonly body: unknown; readonly signal?: AbortSignal }[] = [];
    const fetch: NonNullable<ClientOptions["fetch"]> = async (_input, init) => {
      fetchRequests.push({
        body: JSON.parse(String(init?.body)) as unknown,
        ...(init?.signal == null ? {} : { signal: init.signal }),
      });
      return eventStream(completedMessageEvents());
    };
    const client = createAnthropicSdkClient("test-key", { fetch });

    const responsePromise = client.messages.create(parameters);
    const response = await responsePromise.withResponse?.();

    expect(fetchRequests).toHaveLength(1);
    expect(fetchRequests[0]?.body).toEqual({ ...parameters, stream: true });
    expect(response?.request_id).toBe("req_stream_123");
    expect(response?.data).toMatchObject({
      id: "msg_stream_123",
      model: parameters.model,
      stop_reason: "end_turn",
      content: [{ type: "text", text: '{"answer":"streamed"}' }],
      usage: { input_tokens: 17, output_tokens: 23 },
    });
    expect(await responsePromise).toEqual(response?.data);
  });

  it("preserves cancellation through the SDK stream", async () => {
    let fetchSignal: AbortSignal | undefined;
    const fetchStarted = Promise.withResolvers<void>();
    const fetch: NonNullable<ClientOptions["fetch"]> = async (_input, init) => {
      fetchSignal = init?.signal ?? undefined;
      fetchStarted.resolve();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `event: message_start\ndata: ${JSON.stringify(completedMessageEvents()[0])}\n\n`,
              ),
            );
            fetchSignal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("The operation was aborted.", "AbortError")),
              { once: true },
            );
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    };
    const client = createAnthropicSdkClient("test-key", { fetch });
    const controller = new AbortController();
    const responsePromise = client.messages.create(parameters, { signal: controller.signal });

    await fetchStarted.promise;
    controller.abort();

    await expect(responsePromise).rejects.toBeInstanceOf(APIUserAbortError);
    expect(fetchSignal?.aborted).toBe(true);
  });

  it("preserves API status errors and disables SDK retries", async () => {
    const fetch = vi.fn<NonNullable<ClientOptions["fetch"]>>(
      async () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: { type: "rate_limit_error", message: "Request rate limited." },
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "request-id": "req_rate_limited",
            },
          },
        ),
    );
    const client = createAnthropicSdkClient("test-key", { fetch });

    await expect(client.messages.create(parameters)).rejects.toMatchObject({
      status: 429,
      requestID: "req_rate_limited",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
