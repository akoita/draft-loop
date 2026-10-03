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
import { planCanonicalProfileExtractionTextWindows } from "./canonical-profile-extraction-sections.js";

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
    readonly subjectKey?: string;
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

  it("normalizes redundant focused evidence without extra requests or fact loss", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "React");
    const { calls, executor } = executorFor((call) => {
      if (calls.length === 1) throw providerTruncation();
      const selected = call.input.extractionFocusSourceId === first.id ? first : second;
      const value = selected === first ? "TypeScript" : "React";
      return {
        schemaVersion: 1,
        facts: [
          {
            key: `skill-${selected.id}`,
            category: "skill",
            field: "name",
            value,
            evidence: [
              { sourceId: selected.id, quote: value },
              { sourceId: selected.id, quote: value },
            ],
          },
        ],
        issues: [],
      };
    });

    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: (preparedRequest) =>
          executeCanonicalProfileExtractionWithFallback(executor, preparedRequest, controls),
      },
      input([first, second]),
    );

    expect(calls).toHaveLength(3);
    expect(result.facts.map((fact) => fact.value)).toEqual(["TypeScript", "React"]);
    expect(result.facts[0]?.provenance).toEqual([first.reference]);
    expect(result.facts[1]?.provenance).toEqual([second.reference]);
  });

  it("recovers a truncating focused source in four windows and retains full-source grounding", async () => {
    const first = material("source-a", "TypeScript\nReact\nPython\nPostgreSQL\n");
    const second = material("source-b", "Acme Labs");
    const windows = planCanonicalProfileExtractionTextWindows(first.text);
    expect(windows).toHaveLength(4);
    const fullContext = [first, second].map(({ id, mediaType, checksum, text }) => ({
      id,
      mediaType,
      checksum,
      text,
    }));
    const { calls, executor } = executorFor((call) => {
      if (calls.length === 1) throw providerTruncation();
      const focusSourceId = call.input.extractionFocusSourceId;
      const window = call.input.extractionFocusWindow as
        | { readonly start: number; readonly end: number; readonly text: string }
        | undefined;
      expect(requestSources(call)).toEqual(fullContext);
      expect(call.contextSnapshotId).toBe("fallback-operation");
      expect(call.model).toEqual(model);
      expect(call.maxOutputTokens).toBe(controls.maxOutputTokens);
      expect(call.dataPolicy).toEqual(dataPolicy);
      expect(call.outputName).toBe("canonical_candidate_profile_extraction");
      expect(call.outputSchema).toBeDefined();
      if (focusSourceId === first.id) {
        if (window === undefined) throw providerTruncation();
        expect(call.systemPrompt).toContain("one of four bounded windows");
        const value = window.text.trim().split(/\s/u)[0];
        if (value === undefined) throw new Error("Expected a non-empty section.");
        const quote = window.start === 0 ? first.text.slice(0, window.end + 5) : value;
        return proposal([
          {
            key: `section-${window.start}`,
            category: "skill",
            field: "name",
            value,
            sourceId: first.id,
            quote,
          },
        ]);
      }
      expect(focusSourceId).toBe(second.id);
      expect(window).toBeUndefined();
      return proposal([
        {
          key: "other-source-fact",
          category: "employer",
          field: "name",
          value: "Acme Labs",
          sourceId: second.id,
          quote: "Acme Labs",
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

    expect(calls).toHaveLength(7);
    expect(calls[0]?.[0].input.extractionFocusSourceId).toBeUndefined();
    expect(calls[1]?.[0].input.extractionFocusSourceId).toBe(first.id);
    expect(calls[1]?.[0].input.extractionFocusWindow).toBeUndefined();
    for (const [index, plannedWindow] of (windows ?? []).entries()) {
      const focusedCall = calls[index + 2]?.[0];
      expect(focusedCall?.input.extractionFocusSourceId).toBe(first.id);
      expect(focusedCall?.input.extractionFocusWindow).toEqual(plannedWindow);
      expect(focusedCall?.input.sources).toEqual(fullContext);
    }
    expect(calls[6]?.[0].input.extractionFocusSourceId).toBe(second.id);
    expect(result.facts.map((fact) => fact.value)).toEqual([
      "TypeScript",
      "React",
      "Python",
      "PostgreSQL",
      "Acme Labs",
    ]);
    expect(result.facts.find((fact) => fact.value === "TypeScript")?.provenance).toEqual([
      first.reference,
    ]);
  });

  it("retains a grounded cross-source conflict discovered during section recovery", async () => {
    const first = material(
      "source-a",
      "Project Atlas launch was in 2021.\nTypeScript\nReact\nPython\n",
    );
    const second = material("source-b", "Project Atlas launch was in 2023.");
    const windows = planCanonicalProfileExtractionTextWindows(first.text);
    const conflictWindow = windows?.find((window) => window.text.includes("2021"));
    if (conflictWindow === undefined) throw new Error("Expected a window containing the fact.");
    const { calls, executor } = executorFor((call) => {
      if (calls.length === 1) throw providerTruncation();
      const focusSourceId = call.input.extractionFocusSourceId;
      const window = call.input.extractionFocusWindow as
        | { readonly start: number; readonly end: number; readonly text: string }
        | undefined;
      if (focusSourceId === first.id) {
        if (window === undefined) throw providerTruncation();
        expect(call.systemPrompt).toContain(
          "Include an outside-window counterfact only when it is grounded in a supplied source",
        );
        if (!window.text.includes("2021")) return proposal([]);
        return proposal(
          [
            {
              key: "launch-2021",
              category: "date",
              field: "launch-year",
              value: "2021",
              subjectKey: "project-atlas",
              sourceId: first.id,
              quote: "Project Atlas launch was in 2021",
            },
            {
              key: "launch-2023-counterfact",
              category: "date",
              field: "launch-year",
              value: "2023",
              subjectKey: "project-atlas",
              sourceId: second.id,
              quote: "Project Atlas launch was in 2023",
            },
          ],
          [
            {
              code: "conflict-date",
              factKeys: ["launch-2021", "launch-2023-counterfact"],
              sourceIds: [first.id, second.id],
            },
          ],
        );
      }
      expect(focusSourceId).toBe(second.id);
      expect(window).toBeUndefined();
      return proposal([]);
    });
    const result = await processCanonicalCandidateProfileExtraction(
      {
        extract: (preparedRequest) =>
          executeCanonicalProfileExtractionWithFallback(executor, preparedRequest, controls),
      },
      input([first, second]),
    );

    expect(conflictWindow).toBeDefined();
    expect(calls).toHaveLength(7);
    expect(result.facts.map((fact) => fact.value)).toEqual(["2021", "2023"]);
    const conflict = result.issues.find((issue) => issue.code === "conflict-date");
    expect(conflict?.severity).toBe("error");
    expect(conflict?.factIds).toHaveLength(2);
    expect(conflict?.factIds.every((id) => result.facts.some((fact) => fact.id === id))).toBe(true);
    expect(conflict?.sourceRefs).toEqual([first.reference, second.reference]);
    expect(result.facts.find((fact) => fact.value === "2021")?.provenance).toEqual([
      first.reference,
    ]);
    expect(result.facts.find((fact) => fact.value === "2023")?.provenance).toEqual([
      second.reference,
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

  it("returns the fixed output-limit failure when a tiny focused source cannot be partitioned", async () => {
    const { calls, executor } = executorFor(() => Promise.reject(providerTruncation()));
    await expect(
      executeCanonicalProfileExtractionWithFallback(
        executor,
        request([source("source-a", "abc"), source("source-b", "Other")]),
        controls,
      ),
    ).rejects.toMatchObject({
      code: "invalid-response",
      failureStage: "output-token-budget-exceeded",
    });
    expect(calls).toHaveLength(2);
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

  it("does not fan out a truncating grounding correction request", async () => {
    const failure = providerTruncation();
    const { calls, executor } = executorFor(() => Promise.reject(failure));
    const recoveryRequest = {
      ...request([source("source-a", "TypeScript"), source("source-b", "React")]),
      groundingRecovery: [{ code: "value_not_in_quote", count: 1 }],
    } as const;

    await expect(
      executeCanonicalProfileExtractionWithFallback(executor, recoveryRequest, controls),
    ).rejects.toBe(failure);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0].input).toMatchObject({
      groundingRecovery: [{ code: "value_not_in_quote", count: 1 }],
    });
    expect(calls[0]?.[0].input.extractionFocusSourceId).toBeUndefined();
    expect(calls[0]?.[0].systemPrompt).toContain("complete replacement proposal");
    expect(calls[0]?.[0].systemPrompt).toContain("does not support the synthesized value");
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
  ])("stops after a %s without returning partial facts", async (label, makeError, messagePart) => {
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

    expect(calls).toHaveLength(label === "batch truncation" ? 3 : 2);
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.message).toContain(messagePart);
    expect(result.issues[0]?.sourceRefs).toEqual([first.reference, second.reference]);
    expect(JSON.stringify(result)).not.toMatch(/private permission detail|private stop detail/u);
  });

  it.each([
    ["truncation", "output limit"],
    ["schema", "Profile output failed local validation"],
    ["grounding", "could not be grounded"],
  ] as const)(
    "saves no partial facts when a later section has %s failure",
    async (kind, message) => {
      const first = material("source-a", "TypeScript\nReact\nPython\nPostgreSQL\n");
      const second = material("source-b", "Acme");
      const firstWindow = planCanonicalProfileExtractionTextWindows(first.text)?.[0];
      if (firstWindow === undefined) throw new Error("Expected a first source window.");
      const { calls, executor } = executorFor((call) => {
        if (calls.length === 1) throw providerTruncation();
        if (kind === "grounding" && call.input.groundingRecovery !== undefined) {
          return proposal([
            {
              key: "still-ungrounded",
              category: "skill",
              field: "name",
              value: "React",
              sourceId: first.id,
              quote: "not in the original text",
            },
          ]);
        }
        if (call.input.extractionFocusSourceId === first.id) {
          const window = call.input.extractionFocusWindow as
            | { readonly start: number; readonly end: number; readonly text: string }
            | undefined;
          if (window === undefined) throw providerTruncation();
          if (window.start === firstWindow.start) {
            return proposal([
              {
                key: "first-leaf-fact",
                category: "skill",
                field: "name",
                value: "TypeScript",
                sourceId: first.id,
                quote: "TypeScript",
              },
            ]);
          }
          if (kind === "truncation") throw providerTruncation();
          if (kind === "schema")
            return { schemaVersion: 1, facts: [{ key: "malformed" }], issues: [] };
          return proposal([
            {
              key: "ungrounded-later-fact",
              category: "skill",
              field: "name",
              value: "React",
              sourceId: first.id,
              quote: "not in the original text",
            },
          ]);
        }
        if (call.input.extractionFocusSourceId === second.id) {
          return proposal([
            {
              key: "second-source-fact",
              category: "skill",
              field: "name",
              value: "Acme",
              sourceId: second.id,
              quote: "Acme",
            },
          ]);
        }
        throw new Error("A failed section must stop before another source is requested.");
      });
      const result = await processCanonicalCandidateProfileExtraction(
        {
          extract: (preparedRequest) =>
            executeCanonicalProfileExtractionWithFallback(executor, preparedRequest, controls),
        },
        input([first, second]),
      );

      expect(calls).toHaveLength(kind === "grounding" ? 8 : 4);
      expect(result.facts).toEqual([]);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]?.message).toContain(message);
    },
  );

  it("checks cancellation after a recovered leaf and before starting the next one", async () => {
    const first = material("source-a", "TypeScript\nReact\nPython\nPostgreSQL\n");
    const second = material("source-b", "Acme");
    const controller = new AbortController();
    const { calls, executor } = executorFor((call) => {
      if (calls.length === 1) throw providerTruncation();
      if (call.input.extractionFocusSourceId === first.id) {
        const window = call.input.extractionFocusWindow as
          | { readonly start: number; readonly end: number; readonly text: string }
          | undefined;
        if (window === undefined) throw providerTruncation();
        controller.abort();
        return proposal([
          {
            key: "first-window",
            category: "skill",
            field: "name",
            value: "TypeScript",
            sourceId: first.id,
            quote: "TypeScript",
          },
        ]);
      }
      throw new Error("Cancellation must stop later source and section calls.");
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
    expect(calls).toHaveLength(3);
  });

  it("keeps the bounded worst case to one initial, four source, and sixteen section calls", async () => {
    const sources = ["A", "B", "C", "D"].map((prefix, index) =>
      material(
        `source-${index + 1}`,
        `${prefix}lpha\n${prefix}ravo\n${prefix}harlie\n${prefix}elta\n`,
      ),
    );
    const { calls, executor } = executorFor((call) => {
      if (calls.length === 1) throw providerTruncation();
      const sourceId = call.input.extractionFocusSourceId as string;
      const sourceMaterial = sources.find((item) => item.id === sourceId);
      if (sourceMaterial === undefined) throw new Error("Unexpected focused source.");
      const window = call.input.extractionFocusWindow as
        | { readonly start: number; readonly end: number; readonly text: string }
        | undefined;
      if (window === undefined) throw providerTruncation();
      const value = window.text.trim().split(/\s/u)[0];
      if (value === undefined) throw new Error("Expected a non-empty section.");
      return proposal([
        {
          key: `leaf-${window.start}`,
          category: "skill",
          field: "name",
          value,
          sourceId,
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

    expect(calls).toHaveLength(21);
    expect(result.facts).toHaveLength(16);
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
    expect(result.issues[0]?.message).toContain("Profile output failed local validation");
    expect(result.issues[0]?.message).toContain("invalid field types:");
  });

  it("preserves focused-batch issue-reference diagnostics without another request", async () => {
    const first = material("source-a", "TypeScript");
    const second = material("source-b", "React");
    const { calls, executor } = executorFor(() => {
      if (calls.length === 1) throw providerTruncation();
      return proposal(
        [
          {
            key: "skill",
            category: "skill",
            field: "name",
            value: "TypeScript",
            sourceId: first.id,
            quote: "TypeScript",
          },
        ],
        [{ code: "omission", factKeys: ["missing-fact"], sourceIds: [] }],
      );
    });

    await expect(
      executeCanonicalProfileExtractionWithFallback(executor, request([first, second]), controls),
    ).rejects.toMatchObject({
      code: "invalid-response",
      failureStage: "response-schema-validation",
      diagnostics: [{ code: "invalid_profile_extraction_batch", path: "output" }],
      diagnosticCounts: [{ code: "profile_unknown_issue_facts", count: 1 }],
    });
    expect(calls).toHaveLength(2);
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

    expect(calls).toHaveLength(4);
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
      diagnosticCounts: [{ code: "profile_output_too_big", count: 1 }],
    });
    expect(calls).toHaveLength(3);
  });
});
