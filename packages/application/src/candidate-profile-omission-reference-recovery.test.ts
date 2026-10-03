import type { JsonObject, ModelRequest } from "@draft-loop/providers";
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
const controls = {
  model: {
    company: "anthropic",
    modelId: "claude-sonnet-5-5",
    role: "author",
    promptTemplateVersion: "omission-reference-test-v1",
  },
  systemPrompt: "Extract only supported candidate profile facts.",
  maxOutputTokens: 8192,
  dataPolicy,
} as const;

function material() {
  return {
    id: "source-a",
    mediaType: "text/plain",
    checksum: "a".repeat(64),
    text: "I built applications with TypeScript.",
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
    operationId: "omission-recovery-operation",
    sources: [material()],
    allowProviderData: true,
  };
}

function proposal(overrides: Record<string, unknown> = {}): JsonObject {
  return {
    schemaVersion: 1,
    facts: [
      {
        key: "fact-a",
        category: "skill",
        field: "name",
        value: "TypeScript",
        evidence: [{ sourceId: "source-a", quote: "TypeScript" }],
      },
    ],
    issues: [
      {
        code: "omission",
        factKeys: ["fact-a", "missing-fact"],
        sourceIds: ["source-a"],
      },
    ],
    ...overrides,
  } as JsonObject;
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

describe("sourced omission dangling fact reference recovery", () => {
  it("keeps grounded facts and the source-linked open omission in one request", async () => {
    const { execute, port } = extractionPort(proposal());

    const result = await processCanonicalCandidateProfileExtraction(port, extractionInput());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.facts).toHaveLength(1);
    expect(result.facts[0]).toMatchObject({
      category: "skill",
      field: "name",
      value: "TypeScript",
      provenance: [material().reference],
    });
    const omission = result.issues.find(
      (issue) =>
        issue.code === "omission" &&
        issue.sourceRefs.some((reference) => reference.sourceId === material().reference.sourceId),
    );
    expect(omission).toMatchObject({
      code: "omission",
      severity: "warning",
      status: "open",
      factIds: [result.facts[0]?.id],
      sourceRefs: [material().reference],
    });
  });

  it("still saves no facts when the recovered omission cites an unknown source", async () => {
    const { execute, port } = extractionPort(
      proposal({
        issues: [
          {
            code: "omission",
            factKeys: ["fact-a", "missing-fact"],
            sourceIds: ["unknown-source"],
          },
        ],
      }),
    );

    const result = await processCanonicalCandidateProfileExtraction(port, extractionInput());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: "omission", severity: "error", status: "open" });
  });

  it("still saves no facts when evidence is not supported by the selected source", async () => {
    const output = proposal({
      facts: [
        {
          key: "fact-a",
          category: "skill",
          field: "name",
          value: "TypeScript",
          evidence: [{ sourceId: "source-a", quote: "Used TypeScript at Northwind" }],
        },
      ],
    });
    const { execute, port } = extractionPort(output);

    const result = await processCanonicalCandidateProfileExtraction(port, extractionInput());

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.facts).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ code: "omission", severity: "error", status: "open" });
  });
});
