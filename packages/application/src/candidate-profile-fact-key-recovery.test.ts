import type { JsonObject, ModelRequest } from "@draft-loop/providers";
import type { CanonicalCandidateProfileExtractionProposal } from "@draft-loop/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  type CanonicalCandidateProfileExtractionInput,
  type CanonicalCandidateProfileExtractionRequest,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";
import { recoverUnreferencedDuplicateFactKeys } from "./candidate-profile-fact-key-recovery.js";
import {
  CandidateProfileProposalValidationError,
  parseCanonicalCandidateProfileExtractionProposal,
} from "./candidate-profile-proposal-validation.js";
import {
  type CanonicalProfileExtractionExecutor,
  executeCanonicalProfileExtractionWithFallback,
} from "./canonical-profile-extraction-fallback.js";

function fact(key: string, value = "TypeScript", quote = value, subjectKey = "project-a") {
  return {
    key,
    category: "skill",
    subjectKey,
    field: "name",
    value,
    evidence: [{ sourceId: "source-a", quote }],
  };
}

function proposal(
  facts: readonly Record<string, unknown>[],
  issues: readonly Record<string, unknown>[] = [],
): CanonicalCandidateProfileExtractionProposal {
  return {
    schemaVersion: 1,
    facts,
    issues,
  } as unknown as CanonicalCandidateProfileExtractionProposal;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function expectValidationFailure(input: unknown, code: string): void {
  let caught: unknown;
  try {
    parseCanonicalCandidateProfileExtractionProposal(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CandidateProfileProposalValidationError);
  expect(caught).toMatchObject({ diagnosticCounts: expect.arrayContaining([{ code, count: 1 }]) });
}

const dataPolicy = {
  allowTransmission: true,
  allowedCompanies: ["anthropic"],
  sensitiveData: true,
  sensitiveDataAcknowledged: true,
} as const;
const controls = {
  model: {
    company: "anthropic",
    modelId: "claude-sonnet-5-5",
    role: "author",
    promptTemplateVersion: "fact-key-recovery-v1",
  },
  systemPrompt: "Extract only grounded candidate profile facts.",
  maxOutputTokens: 8192,
  dataPolicy,
} as const;

function material() {
  return {
    id: "source-a",
    mediaType: "text/plain",
    checksum: "a".repeat(64),
    text: "Built Project Orion and Project Atlas with TypeScript and React.",
    reference: {
      storeId: "store-a",
      knowledgeBaseId: "knowledge-a",
      sourceId: "document-a",
      versionId: "version-a",
      kind: "candidate-provided" as const,
    },
  };
}

function extractionInput(): CanonicalCandidateProfileExtractionInput {
  return {
    operationId: "fact-key-recovery-operation",
    sources: [material()],
    allowProviderData: true,
  };
}

function extractionPort(output: JsonObject) {
  const execute = vi.fn(async (_request: ModelRequest<JsonObject>) => ({ output }));
  const executor: CanonicalProfileExtractionExecutor = {
    execute: execute as unknown as CanonicalProfileExtractionExecutor["execute"],
  };
  return {
    execute,
    port: {
      extract: (request: CanonicalCandidateProfileExtractionRequest) =>
        executeCanonicalProfileExtractionWithFallback(executor, request, controls),
    },
  };
}

describe("unreferenced duplicate candidate fact keys", () => {
  it("repairs later occurrences deterministically without mutating frozen facts", () => {
    const input = deepFreeze(
      proposal([
        fact("reused", "TypeScript", "TypeScript", "subject-one"),
        fact("reused", "React", "React", "subject-two"),
        fact("reused", "Python", "Python", "subject-three"),
      ]),
    );
    const before = structuredClone(input);

    const first = recoverUnreferencedDuplicateFactKeys(input);
    const second = recoverUnreferencedDuplicateFactKeys(input);

    expect(first?.facts.map(({ key }) => key)).toEqual([
      "reused",
      "recovered-fact-1",
      "recovered-fact-2",
    ]);
    expect(second).toEqual(first);
    expect(first?.facts.map(({ key: _key, ...fields }) => fields)).toEqual(
      input.facts.map(({ key: _key, ...fields }) => fields),
    );
    expect(input).toEqual(before);
  });

  it("uses trimmed identities only when detecting duplicate keys", () => {
    const input = proposal([fact(" shared "), fact("shared", "React", "React")]);
    const recovered = recoverUnreferencedDuplicateFactKeys(input);

    expect(recovered?.facts.map(({ key }) => key)).toEqual([" shared ", "recovered-fact-1"]);
    expect(input.facts.map(({ key }) => key)).toEqual([" shared ", "shared"]);
  });

  it("skips generated-key collisions from facts and even unknown issue references", () => {
    const input = proposal(
      [
        fact("shared"),
        fact("recovered-fact-1", "React", "React"),
        fact("shared", "Python", "Python"),
        fact("recovered-fact-4", "Go", "Go"),
        fact("shared", "Rust", "Rust"),
      ],
      [{ code: "omission", factKeys: ["recovered-fact-2", "recovered-fact-5"], sourceIds: [] }],
    );

    const recovered = recoverUnreferencedDuplicateFactKeys(input);

    expect(recovered?.facts.map(({ key }) => key)).toEqual([
      "shared",
      "recovered-fact-1",
      "recovered-fact-3",
      "recovered-fact-4",
      "recovered-fact-6",
    ]);
    expect(recovered?.issues[0]?.factKeys).toEqual(["recovered-fact-2", "recovered-fact-5"]);
  });

  it.each(["omission", "conflict-value", "duplicate"] as const)(
    "rejects ambiguous keys referenced by a %s issue",
    (code) => {
      const input = proposal(
        [fact("reused"), fact("reused", "React", "React"), fact("other", "Python", "Python")],
        [{ code, factKeys: ["reused", "other"], sourceIds: ["source-a"] }],
      );

      expect(recoverUnreferencedDuplicateFactKeys(input)).toBeUndefined();
      expectValidationFailure(input, "profile_duplicate_fact_keys");
    },
  );

  it("combines duplicate-key repair with existing list and omission normalization", () => {
    const input = proposal(
      [
        {
          ...fact("shared"),
          evidence: [
            { sourceId: "source-a", quote: "TypeScript" },
            { sourceId: " source-a ", quote: " TypeScript " },
          ],
        },
        fact("shared", "React", "React"),
        fact("kept", "Python", "Python"),
      ],
      [
        {
          code: "omission",
          factKeys: ["kept", "missing", "kept"],
          sourceIds: ["source-a", " source-a "],
        },
      ],
    );
    const before = structuredClone(input);

    const parsed = parseCanonicalCandidateProfileExtractionProposal(input);

    expect(parsed.facts.map(({ key }) => key)).toEqual(["shared", "recovered-fact-1", "kept"]);
    expect(parsed.facts[0]?.evidence).toEqual([{ sourceId: "source-a", quote: "TypeScript" }]);
    expect(parsed.issues).toEqual([
      { code: "omission", factKeys: ["kept"], sourceIds: ["source-a"] },
    ]);
    expect(input).toEqual(before);
  });

  it("does not recover malformed or oversized proposals", () => {
    expectValidationFailure(
      {
        ...proposal([fact("same"), fact("same", "React", "React")]),
        unexpected: true,
      },
      "profile_output_unrecognized_keys",
    );
    expectValidationFailure(
      proposal(
        Array.from({ length: 513 }, (_, index) => fact("same", `Value ${index}`, `Value ${index}`)),
      ),
      "profile_output_too_big",
    );
  });

  it("retains semantic duplicate and conflict review issues after one extraction request", async () => {
    const output = deepFreeze({
      schemaVersion: 1,
      facts: [
        {
          ...fact("reused", "Project Orion"),
          category: "project",
          field: "name",
          evidence: [{ sourceId: "source-a", quote: "Project Orion" }],
        },
        {
          ...fact("reused", "Project Orion"),
          category: "project",
          field: "name",
          evidence: [{ sourceId: "source-a", quote: "Project Orion" }],
        },
        {
          ...fact("reused", "Project Atlas"),
          category: "project",
          field: "name",
          evidence: [{ sourceId: "source-a", quote: "Project Atlas" }],
        },
      ],
      issues: [],
    }) as unknown as JsonObject;
    const before = structuredClone(output);
    const { execute, port } = extractionPort(output);

    const result = await processCanonicalCandidateProfileExtraction(port, extractionInput());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.facts.map(({ value }) => value)).toEqual([
      "Project Orion",
      "Project Orion",
      "Project Atlas",
    ]);
    for (const resultFact of result.facts) {
      expect(resultFact.provenance).toEqual([material().reference]);
    }
    const duplicate = result.issues.find(({ code }) => code === "duplicate");
    const conflict = result.issues.find(({ code }) => code === "conflict-value");
    expect(duplicate?.severity).toBe("warning");
    expect(duplicate?.status).toBe("open");
    expect(duplicate?.factIds).toHaveLength(2);
    expect(conflict?.severity).toBe("error");
    expect(conflict?.status).toBe("open");
    expect(conflict?.factIds).toHaveLength(3);
    expect(output).toEqual(before);
  });

  it.each([
    [
      "unknown source",
      {
        schemaVersion: 1,
        facts: [fact("shared"), fact("shared", "React", "React")],
        issues: [{ code: "omission", factKeys: [], sourceIds: ["unknown-source"] }],
      },
    ],
    [
      "unsupported quote",
      {
        schemaVersion: 1,
        facts: [
          fact("shared", "TypeScript"),
          {
            ...fact("shared", "React", "React at Northwind"),
            evidence: [{ sourceId: "source-a", quote: "React at Northwind" }],
          },
        ],
        issues: [],
      },
    ],
    [
      "unknown conflict reference",
      {
        schemaVersion: 1,
        facts: [fact("shared"), fact("shared", "React", "React")],
        issues: [
          { code: "conflict-value", factKeys: ["shared", "missing"], sourceIds: ["source-a"] },
        ],
      },
    ],
  ])("still saves no facts for an unsafe %s", async (_name, output) => {
    const { execute, port } = extractionPort(output as JsonObject);

    const result = await processCanonicalCandidateProfileExtraction(port, extractionInput());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: "omission", severity: "error", status: "open" });
  });
});
