import { describe, expect, it } from "vitest";

import type { CanonicalProfileExtractionExecutor } from "./canonical-profile-extraction-fallback.js";
import {
  profileDetailLiveCheckNotes,
  runProfileDetailLiveCheck,
} from "./profile-detail-live-check.js";
import { runProfileDetailLiveCheckCommand } from "./profile-detail-live-check-command.js";

const controls = {
  model: {
    company: "anthropic",
    modelId: "claude-haiku-5-5",
    role: "author" as const,
    promptTemplateVersion: "test",
  },
  systemPrompt: "test",
  maxOutputTokens: 32_768,
  dataPolicy: {
    allowTransmission: true,
    allowedCompanies: ["anthropic"],
    sensitiveData: true,
    sensitiveDataAcknowledged: true,
    requestedRetention: "provider-default" as const,
  },
};

const quote = (text: string) => [{ sourceId: "synthetic-notes", quote: text }];

function answering(facts: readonly object[]): CanonicalProfileExtractionExecutor {
  return {
    execute: async (request) => ({
      output: { schemaVersion: 1, facts: [...facts], issues: [] },
      contextSnapshotId: request.contextSnapshotId,
      provider: "anthropic",
      company: "anthropic",
      route: "anthropic-api",
      modelId: "claude-haiku-5-5",
      providerRequestId: null,
      structuredOutputSha256: "0".repeat(64),
      usage: { inputTokens: 900, outputTokens: 400, totalTokens: 1_300 },
      cost: { estimatedUsd: null },
    }),
  };
}

const salary = {
  key: "salary",
  category: "employment-detail",
  subjectKey: "employment-tidewater",
  field: "salary",
  value: "64,000 EUR a year",
  evidence: quote("Final salary: 64,000 EUR a year."),
};
const reason = {
  key: "reason",
  category: "employment-detail",
  subjectKey: "employment-tidewater",
  field: "reason for leaving",
  value: "the Lyon office closed and I did not want to relocate",
  evidence: quote("Reason for leaving: the Lyon office closed and I did not want to relocate."),
};

describe("profile employment-detail live check (#2722)", () => {
  it("states a salary and a reason for leaving in the made-up notes", () => {
    expect(profileDetailLiveCheckNotes).toContain("Final salary");
    expect(profileDetailLiveCheckNotes).toContain("Reason for leaving");
  });

  it("passes when both come back as employment-detail facts", async () => {
    const result = await runProfileDetailLiveCheck({
      executor: answering([salary, reason]),
      controls,
    });
    expect(result).toMatchObject({
      completed: true,
      employmentDetailFacts: 2,
      salaryKept: true,
      reasonForLeavingKept: true,
      inputTokens: 900,
      passed: true,
    });
  });

  it("fails when the reason for leaving is dropped", async () => {
    const result = await runProfileDetailLiveCheck({ executor: answering([salary]), controls });
    expect(result).toMatchObject({ reasonForLeavingKept: false, passed: false });
  });

  it("refuses to run in CI", async () => {
    const errors: string[] = [];
    const code = await runProfileDetailLiveCheckCommand([], {
      environment: { CI: "true" },
      writeStderr: (value) => errors.push(value),
    });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("local-only");
  });
});
