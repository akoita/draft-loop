import type { JsonObject, ModelResponse } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { proposalDiagnosticCounts } from "./author-diagnostic-counts.js";
import { invalidAuthorProposalError, proposalDiagnostics } from "./author-output.js";

function invariantIssue(code: string, index: number) {
  return {
    code: "custom" as const,
    path: ["sections", 0, "blocks", index],
    message: "private candidate wording that must never be recorded",
    params: { stage: "factual-invariant-rejection", invariantCode: code },
  };
}

function elevenIssueRejection(): z.ZodError {
  return new z.ZodError([
    ...Array.from({ length: 6 }, (_, index) => invariantIssue("unsupported_claim", index)),
    ...Array.from({ length: 3 }, (_, index) => invariantIssue("missing_evidence", 6 + index)),
    ...Array.from({ length: 2 }, (_, index) => ({
      code: "custom" as const,
      path: ["sections", 1, "blocks", index],
      message: "schema issue",
    })),
  ]);
}

const response = {
  output: {},
  contextSnapshotId: "context-1",
  provider: "anthropic",
  company: "anthropic",
  modelId: "author-test",
  providerRequestId: "request-1",
  structuredOutputSha256: "a".repeat(64),
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  cost: { estimatedUsd: null },
} as unknown as ModelResponse<JsonObject>;

describe("proposal diagnostic counts", () => {
  it("counts every issue by code while the diagnostics list stays capped at eight", () => {
    const rejection = elevenIssueRejection();

    const counts = proposalDiagnosticCounts(rejection);

    expect(counts).toEqual([
      { code: "unsupported_claim", count: 6 },
      { code: "missing_evidence", count: 3 },
      { code: "custom", count: 2 },
    ]);
    expect(counts.reduce((total, entry) => total + entry.count, 0)).toBe(11);
    expect(proposalDiagnostics(rejection)).toHaveLength(8);
    expect(JSON.stringify(counts)).not.toContain("private candidate wording");
  });

  it("drops unsafe codes and ignores non-issue input", () => {
    const rejection = {
      issues: [
        invariantIssue("unsupported_claim", 0),
        invariantIssue("candidate secret text!", 1),
        invariantIssue("", 2),
        { code: 42, path: [] },
        null,
        "not an issue",
        { code: "invalid_type", path: ["sections"] },
      ],
    };

    expect(proposalDiagnosticCounts(rejection)).toEqual([
      { code: "invalid_type", count: 1 },
      { code: "unsupported_claim", count: 1 },
    ]);
    expect(proposalDiagnosticCounts(new Error("no issues"))).toEqual([]);
    expect(proposalDiagnosticCounts({ issues: "not a list" })).toEqual([]);
    expect(proposalDiagnosticCounts(null)).toEqual([]);
  });

  it("keeps the 32 most frequent codes and breaks ties by code order", () => {
    const issues = [
      ...Array.from({ length: 40 }, (_, index) =>
        invariantIssue(`code_${String(index).padStart(2, "0")}`, index),
      ),
      invariantIssue("code_39", 40),
      invariantIssue("code_39", 41),
      invariantIssue("code_38", 42),
    ];

    const counts = proposalDiagnosticCounts({ issues });
    const codes = counts.map((entry) => entry.code);

    expect(counts).toHaveLength(32);
    expect(new Set(codes).size).toBe(32);
    expect(counts.slice(0, 3)).toEqual([
      { code: "code_39", count: 3 },
      { code: "code_38", count: 2 },
      { code: "code_00", count: 1 },
    ]);
    expect(counts.at(-1)).toEqual({ code: "code_29", count: 1 });
    expect(codes).not.toContain("code_30");
  });

  it("clamps each count at 100,000 so the orchestrator never drops a real count", () => {
    const issue = { code: "custom", path: ["sections"] };
    const issues = [...Array.from({ length: 100_002 }, () => issue), invariantIssue("x", 0)];

    expect(proposalDiagnosticCounts({ issues })).toEqual([
      { code: "custom", count: 100_000 },
      { code: "x", count: 1 },
    ]);
  });

  it("attaches the counts to an invalid author proposal error only when non-empty", () => {
    const rejected = invalidAuthorProposalError(response, elevenIssueRejection());

    expect(rejected.diagnostics).toHaveLength(8);
    expect(rejected.diagnosticCounts).toEqual([
      { code: "unsupported_claim", count: 6 },
      { code: "missing_evidence", count: 3 },
      { code: "custom", count: 2 },
    ]);
    expect(rejected.metadata.diagnosticCounts).toEqual(rejected.diagnosticCounts);

    const empty = invalidAuthorProposalError(response, new Error("private parse failure"));
    expect(empty.diagnosticCounts).toEqual([]);
    expect(empty.metadata).not.toHaveProperty("diagnosticCounts");
  });
});
