import { ProviderAdapterError } from "@draft-loop/providers";
import { describe, expect, it, vi } from "vitest";
import {
  type CanonicalCandidateProfileExtractionInput,
  type CanonicalCandidateProfileExtractionRequest,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";
import { CandidateProfileGroundingError } from "./candidate-profile-grounding-diagnostics.js";

const sourceText =
  "from Jan 2020 to Jun 2024, integrated **payment** workflows and analytics reporting.";

function material(
  overrides: Partial<CanonicalCandidateProfileExtractionInput["sources"][number]> = {},
): CanonicalCandidateProfileExtractionInput["sources"][number] {
  return {
    id: "source-a",
    mediaType: "text/markdown",
    checksum: "a".repeat(64),
    text: sourceText,
    reference: {
      storeId: "store-1",
      knowledgeBaseId: "knowledge-1",
      sourceId: "document-1",
      versionId: "version-1",
      kind: "candidate-provided",
    },
    ...overrides,
  };
}

function input(
  sources: readonly CanonicalCandidateProfileExtractionInput["sources"][number][] = [material()],
  signal?: AbortSignal,
): CanonicalCandidateProfileExtractionInput {
  return {
    operationId: "grounding-recovery-operation",
    sources,
    allowProviderData: true,
    ...(signal === undefined ? {} : { signal }),
  };
}

function proposal(
  facts: readonly {
    readonly key: string;
    readonly category: string;
    readonly field: string;
    readonly value: string;
    readonly sourceId?: string;
    readonly quote: string;
    readonly subjectKey?: string;
  }[],
) {
  return {
    schemaVersion: 1,
    facts: facts.map(({ sourceId = "source-a", quote, ...fact }) => ({
      ...fact,
      evidence: [{ sourceId, quote }],
    })),
    issues: [],
  };
}

describe("canonical profile grounding recovery", () => {
  it("retries once with count-only feedback and accepts only the grounded replacement", async () => {
    const source = material();
    const initial = proposal([
      {
        key: "paraphrased-date-range",
        category: "date",
        field: "period",
        value: "2020–2024",
        quote: "from Jan 2020 to Jun 2024",
        subjectKey: "employment-example",
      },
      {
        key: "combined-systems-claim",
        category: "skill",
        field: "name",
        value: "payment and analytics",
        quote: "**payment** workflows and analytics reporting",
        subjectKey: "combined-claim",
      },
      {
        key: "initial-only-date-fragment",
        category: "date",
        field: "period",
        value: "Jan 2020",
        quote: "Jan 2020",
        subjectKey: "initial-only",
      },
    ]);
    const replacement = proposal([
      {
        key: "literal-date-range",
        category: "date",
        field: "period",
        value: "from Jan 2020 to Jun 2024",
        quote: "from Jan 2020 to Jun 2024",
        subjectKey: "employment-example",
      },
      {
        key: "payment-skill",
        category: "skill",
        field: "name",
        value: "payment",
        quote: "**payment**",
        subjectKey: "payment-skill",
      },
      {
        key: "analytics-skill",
        category: "skill",
        field: "name",
        value: "analytics",
        quote: "analytics",
        subjectKey: "analytics-skill",
      },
    ]);
    const requests: CanonicalCandidateProfileExtractionRequest[] = [];
    const extract = vi.fn(async (request: CanonicalCandidateProfileExtractionRequest) => {
      requests.push(request);
      return requests.length === 1 ? initial : replacement;
    });
    const controller = new AbortController();

    const result = await processCanonicalCandidateProfileExtraction(
      { extract },
      input([source], controller.signal),
    );

    expect(extract).toHaveBeenCalledTimes(2);
    expect(requests[0]).toMatchObject({
      operationId: "grounding-recovery-operation",
      sources: [{ id: source.id, text: sourceText }],
      signal: controller.signal,
    });
    expect(requests[0]?.groundingRecovery).toBeUndefined();
    expect(requests[1]?.operationId).toBe(requests[0]?.operationId);
    expect(requests[1]?.sources).toBe(requests[0]?.sources);
    expect(requests[1]?.signal).toBe(controller.signal);
    expect(requests[1]?.groundProposal).toBeUndefined();
    expect(requests[1]?.filterGroundedProposal).toBeUndefined();
    expect(requests[1]?.groundingRecovery).toEqual([{ code: "value_not_in_quote", count: 2 }]);
    expect(Object.isFrozen(requests[1])).toBe(true);
    expect(Object.isFrozen(requests[1]?.groundingRecovery)).toBe(true);
    expect(Object.isFrozen(requests[1]?.groundingRecovery?.[0])).toBe(true);
    expect(Object.keys(requests[1]?.groundingRecovery?.[0] ?? {}).sort()).toEqual([
      "code",
      "count",
    ]);
    expect(JSON.stringify(requests[1]?.groundingRecovery)).not.toMatch(
      /2020|payment|analytics|source-a|path/u,
    );
    expect(result.facts.map((fact) => fact.value)).toEqual([
      "from Jan 2020 to Jun 2024",
      "payment",
      "analytics",
    ]);
    expect(result.facts.find((fact) => fact.value === "payment")?.provenance).toEqual([
      source.reference,
    ]);
    expect(result.facts.find((fact) => fact.value === "analytics")?.provenance).toEqual([
      source.reference,
    ]);
    expect(result.facts.some((fact) => fact.value === "Jan 2020")).toBe(false);
    expect(result.facts.some((fact) => fact.value === "2020–2024")).toBe(false);
    expect(result.facts.some((fact) => fact.value === "payment and analytics")).toBe(false);
  });

  it("keeps grounded replacement facts, drops the rest, and warns once when the retry still fails grounding", async () => {
    const outputs = [
      proposal([
        {
          key: "first-invalid-fact",
          category: "skill",
          field: "name",
          value: "React",
          quote: "TypeScript",
        },
      ]),
      proposal([
        {
          key: "grounded-fact",
          category: "skill",
          field: "name",
          value: "TypeScript",
          quote: "TypeScript",
        },
        {
          key: "unknown-source-fact",
          category: "skill",
          field: "name",
          value: "Python",
          sourceId: "source-ghost",
          quote: "Python",
        },
        {
          key: "replacement-invalid-fact",
          category: "skill",
          field: "name",
          value: "React",
          quote: "TypeScript",
        },
      ]),
    ];
    const extract = vi.fn(async () => outputs.shift());

    const result = await processCanonicalCandidateProfileExtraction(
      { extract },
      input([material({ text: "TypeScript" })]),
    );

    expect(extract).toHaveBeenCalledTimes(2);
    expect(result.facts.map((fact) => fact.value)).toEqual(["TypeScript"]);
    const warnings = result.issues.filter((issue) => issue.message.includes("dropped"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      code: "omission",
      severity: "warning",
      status: "open",
      factIds: [],
    });
    expect(warnings[0]?.message).toBe(
      "2 extracted facts were dropped because their evidence quotes were not found in the cited sources. Review the profile for missing facts.",
    );
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/Python|ghost/u);
  });

  it("saves no facts and no error when the replacement keeps nothing grounded", async () => {
    const invalid = proposal([
      { key: "invalid", category: "skill", field: "name", value: "React", quote: "TypeScript" },
    ]);
    const extract = vi.fn(async () => invalid);

    const result = await processCanonicalCandidateProfileExtraction(
      { extract },
      input([material({ text: "TypeScript" })]),
    );

    expect(extract).toHaveBeenCalledTimes(2);
    expect(result.facts).toEqual([]);
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(false);
    expect(
      result.issues.some((issue) => issue.message.includes("1 extracted fact was dropped")),
    ).toBe(true);
  });

  it("does not retry schema, provider, or input failures", async () => {
    const malformedExtract = vi.fn(async () => ({
      schemaVersion: 1,
      facts: [{ key: "bad" }],
      issues: [],
    }));
    const malformed = await processCanonicalCandidateProfileExtraction(
      { extract: malformedExtract },
      input(),
    );
    expect(malformedExtract).toHaveBeenCalledTimes(1);
    expect(malformed.issues[0]?.message).toContain("local validation");

    const providerError = new ProviderAdapterError("anthropic", "permission", "private detail");
    const providerExtract = vi.fn(async () => Promise.reject(providerError));
    const providerFailure = await processCanonicalCandidateProfileExtraction(
      { extract: providerExtract },
      input(),
    );
    expect(providerExtract).toHaveBeenCalledTimes(1);
    expect(providerFailure.issues[0]?.message).toContain("account permissions");

    const invalidInputExtract = vi.fn(async () => proposal([]));
    const inputFailure = await processCanonicalCandidateProfileExtraction(
      { extract: invalidInputExtract },
      { ...input(), operationId: "" },
    );
    expect(invalidInputExtract).not.toHaveBeenCalled();
    expect(inputFailure.facts).toEqual([]);
  });

  it("reports a grounding failure thrown by the extraction port with grounding guidance", async () => {
    const portGroundingError = new CandidateProfileGroundingError([
      { code: "value_not_in_quote", count: 1 },
    ]);
    const extract = vi.fn(async () => Promise.reject(portGroundingError));

    const result = await processCanonicalCandidateProfileExtraction({ extract }, input());

    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.facts).toEqual([]);
    expect(result.issues[0]?.message).toContain("could not be grounded");
    expect(result.issues[0]?.message).toContain("values absent from evidence quotes: 1");
  });

  it("supplies a local grounding validator that repairs quotes or rejects ungrounded proposals", async () => {
    let validator: CanonicalCandidateProfileExtractionRequest["groundProposal"];
    const extract = vi.fn(async (request: CanonicalCandidateProfileExtractionRequest) => {
      validator = request.groundProposal;
      return proposal([]);
    });
    await processCanonicalCandidateProfileExtraction({ extract }, input());

    const parse = (value: unknown) => value as Parameters<NonNullable<typeof validator>>[0];
    const repaired = validator?.(
      parse(
        proposal([
          {
            key: "analytics",
            category: "skill",
            field: "name",
            value: "analytics",
            quote: "**analytics reporting**",
          },
        ]),
      ),
    );
    expect(repaired?.facts[0]?.evidence[0]?.quote).toBe("analytics reporting");
    expect(validator?.(repaired as Parameters<NonNullable<typeof validator>>[0])).toEqual(repaired);
    expect(() =>
      validator?.(
        parse(
          proposal([
            { key: "bad", category: "skill", field: "name", value: "Rust", quote: "payment" },
          ]),
        ),
      ),
    ).toThrow(CandidateProfileGroundingError);
  });

  it("supplies a local filter that repairs quotes and drops only ungrounded facts", async () => {
    let filter: CanonicalCandidateProfileExtractionRequest["filterGroundedProposal"];
    const extract = vi.fn(async (request: CanonicalCandidateProfileExtractionRequest) => {
      filter = request.filterGroundedProposal;
      return proposal([]);
    });
    await processCanonicalCandidateProfileExtraction({ extract }, input());

    const filtered = filter?.(
      proposal([
        {
          key: "analytics",
          category: "skill",
          field: "name",
          value: "analytics",
          quote: "**analytics reporting**",
        },
        { key: "bad", category: "skill", field: "name", value: "Rust", quote: "payment" },
      ]) as unknown as Parameters<NonNullable<typeof filter>>[0],
    );
    expect(filtered?.facts.map((fact) => fact.key)).toEqual(["analytics"]);
    expect(filtered?.facts[0]?.evidence[0]?.quote).toBe("analytics reporting");
  });

  it("does not make a full-corpus replacement when a planned aggregate fails grounding", async () => {
    const sources = [
      material({ id: "source-a", text: "TypeScript\n".repeat(4_000) }),
      material({ id: "source-b", text: "React\n".repeat(4_000) }),
    ];
    const extract = vi.fn(async () =>
      proposal([
        { key: "bad", category: "skill", field: "name", value: "Rust", quote: "TypeScript" },
      ]),
    );

    const result = await processCanonicalCandidateProfileExtraction({ extract }, input(sources));

    expect(extract).toHaveBeenCalledTimes(1);
    expect(result.facts).toEqual([]);
    expect(result.issues[0]?.message).toContain("could not be grounded");
  });

  it("keeps provider and schema errors from the replacement request in their own stages", async () => {
    const invalidGrounding = proposal([
      {
        key: "ungrounded",
        category: "skill",
        field: "name",
        value: "React",
        quote: "TypeScript",
      },
    ]);

    const schemaExtract = vi.fn(async (request: CanonicalCandidateProfileExtractionRequest) =>
      request.groundingRecovery === undefined
        ? invalidGrounding
        : { schemaVersion: 1, facts: [{ key: "malformed" }], issues: [] },
    );
    const schemaFailure = await processCanonicalCandidateProfileExtraction(
      { extract: schemaExtract },
      input([material({ text: "TypeScript" })]),
    );
    expect(schemaExtract).toHaveBeenCalledTimes(2);
    expect(schemaFailure.facts).toEqual([]);
    expect(schemaFailure.issues[0]?.message).toContain("Profile output failed local validation");

    const providerError = new ProviderAdapterError("anthropic", "permission", "private detail");
    const providerExtract = vi.fn(async (request: CanonicalCandidateProfileExtractionRequest) => {
      if (request.groundingRecovery === undefined) return invalidGrounding;
      throw providerError;
    });
    const providerFailure = await processCanonicalCandidateProfileExtraction(
      { extract: providerExtract },
      input([material({ text: "TypeScript" })]),
    );
    expect(providerExtract).toHaveBeenCalledTimes(2);
    expect(providerFailure.facts).toEqual([]);
    expect(providerFailure.issues[0]?.message).toContain("account permissions");
  });

  it("propagates cancellation before a corrective call and while that call is running", async () => {
    const beforeRetryController = new AbortController();
    const beforeRetrySignal = {
      get aborted() {
        return beforeRetryController.signal.aborted;
      },
      throwIfAborted() {
        if (beforeRetryController.signal.aborted) beforeRetryController.signal.throwIfAborted();
      },
    } as AbortSignal;
    const beforeRetryExtract = vi.fn(async () => {
      queueMicrotask(() => beforeRetryController.abort());
      return proposal([
        {
          key: "ungrounded",
          category: "skill",
          field: "name",
          value: "React",
          quote: "TypeScript",
        },
      ]);
    });
    await expect(
      processCanonicalCandidateProfileExtraction(
        { extract: beforeRetryExtract },
        input([material({ text: "TypeScript" })], beforeRetrySignal),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(beforeRetryExtract).toHaveBeenCalledTimes(1);

    const duringRetryController = new AbortController();
    const duringRetryExtract = vi.fn(
      async (request: CanonicalCandidateProfileExtractionRequest) => {
        if (request.groundingRecovery === undefined) {
          return proposal([
            {
              key: "ungrounded",
              category: "skill",
              field: "name",
              value: "React",
              quote: "TypeScript",
            },
          ]);
        }
        duringRetryController.abort();
        return proposal([]);
      },
    );
    await expect(
      processCanonicalCandidateProfileExtraction(
        { extract: duringRetryExtract },
        input([material({ text: "TypeScript" })], duringRetryController.signal),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(duringRetryExtract).toHaveBeenCalledTimes(2);
  });
});
