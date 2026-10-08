import { type JsonObject, type ModelRequest, ProviderAdapterError } from "@draft-loop/providers";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";
import {
  type CanonicalProfileExtractionControls,
  type CanonicalProfileExtractionExecutor,
  type CanonicalProfileExtractionPlannedPartEntry,
  clearCanonicalProfileExtractionPartCache,
  executeCanonicalProfileExtractionWithFallback,
} from "./canonical-profile-extraction-fallback.js";
import { createCanonicalProfileExtractionPartCache } from "./canonical-profile-extraction-parts.js";
import { planCanonicalProfileExtractionCalls } from "./canonical-profile-extraction-plan.js";
import type { CanonicalProfileExtractionProgress } from "./canonical-profile-extraction-progress.js";

const baseControls: CanonicalProfileExtractionControls = {
  model: {
    company: "anthropic",
    modelId: "claude-sonnet-5-5",
    role: "author",
    promptTemplateVersion: "concurrency-test-v1",
  },
  systemPrompt: "Original extraction prompt.",
  maxOutputTokens: 8192,
  dataPolicy: {
    allowTransmission: true,
    allowedCompanies: ["anthropic"],
    sensitiveData: true,
    sensitiveDataAcknowledged: true,
  },
};

function lines(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}\n`).join("");
}

function material(id: string, text: string) {
  return {
    id,
    mediaType: "text/plain",
    checksum: (id.endsWith("a") ? "a" : "b").repeat(64),
    text,
    reference: {
      storeId: `store-${id}`,
      knowledgeBaseId: `knowledge-${id}`,
      sourceId: `document-${id}`,
      versionId: `version-${id}`,
      kind: "candidate-provided" as const,
    },
  };
}

// Two sources plan into eleven windows, each starting with a distinct skill line.
const sources = [
  material("source-a", lines("SkillAlpha", 6_000)),
  material("source-b", lines("SkillBeta", 5_000)),
];
const plannedCount = planCanonicalProfileExtractionCalls(sources)?.length ?? 0;

function windowStart(call: ModelRequest<JsonObject>): number {
  return (call.input.extractionWindow as { start: number }).start;
}

/** The first line of a planned part's window, which identifies the part uniquely. */
function partLine(partIndex: number): string {
  const part = planCanonicalProfileExtractionCalls(sources)?.[partIndex];
  if (part?.window === undefined) throw new Error("Expected a windowed planned part.");
  return part.window.text.split("\n")[0] ?? "";
}

function firstLine(call: ModelRequest<JsonObject>): string {
  const [source] = call.input.sources as readonly { text: string }[];
  return (source?.text ?? "").split("\n")[0] ?? "";
}

function batchFor(call: ModelRequest<JsonObject>): JsonObject {
  const [source] = call.input.sources as readonly { id: string }[];
  const skill = firstLine(call);
  return {
    schemaVersion: 1,
    facts: [
      {
        key: "skill",
        category: "skill",
        field: "name",
        value: skill,
        evidence: [{ sourceId: source?.id ?? "", quote: skill }],
      },
    ],
    issues: [],
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Stub port whose later planned parts finish sooner, so completion order is reversed. */
function reversedPort(
  options: { readonly fail?: (call: ModelRequest<JsonObject>) => boolean } = {},
) {
  const state = { inFlight: 0, maxInFlight: 0, completionOrder: [] as string[], calls: 0 };
  const executor: CanonicalProfileExtractionExecutor = {
    execute: async (request) => {
      state.calls += 1;
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      const index = Math.floor(windowStart(request) / 1_000) % 20;
      try {
        await sleep(Math.max(1, 30 - index));
        if (options.fail?.(request) === true) {
          throw new ProviderAdapterError("anthropic", "timeout", "private timeout detail");
        }
        state.completionOrder.push(firstLine(request));
        return { output: batchFor(request) } as never;
      } finally {
        state.inFlight -= 1;
      }
    },
  };
  return { state, executor };
}

function input(
  extra: Partial<CanonicalCandidateProfileExtractionInput> = {},
): CanonicalCandidateProfileExtractionInput {
  return { operationId: "operation-a", sources, allowProviderData: true, ...extra };
}

function extract(
  executor: CanonicalProfileExtractionExecutor,
  controls: CanonicalProfileExtractionControls,
  extra: Partial<CanonicalCandidateProfileExtractionInput> = {},
) {
  return processCanonicalCandidateProfileExtraction(
    {
      extract: (request) =>
        executeCanonicalProfileExtractionWithFallback(executor, request, controls),
    },
    input(extra),
  );
}

function freshCache() {
  return createCanonicalProfileExtractionPartCache<CanonicalProfileExtractionPlannedPartEntry>();
}

describe("planned extraction parts run with bounded concurrency", () => {
  beforeEach(() => {
    clearCanonicalProfileExtractionPartCache();
  });

  it("plans enough parts to exercise the bound", () => {
    expect(plannedCount).toBeGreaterThan(8);
  });

  it("runs at most four parts at once by default", async () => {
    const { state, executor } = reversedPort();
    await extract(executor, baseControls);
    expect(state.calls).toBe(plannedCount);
    expect(state.maxInFlight).toBe(4);
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [0, 1],
    [-5, 1],
    [Number.NaN, 4],
  ])(
    "honours a configured concurrency of %s as at most %s at once",
    async (configured, expected) => {
      const { state, executor } = reversedPort();
      await extract(executor, {
        ...baseControls,
        concurrency: configured,
        partCache: freshCache(),
      });
      expect(state.maxInFlight).toBe(expected);
    },
  );

  it("combines results in plan order, identical to a sequential run", async () => {
    const sequentialPort = reversedPort();
    const sequential = await extract(sequentialPort.executor, {
      ...baseControls,
      concurrency: 1,
      partCache: freshCache(),
    });
    const parallelPort = reversedPort();
    const parallel = await extract(parallelPort.executor, {
      ...baseControls,
      concurrency: 4,
      partCache: freshCache(),
    });

    expect(sequentialPort.state.completionOrder).toEqual(
      Array.from({ length: plannedCount }, (_, index) => partLine(index)),
    );
    // The stub finishes later parts first, so completion order differs from plan order.
    expect(parallelPort.state.completionOrder).not.toEqual(sequentialPort.state.completionOrder);
    expect(parallel.facts.length).toBeGreaterThan(0);
    expect(parallel).toEqual(sequential);
    expect(parallel.facts.map((fact) => fact.id)).toEqual(sequential.facts.map((fact) => fact.id));
  });

  it("reports monotonic completed-part progress from zero to the planned total", async () => {
    const { executor } = reversedPort();
    const progress: CanonicalProfileExtractionProgress[] = [];
    await extract(
      executor,
      { ...baseControls, partCache: freshCache() },
      {
        onProgress: (value) => progress.push(value),
      },
    );
    expect(progress.map((value) => value.completedCalls)).toEqual(
      Array.from({ length: plannedCount + 1 }, (_, index) => index),
    );
    expect(progress.every((value) => value.plannedCalls === plannedCount)).toBe(true);
  });

  it("stops scheduling and settles in-flight parts when cancelled, even if the port ignores the signal", async () => {
    const controller = new AbortController();
    let started = 0;
    const executor: CanonicalProfileExtractionExecutor = {
      execute: async () => {
        started += 1;
        if (started === 3) controller.abort();
        // Hangs forever and ignores the abort signal.
        return new Promise<never>(() => undefined);
      },
    };

    await expect(
      extract(
        executor,
        { ...baseControls, partCache: freshCache() },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    await sleep(20);
    expect(started).toBe(3);
  });

  it("does not start any part when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { state, executor } = reversedPort();
    await expect(
      extract(
        executor,
        { ...baseControls, partCache: freshCache() },
        { signal: controller.signal },
      ),
    ).rejects.toThrow();
    expect(state.calls).toBe(0);
  });

  it("retries a part that fails once, alone, after the others finish", async () => {
    const reference = await extract(reversedPort().executor, {
      ...baseControls,
      partCache: freshCache(),
    });
    let attempts = 0;
    const { state, executor } = reversedPort({
      fail: (call) => {
        if (firstLine(call) !== partLine(3)) return false;
        attempts += 1;
        return attempts === 1;
      },
    });
    const progress: number[] = [];
    const result = await extract(
      executor,
      { ...baseControls, partCache: freshCache() },
      {
        onProgress: (value) => progress.push(value.completedCalls),
      },
    );

    expect(state.calls).toBe(plannedCount + 1);
    expect(attempts).toBe(2);
    expect(result).toEqual(reference);
    expect(progress).toEqual(Array.from({ length: plannedCount + 1 }, (_, index) => index));
  });

  it("fails the whole extraction when a part still fails after the planner retry", async () => {
    const failingLine = partLine(3);
    const { state, executor } = reversedPort({ fail: (call) => firstLine(call) === failingLine });
    const progress: number[] = [];
    const result = await extract(
      executor,
      { ...baseControls, partCache: freshCache() },
      {
        onProgress: (value) => progress.push(value.completedCalls),
      },
    );

    // No partial profile: the failure surfaces as a failed extraction with no facts.
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private timeout detail");
    expect(state.calls).toBe(plannedCount + 1);
    expect(progress.at(-1)).toBe(plannedCount - 1);
  });

  it("propagates the failing part's own error from the executor", async () => {
    const failingLine = partLine(2);
    const { executor } = reversedPort({ fail: (call) => firstLine(call) === failingLine });
    const request = {
      operationId: "operation-a",
      sources: sources.map(({ reference: _reference, ...rest }) => rest),
    };
    await expect(
      executeCanonicalProfileExtractionWithFallback(executor, request, {
        ...baseControls,
        partCache: freshCache(),
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("reuses completed parts so a user retry re-runs only the failed part", async () => {
    const reference = await extract(reversedPort().executor, {
      ...baseControls,
      partCache: freshCache(),
    });
    const failingLine = partLine(3);
    const failing = reversedPort({ fail: (call) => firstLine(call) === failingLine });
    // Both runs use the host-lifetime cache that the controls default to.
    const failed = await extract(failing.executor, baseControls, {
      operationId: "operation-first",
    });
    expect(failed.facts).toEqual([]);
    expect(failing.state.calls).toBe(plannedCount + 1);

    // The retry is a new operation (its snapshot id differs) with the same content.
    const healthy = reversedPort();
    const retried = await extract(healthy.executor, baseControls, {
      operationId: "operation-second",
    });
    expect(healthy.state.calls).toBe(1);
    expect(retried).toEqual(reference);
  });

  it("drops cached parts after a successful run and does not share them across models", async () => {
    const first = reversedPort();
    await extract(first.executor, baseControls);
    const second = reversedPort();
    await extract(second.executor, baseControls);
    expect(second.state.calls).toBe(plannedCount);

    const failingLine = partLine(3);
    await extract(
      reversedPort({ fail: (call) => firstLine(call) === failingLine }).executor,
      baseControls,
    );
    const otherModel = reversedPort();
    await extract(otherModel.executor, {
      ...baseControls,
      model: { ...baseControls.model, modelId: "another-model" },
    });
    expect(otherModel.state.calls).toBe(plannedCount);
  });
});
