import { describe, expect, it, vi } from "vitest";

import {
  createLocalModelAdapter,
  type DataExposurePolicy,
  type ModelRequest,
  type ModelSelection,
  ProviderAdapterError,
} from "./index.js";

const sampleModel: ModelSelection = {
  company: "local",
  modelId: "llama3.2",
  role: "author",
  promptTemplateVersion: "1.0.0",
};

const allowedPolicy: DataExposurePolicy = {
  allowTransmission: true,
  allowedCompanies: ["local"],
  sensitiveData: false,
  sensitiveDataAcknowledged: false,
};

describe("LocalModelAdapter for Offline Inference", () => {
  it("executes structured JSON requests against local OpenAI-compatible endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "chatcmpl-local-123",
        choices: [
          {
            message: {
              content: JSON.stringify({
                sections: [{ title: "Summary", text: "Senior distributed systems engineer." }],
              }),
            },
          },
        ],
        usage: {
          prompt_tokens: 150,
          completion_tokens: 50,
          total_tokens: 200,
        },
      }),
    });

    const adapter = createLocalModelAdapter(
      {
        endpoint: "http://127.0.0.1:11434/v1",
        fetch: mockFetch as unknown as typeof fetch,
      },
      {
        configuredModel: sampleModel,
        pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
      },
    );

    const progressEvents: unknown[] = [];
    const controller = new AbortController();
    const request: ModelRequest<{ readonly target: string }> = {
      contextSnapshotId: "snap-local-1",
      model: sampleModel,
      systemPrompt: "You are an expert resume writer.",
      input: { target: "Staff Engineer" },
      outputSchema: { type: "object" },
      outputName: "draft",
      maxOutputTokens: 1234,
      dataPolicy: allowedPolicy,
      onProgress: (event) => progressEvents.push(event),
      signal: controller.signal,
    };

    const response = await adapter.execute(request);

    expect(response.provider).toBe("local");
    expect(response.company).toBe("local");
    expect(response.modelId).toBe("llama3.2");
    expect(response.providerRequestId).toBe("chatcmpl-local-123");
    expect(response.usage.totalTokens).toBe(200);
    expect(response.output).toEqual({
      sections: [{ title: "Summary", text: "Senior distributed systems engineer." }],
    });
    expect(progressEvents.length).toBeGreaterThanOrEqual(2);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
      }),
    );
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ max_tokens: 1234 });
  });

  it("enforces data exposure policy before reaching the local server", async () => {
    const mockFetch = vi.fn();
    const adapter = createLocalModelAdapter(
      { fetch: mockFetch as unknown as typeof fetch },
      { configuredModel: sampleModel },
    );

    const unapprovedPolicy: DataExposurePolicy = {
      allowTransmission: false,
      allowedCompanies: [],
      sensitiveData: false,
      sensitiveDataAcknowledged: false,
    };

    await expect(
      adapter.execute({
        contextSnapshotId: "snap-1",
        model: sampleModel,
        systemPrompt: "",
        input: {},
        outputSchema: {},
        outputName: "draft",
        dataPolicy: unapprovedPolicy,
      }),
    ).rejects.toThrow(ProviderAdapterError);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("normalizes HTTP error responses from local server", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    });

    const adapter = createLocalModelAdapter(
      { fetch: mockFetch as unknown as typeof fetch },
      {
        configuredModel: sampleModel,
        retry: { maxRetries: 0 },
      },
    );

    await expect(
      adapter.execute({
        contextSnapshotId: "snap-1",
        model: sampleModel,
        systemPrompt: "",
        input: {},
        outputSchema: {},
        outputName: "draft",
        dataPolicy: allowedPolicy,
      }),
    ).rejects.toThrow(ProviderAdapterError);
  });
});
