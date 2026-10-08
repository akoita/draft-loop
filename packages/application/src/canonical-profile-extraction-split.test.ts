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
import {
  createCanonicalProfileExtractionPartCache,
  defaultCanonicalProfileExtractionConcurrencyFor,
} from "./canonical-profile-extraction-parts.js";
import {
  planCanonicalProfileExtractionCalls,
  proactivePlanMaximumCallCount,
} from "./canonical-profile-extraction-plan.js";
import type { CanonicalProfileExtractionProgress } from "./canonical-profile-extraction-progress.js";
import type { CanonicalProfileExtractionTextWindow } from "./canonical-profile-extraction-sections.js";
import { splitCanonicalProfileExtractionWindow } from "./canonical-profile-extraction-split.js";

const baseControls: CanonicalProfileExtractionControls = {
  model: {
    company: "anthropic",
    modelId: "claude-sonnet-5-5",
    role: "author",
    promptTemplateVersion: "split-test-v1",
  },
  systemPrompt: "Original extraction prompt.",
  maxOutputTokens: 8192,
  dataPolicy: {
    allowTransmission: true,
    allowedCompanies: ["anthropic", "mistral"],
    sensitiveData: true,
    sensitiveDataAcknowledged: true,
  },
  concurrency: 1,
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

// One source of about 70,000 characters plans into nine windows of at most 8,192.
const sources = [material("source-a", lines("SkillAlpha", 6_000))];
const planned = planCanonicalProfileExtractionCalls(sources) ?? [];

function overflow(): ProviderAdapterError {
  return new ProviderAdapterError("anthropic", "invalid-response", "private stop detail", {
    retryable: false,
    diagnostics: [{ code: "max_tokens", path: "stop_reason" }],
  });
}

function windowOf(call: ModelRequest<JsonObject>): { start: number; end: number } {
  const { start, end } = call.input.extractionWindow as { start: number; end: number };
  return { start, end };
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

/** Stub port: windows longer than `limit` overflow the output; `fail` throws a timeout. */
function port(
  options: {
    readonly limit?: number;
    readonly fail?: (call: ModelRequest<JsonObject>) => boolean;
    readonly delay?: number;
  } = {},
) {
  const state = {
    calls: [] as ModelRequest<JsonObject>[],
    inFlight: 0,
    maxInFlight: 0,
  };
  const executor: CanonicalProfileExtractionExecutor = {
    execute: async (request) => {
      state.calls.push(request);
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      try {
        if (options.delay !== undefined) await sleep(options.delay);
        const { start, end } = windowOf(request);
        if (options.limit !== undefined && end - start > options.limit) throw overflow();
        if (options.fail?.(request) === true) {
          throw new ProviderAdapterError("anthropic", "timeout", "private timeout detail");
        }
        return { output: batchFor(request) } as never;
      } finally {
        state.inFlight -= 1;
      }
    },
  };
  return { state, executor };
}

function freshCache() {
  return createCanonicalProfileExtractionPartCache<CanonicalProfileExtractionPlannedPartEntry>();
}

function extract(
  executor: CanonicalProfileExtractionExecutor,
  controls: CanonicalProfileExtractionControls,
  extra: Partial<CanonicalCandidateProfileExtractionInput> = {},
  inputSources: readonly ReturnType<typeof material>[] = sources,
) {
  return processCanonicalCandidateProfileExtraction(
    {
      extract: (request) =>
        executeCanonicalProfileExtractionWithFallback(executor, request, controls),
    },
    { operationId: "operation-a", sources: inputSources, allowProviderData: true, ...extra },
  );
}

function rawExtract(
  executor: CanonicalProfileExtractionExecutor,
  controls: CanonicalProfileExtractionControls,
  inputSources: readonly ReturnType<typeof material>[] = sources,
) {
  return executeCanonicalProfileExtractionWithFallback(
    executor,
    {
      operationId: "operation-a",
      sources: inputSources.map(({ reference: _reference, ...rest }) => rest),
    },
    controls,
  );
}

function halvesOf(
  window: CanonicalProfileExtractionTextWindow,
): readonly [CanonicalProfileExtractionTextWindow, CanonicalProfileExtractionTextWindow] {
  const halves = splitCanonicalProfileExtractionWindow(window);
  if (halves === null) throw new Error("Expected a splittable window.");
  return halves;
}

function plannedWindow(index: number): CanonicalProfileExtractionTextWindow {
  const window = planned[index]?.window;
  if (window === undefined) throw new Error("Expected a windowed planned part.");
  return window;
}

describe("splitting a window", () => {
  function pad(length: number, fill = "x"): string {
    return fill.repeat(length);
  }

  it("prefers the heading nearest the middle over a nearer newline", () => {
    const text = `${pad(1_900)}\n${pad(150)}\n# Middle\n${pad(300)}\n${pad(1_500)}`;
    const headingOffset = text.indexOf("# Middle");
    const middle = Math.floor(text.length / 2);
    const nearerNewline = text.lastIndexOf("\n", middle);
    expect(Math.abs(nearerNewline - middle)).toBeLessThan(Math.abs(headingOffset - middle));
    const [left, right] = halvesOf({ start: 10_000, end: 10_000 + text.length, text });
    expect(left.end).toBe(10_000 + headingOffset);
    expect(right.start).toBe(10_000 + headingOffset);
    expect(left.text + right.text).toBe(text);
    expect(right.text.startsWith("# Middle")).toBe(true);
  });

  it("falls back to the newline nearest the middle, then the exact middle", () => {
    const withNewline = `${pad(2_100)}\n${pad(1_899)}`;
    const [left] = halvesOf({ start: 0, end: withNewline.length, text: withNewline });
    expect(left.text).toBe(`${pad(2_100)}\n`);

    const plain = pad(4_000);
    const [plainLeft, plainRight] = halvesOf({ start: 0, end: 4_000, text: plain });
    expect([plainLeft.end, plainRight.start]).toEqual([2_000, 2_000]);
  });

  it("ignores boundaries that would leave a half under 1,000 characters", () => {
    const text = `${pad(400)}\n# Early\n${pad(3_600)}`;
    const [left] = halvesOf({ start: 0, end: text.length, text });
    expect(left.end).toBe(Math.floor(text.length / 2));
    expect(splitCanonicalProfileExtractionWindow({ start: 0, end: 1_999, text: pad(1_999) })).toBe(
      null,
    );
  });

  it("never cuts a surrogate pair", () => {
    const text = `${pad(1_999)}\u{1F600}${pad(2_000)}`;
    const [left, right] = halvesOf({ start: 0, end: text.length, text });
    expect(left.text + right.text).toBe(text);
    expect(left.text.endsWith("\ud83d")).toBe(false);
    expect(right.text.startsWith("\ude00")).toBe(false);
  });

  it("carries the parent's heading path plus the heading a half starts at", () => {
    const text = `${pad(1_800)}\n## Role\n${pad(2_000)}`;
    const [left, right] = halvesOf({
      start: 0,
      end: text.length,
      text,
      headingPath: ["Experience"],
    });
    expect(left.headingPath).toEqual(["Experience"]);
    expect(right.headingPath).toEqual(["Experience", "Role"]);
    const [plainLeft] = halvesOf({ start: 5, end: 5 + 4_000, text: pad(4_000) });
    expect("headingPath" in plainLeft).toBe(false);
  });
});

describe("planned extraction splits a part after an output-limit failure", () => {
  beforeEach(() => {
    clearCanonicalProfileExtractionPartCache();
  });

  it("plans enough parts to exercise the split", () => {
    expect(planned.length).toBeGreaterThan(4);
    expect(
      planned.every((call) => (call.window?.end ?? 0) - (call.window?.start ?? 0) > 5_000),
    ).toBe(true);
  });

  it("runs both halves and merges them in document order, as if the windows were extracted directly", async () => {
    const { state, executor } = port({ limit: 5_000 });
    const result = await extract(executor, { ...baseControls, partCache: freshCache() });

    // Each part: the overflowing whole window, then its two halves.
    expect(state.calls).toHaveLength(planned.length * 3);
    const expected = planned.flatMap((_, index) => halvesOf(plannedWindow(index)));
    expect(result.facts.map((fact) => fact.value)).toEqual(
      expected.map((half) => half.text.split("\n")[0]),
    );
    const halfCalls = state.calls.filter((call) => {
      const { start, end } = windowOf(call);
      return end - start <= 5_000;
    });
    expect(halfCalls.map((call) => windowOf(call))).toEqual(
      expected.map(({ start, end }) => ({ start, end })),
    );
    for (const call of halfCalls) {
      const { start, end } = windowOf(call);
      const [source] = call.input.sources as readonly { text: string }[];
      expect(source?.text).toBe(sources[0]?.text.slice(start, end));
    }
  });

  it("carries the parent's heading path into the halves' requests", async () => {
    const headed = material(
      "source-a",
      Array.from({ length: 12 }, (_, index) => `# Section ${index}\n${lines(`Doc${index}x`, 700)}`)
        .join("")
        .concat("\n"),
    );
    const plan = planCanonicalProfileExtractionCalls([headed]) ?? [];
    expect(plan.length).toBeGreaterThan(1);
    const { state, executor } = port({ limit: 5_000 });
    await extract(executor, { ...baseControls, partCache: freshCache() }, {}, [headed]);
    const halves = state.calls.filter((call) => {
      const { start, end } = windowOf(call);
      return end - start <= 5_000;
    });
    expect(halves.length).toBeGreaterThan(plan.length);
    const withPath = halves.filter(
      (call) =>
        (call.input.extractionWindow as { headingPath?: unknown }).headingPath !== undefined,
    );
    for (const call of withPath) {
      expect(call.systemPrompt).toContain("input.extractionWindow.headingPath");
    }
  });

  it("splits at most three times and never below 1,000 characters, then fails without retrying", async () => {
    const { state, executor } = port({ limit: 0 });
    const error = await rawExtract(executor, { ...baseControls, partCache: freshCache() }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ProviderAdapterError);
    expect(error).toMatchObject({
      message:
        "The provider could not complete canonical profile extraction within the output-token limit.",
      failureStage: "output-token-budget-exceeded",
    });
    // The first part reaches depth three; with one lane the first failure stops the whole run.
    const first = plannedWindow(0);
    const sizes = state.calls.map((call) => {
      const { start, end } = windowOf(call);
      return end - start;
    });
    const chain = [first];
    let current = first;
    for (let depth = 0; depth < 3; depth += 1) {
      current = halvesOf(current)[0];
      chain.push(current);
    }
    // Every part is attempted once (output-limit failures are not retried); the first part's calls
    // are its window and then three levels of left halves.
    expect(sizes.slice(0, 4)).toEqual(chain.map((window) => window.end - window.start));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(1_000);
    expect(state.calls).toHaveLength(
      planned.reduce((total, _, index) => {
        let window = plannedWindow(index);
        let count = 1;
        for (let depth = 0; depth < 3; depth += 1) {
          const halves = splitCanonicalProfileExtractionWindow(window);
          if (halves === null) break;
          window = halves[0];
          count += 1;
        }
        return total + count;
      }, 0),
    );
  });

  it("does not split other failures and keeps the single planner retry", async () => {
    let attempts = 0;
    const target = plannedWindow(2);
    const { state, executor } = port({
      fail: (call) => {
        if (windowOf(call).start !== target.start) return false;
        attempts += 1;
        return attempts === 1;
      },
    });
    const result = await extract(executor, { ...baseControls, partCache: freshCache() });

    expect(state.calls).toHaveLength(planned.length + 1);
    expect(result.facts).toHaveLength(planned.length);
    const retried = state.calls.filter((call) => windowOf(call).start === target.start);
    expect(retried.map((call) => windowOf(call))).toEqual([
      { start: target.start, end: target.end },
      { start: target.start, end: target.end },
    ]);
  });

  it("reports progress in original planned parts, not leaf windows", async () => {
    const progress: CanonicalProfileExtractionProgress[] = [];
    const { executor } = port({ limit: 5_000 });
    await extract(
      executor,
      { ...baseControls, partCache: freshCache() },
      { onProgress: (value) => progress.push(value) },
    );
    expect(progress.map((value) => value.completedCalls)).toEqual(
      Array.from({ length: planned.length + 1 }, (_, index) => index),
    );
    expect(progress.every((value) => value.plannedCalls === planned.length)).toBe(true);
  });

  it("reuses cached halves when the user retries after a failure", async () => {
    const reference = await extract(port({ limit: 5_000 }).executor, {
      ...baseControls,
      partCache: freshCache(),
    });
    const cache = freshCache();
    const [, rightHalf] = halvesOf(plannedWindow(3));
    const failing = port({
      limit: 5_000,
      fail: (call) => windowOf(call).start === rightHalf.start,
    });
    const failed = await extract(
      failing.executor,
      { ...baseControls, partCache: cache },
      {
        operationId: "operation-first",
      },
    );
    expect(failed.facts).toEqual([]);
    // Three calls per part, plus one planner retry of the failing right half.
    expect(failing.state.calls).toHaveLength(planned.length * 3 + 1);

    // A new operation with the same content re-runs only the half that failed.
    const healthy = port({ limit: 5_000 });
    const retried = await extract(
      healthy.executor,
      { ...baseControls, partCache: cache },
      {
        operationId: "operation-second",
      },
    );
    expect(healthy.state.calls.map((call) => windowOf(call))).toEqual([
      { start: rightHalf.start, end: rightHalf.end },
    ]);
    expect(retried).toEqual(reference);
    expect(cache.size()).toBe(0);
  });

  it("stops splitting when the splits would exceed the plan's call cap", async () => {
    // Four sources whose windows plan just under the cap leave room for only a few splits.
    const lineCount = 17_500;
    const many = ["a", "b", "c", "d"].map((suffix, index) =>
      material(`source-${suffix}`, lines(`Cap${index}x`, lineCount)),
    );
    const plan = planCanonicalProfileExtractionCalls(many) ?? [];
    const room = proactivePlanMaximumCallCount - plan.length;
    expect(room).toBeGreaterThanOrEqual(1);
    expect(room).toBeLessThan(plan.length);

    const { state, executor } = port({ limit: 5_000 });
    const error = await rawExtract(
      executor,
      { ...baseControls, partCache: freshCache() },
      many,
    ).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ failureStage: "output-token-budget-exceeded" });
    // Every part overflows once; only `room` parts may split (two more calls each), the rest fail.
    expect(state.calls).toHaveLength(room * 3 + (plan.length - room));
  });
});

describe("planned extraction concurrency by provider", () => {
  const manySources = [material("source-a", lines("SkillAlpha", 9_000))];
  const manyPlanned = planCanonicalProfileExtractionCalls(manySources) ?? [];

  beforeEach(() => {
    clearCanonicalProfileExtractionPartCache();
  });

  it("defaults to eight for Mistral and four otherwise", () => {
    expect(defaultCanonicalProfileExtractionConcurrencyFor("mistral")).toBe(8);
    expect(defaultCanonicalProfileExtractionConcurrencyFor("anthropic")).toBe(4);
    expect(defaultCanonicalProfileExtractionConcurrencyFor("openai")).toBe(4);
  });

  it("plans enough parts to exercise the bound", () => {
    expect(manyPlanned.length).toBeGreaterThan(8);
  });

  const { concurrency: _unset, ...unsetConcurrency } = baseControls;

  it.each([
    ["mistral", undefined, 8],
    ["anthropic", undefined, 4],
    ["mistral", 2, 2],
    ["anthropic", 6, 6],
    ["mistral", Number.NaN, 8],
  ] as const)(
    "runs %s with configured concurrency %s at %s at once",
    async (company, configured, expected) => {
      const { state, executor } = port({ delay: 5 });
      await extract(
        executor,
        {
          ...unsetConcurrency,
          model: { ...baseControls.model, company },
          partCache: freshCache(),
          ...(configured === undefined ? {} : { concurrency: configured }),
        },
        {},
        manySources,
      );
      expect(state.calls).toHaveLength(manyPlanned.length);
      expect(state.maxInFlight).toBe(expected);
    },
  );
});
