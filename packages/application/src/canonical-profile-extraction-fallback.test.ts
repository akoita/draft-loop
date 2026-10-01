import { maximumCanonicalCandidateProfileFactCount } from "@draft-loop/domain";
import { type JsonObject, type ModelRequest, ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it, vi } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  type CanonicalCandidateProfileExtractionRequest,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";
import {
  type CanonicalProfileExtractionExecutor,
  executeCanonicalProfileExtractionWithFallback,
} from "./canonical-profile-extraction-fallback.js";

const dataPolicy = {
  allowTransmission: true,
  allowedCompanies: ["anthropic"],
  sensitiveData: true,
  sensitiveDataAcknowledged: true,
} as const;
const model: ModelRequest<JsonObject>["model"] = {
  company: "anthropic",
  modelId: "claude-sonnet-5-5",
  role: "author",
  promptTemplateVersion: "fallback-test-v1",
};
const controls = {
  model,
  systemPrompt: "Original extraction prompt.",
  maxOutputTokens: 8192,
  dataPolicy,
};

function source(id: string, text: string) {
  return { id, mediaType: "text/plain", checksum: "a".repeat(64), text };
}

function material(id: string, text: string, versionId = `version-${id}`) {
  return {
    ...source(id, text),
    reference: {
      storeId: `store-${id}`,
      knowledgeBaseId: `knowledge-${id}`,
      sourceId: `document-${id}`,
      versionId,
      kind: "candidate-provided" as const,
    },
  };
}

function request(
  sources: readonly ReturnType<typeof source>[],
): CanonicalCandidateProfileExtractionRequest {
  return { operationId: "fallback-operation", sources };
}

function input(sources: readonly ReturnType<typeof material>[], signal?: AbortSignal) {
  return {
    operationId: "fallback-operation",
    sources,
    allowProviderData: true,
    ...(signal === undefined ? {} : { signal }),
  } satisfies CanonicalCandidateProfileExtractionInput;
}

function providerTruncation(): ProviderAdapterError {
  return new ProviderAdapterError("anthropic", "invalid-response", "private stop detail", {
    retryable: false,
    diagnostics: [{ code: "max_tokens", path: "stop_reason" }],
  });
}

function proposal(
  facts: readonly {
    readonly key: string;
    readonly category: string;
    readonly field: string;
    readonly value: string;
    readonly sourceId: string;
    readonly quote: string;
  }[],
  issues: readonly {
    readonly code: string;
    readonly factKeys: readonly string[];
    readonly sourceIds: readonly string[];
  }[] = [],
): JsonObject {
  return {
    schemaVersion: 1,
    facts: facts.map(({ sourceId, quote, ...fact }) => ({
      ...fact,
      evidence: [{ sourceId, quote }],
    })),
    issues: issues.map((issue) => ({ ...issue })),
  };
}

function executorFor(
  execute: (request: ModelRequest<JsonObject>) => Promise<JsonObject> | JsonObject,
) {
  const executeMock = vi.fn(async (request: ModelRequest<JsonObject>) => ({
    output: await execute(request),
  }));
  return {
    calls: executeMock.mock.calls,
    executor: {
      execute: executeMock as unknown as CanonicalProfileExtractionExecutor["execute"],
    } satisfies CanonicalProfileExtractionExecutor,
  };
}

function requestSources(call: ModelRequest<JsonObject>) {
  return call.input.sources as readonly { readonly id: string; readonly text: string }[];
}

describe("canonical profile extraction output-limit fallback", () => {
  it("returns a successful initial output unchanged with one request", async () => {
    const output = { applicationPayload: "kept as returned" };
    const { calls, executor } = executorFor(() => output);
    const result = await executeCanonicalProfileExtractionWithFallback(
      executor,
      request([source("source-a", "TypeScript")]),
      controls,
    );

    expect(result).toBe(output);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toMatchObject({
      contextSnapshotId: "fallback-operation",
      systemPrompt: controls.systemPrompt,
      input: { sources: [source("source-a", "TypeScript")] },
      outputName: "canonical_candidate_profile_extraction",
      maxOutputTokens: controls.maxOutputTokens,
      dataPolicy,
    });
  });

  it("focuses each source with the full context and rebases reused keys and issue links", async () => {
    const first = material("source-a", "TypeScript; Northwind");
    const second = material("source-b", "React; Acme");
    const { calls, executor } = executorFor(async (call) => {
      if (calls.length === 1) throw providerTruncation();
      const focusSourceId = call.input.extractionFocusSourceId;
      expect(requestSources(call)).toEqual([
        { id: first.id, mediaType: first.mediaType, checksum: first.checksum, text: first.text },
        {
          id: second.id,
          mediaType: second.mediaType,
          checksum: second.checksum,
          text: second.text,
        },
      ]);
      expect(call.systemPrompt).toContain("bounded focused extraction call");
      expect(call.systemPrompt).toContain(
        "Use concise exact contiguous evidence quotes containing the entire fact value",
      );
      expect(call.maxOutputTokens).toBe(controls.maxOutputTokens);
      expect(call.dataPolicy).toEqual(dataPolicy);
      if (focusSourceId === first.id) {
        return proposal([
          {
            key: "reused-key",
            category: "skill",
            field: "name",
            value: "TypeScript",
            sourceId: first.id,
            quote: "TypeScript",
          },
        ]);
      }
      expect(focusSourceId).toBe(second.id);
      return proposal(
        [
          {
            key: "reused-key",
            category: "employer",
            field: "name",
            value: "Acme",
            sourceId: second.id,
            quote: "Acme",
          },
          {
            key: "counterfact",
            category: "employer",
            field: "name",
            value: "Northwind",
            sourceId: first.id,
            quote: "Northwind",
          },
        ],
        [
          {
            code: "conflict-value",
            factKeys: ["reused-key", "counterfact"],
            sourceIds: [first.id, second.id],
          },
        ],
      );
    });

    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: (preparedRequest) =>
          executeCanonicalProfileExtractionWithFallback(executor, preparedRequest, controls),
      },
      input([first, second]),
    );

    expect(calls).toHaveLength(3);
    expect(calls[0]?.[0].input.extractionFocusSourceId).toBeUndefined();
    expect(calls[1]?.[0].input.extractionFocusSourceId).toBe(first.id);
    expect(calls[2]?.[0].input.extractionFocusSourceId).toBe(second.id);
    expect(result.facts).toHaveLength(3);
    expect(result.facts.map((fact) => fact.value)).toEqual(["TypeScript", "Acme", "Northwind"]);
    const conflict = result.issues.find((issue) => issue.code === "conflict-value");
    expect(conflict?.factIds).toHaveLength(2);
    expect(conflict?.factIds.every((id) => result.facts.some((fact) => fact.id === id))).toBe(true);
    expect(conflict?.sourceRefs).toEqual([first.reference, second.reference]);
    expect(result.facts.find((fact) => fact.value === "Acme")?.provenance).toEqual([
      second.reference,
    ]);
    expect(result.facts.find((fact) => fact.value === "Northwind")?.provenance).toEqual([
      first.reference,
    ]);
  });

  it("does not focus one or more than four unique sources", async () => {
    for (const sources of [
      [source("source-a", "A")],
      [
        source("source-a", "A"),
        source("source-b", "B"),
        source("source-c", "C"),
        source("source-d", "D"),
        source("source-e", "E"),
      ],
    ]) {
      const truncation = providerTruncation();
      const { calls, executor } = executorFor(() => Promise.reject(truncation));
      await expect(
        executeCanonicalProfileExtractionWithFallback(executor, request(sources), controls),
      ).rejects.toBe(truncation);
      expect(calls).toHaveLength(1);
    }
  });

  it("does not retry a provider failure that is unrelated to output truncation", async () => {
    const failure = new ProviderAdapterError("anthropic", "permission", "private detail");
    const { calls, executor } = executorFor(() => Promise.reject(failure));

    await expect(
      executeCanonicalProfileExtractionWithFallback(
        executor,
        request([source("source-a", "A"), source("source-b", "B")]),
        controls,
      ),
    ).rejects.toBe(failure);
    expect(calls).toHaveLength(1);
  });

  it("bounds four-source recovery to five total calls", async () => {
    const sources = ["A", "B", "C", "D"].map((value, index) =>
      material(`source-${index + 1}`, `Skill ${value}`),
    );
    const { calls, executor } = executorFor((call) => {
      if (calls.length === 1) throw providerTruncation();
      const focusedSourceId = call.input.extractionFocusSourceId as string;
      const focusedSource = sources.find((item) => item.id === focusedSourceId);
      expect(focusedSource).toBeDefined();
      expect(requestSources(call)).toHaveLength(4);
      expect(call.maxOutputTokens).toBe(controls.maxOutputTokens);
      const value = focusedSource?.text.slice("Skill ".length) ?? "";
      return proposal([
        {
          key: "same-provider-key",
          category: "skill",
          field: "name",
          value,
          sourceId: focusedSourceId,
          quote: value,
        },
      ]);
    });
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: (preparedRequest) =>
          executeCanonicalProfileExtractionWithFallback(executor, preparedRequest, controls),
      },
      input(sources),
    );

    expect(calls).toHaveLength(5);
    expect(result.facts.map((fact) => fact.value)).toEqual(["A", "B", "C", "D"]);
  });

  it.each([
    ["batch truncation", () => providerTruncation(), "output limit"],
    [
      "non-budget provider error",
      () => new ProviderAdapterError("anthropic", "permission", "private permission detail"),
      "account permissions",
    ],
  ])("stops after a %s without returning partial facts", async (_label, makeError, messagePart) => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "React");
    const { calls, executor } = executorFor(() => {
      if (calls.length === 1) throw providerTruncation();
      throw makeError();
    });
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: (preparedRequest) =>
          executeCanonicalProfileExtractionWithFallback(executor, preparedRequest, controls),
      },
      input([first, second]),
    );

    expect(calls).toHaveLength(2);
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain(messagePart);
    expect(result.issues[0]?.sourceRefs).toEqual([first.reference, second.reference]);
    expect(JSON.stringify(result)).not.toMatch(/private permission detail|private stop detail/u);
  });

  it("fails closed when a focused batch does not match the proposal schema", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "React");
    const { calls, executor } = executorFor(() => {
      if (calls.length === 1) throw providerTruncation();
      return { schemaVersion: 1, facts: [{ key: "malformed" }], issues: [] };
    });
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: (preparedRequest) =>
          executeCanonicalProfileExtractionWithFallback(executor, preparedRequest, controls),
      },
      input([first, second]),
    );

    expect(calls).toHaveLength(2);
    expect(result.facts).toEqual([]);
    expect(result.issues[0]?.message).toBe(
      "The provider response did not match the required candidate profile format. Retry or check the configured model.",
    );
  });

  it("saves no partial facts when completed batches fail source grounding", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "React");
    const { calls, executor } = executorFor((call) => {
      if (calls.length === 1) throw providerTruncation();
      if (call.input.extractionFocusSourceId === first.id) {
        return proposal([
          {
            key: "first-fact",
            category: "skill",
            field: "name",
            value: "TypeScript",
            sourceId: first.id,
            quote: "TypeScript",
          },
        ]);
      }
      return proposal([
        {
          key: "ungrounded-fact",
          category: "skill",
          field: "name",
          value: "React",
          sourceId: second.id,
          quote: "React and unsupported claim",
        },
      ]);
    });
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: (preparedRequest) =>
          executeCanonicalProfileExtractionWithFallback(executor, preparedRequest, controls),
      },
      input([first, second]),
    );

    expect(calls).toHaveLength(3);
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain("could not be grounded");
  });

  it("stops before the next batch when the request is cancelled", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "React");
    const controller = new AbortController();
    const { calls, executor } = executorFor(() => {
      if (calls.length === 1) throw providerTruncation();
      controller.abort();
      return proposal([
        {
          key: "skill",
          category: "skill",
          field: "name",
          value: "TypeScript",
          sourceId: first.id,
          quote: "TypeScript",
        },
      ]);
    });

    await expect(
      processCanonicalCandidateProfileExtraction(
        {
          extract: (preparedRequest) =>
            executeCanonicalProfileExtractionWithFallback(executor, preparedRequest, controls),
        },
        input([first, second], controller.signal),
      ),
    ).rejects.toThrow();
    expect(calls).toHaveLength(2);
  });

  it("rejects an aggregate that exceeds the existing fact-count bound", async () => {
    const first = source("source-a", "Claim");
    const second = source("source-b", "Claim");
    const manyFacts = (sourceId: string) =>
      proposal(
        Array.from({ length: maximumCanonicalCandidateProfileFactCount }, (_, index) => ({
          key: `fact-${index + 1}`,
          category: "skill",
          field: "name",
          value: "Claim",
          sourceId,
          quote: "Claim",
        })),
      );
    const { calls, executor } = executorFor(() => {
      if (calls.length === 1) throw providerTruncation();
      return calls.length === 2 ? manyFacts(first.id) : manyFacts(second.id);
    });

    await expect(
      executeCanonicalProfileExtractionWithFallback(executor, request([first, second]), controls),
    ).rejects.toMatchObject({
      code: "invalid-response",
      failureStage: "response-schema-validation",
      diagnostics: [{ code: "invalid_profile_extraction_batch", path: "output" }],
    });
    expect(calls).toHaveLength(3);
  });
});
