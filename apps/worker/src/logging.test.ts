import type { ExecutionRecord, RunSnapshot } from "@draft-loop/orchestrator";
import { describe, expect, it } from "vitest";

import { errorFields, logLine, quarantineFields, runOutcomeFields } from "./logging.js";

/** Synthetic text standing in for anything a person might send or a model might write. */
const marker = "SYNTHETIC-CANDIDATE-TEXT";

const job = { tenantId: "tenant-a", workspaceId: "workspace-1", runId: "run-1" };

const call = (overrides: Partial<ExecutionRecord>): ExecutionRecord =>
  ({
    id: "run-1:1:author:attempt:1",
    step: "author",
    status: "completed",
    provider: "anthropic",
    modelId: "claude-sonnet-5-5",
    route: "vertex-ai",
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    estimatedUsd: 0.1,
    ...overrides,
  }) as ExecutionRecord;

/** A run carrying content where a careless logger would find it. */
const run = {
  state: "awaiting-approval",
  executionHistory: [
    call({}),
    call({ provider: "openai", modelId: "gpt-6-luna", route: "openai-api", step: "critic" }),
  ],
  lastError: { code: "provider-error", message: marker, retryable: true },
  draft: { markdown: marker },
  findings: [{ message: marker }],
} as unknown as RunSnapshot;

describe("the worker's logs", () => {
  it("log one line per job with ids, state and usage by company, model and route", () => {
    const line = JSON.parse(
      logLine("INFO", "run job finished", runOutcomeFields(job, "advanced", run)),
    ) as Record<string, unknown>;

    expect(line).toEqual({
      severity: "INFO",
      message: "run job finished",
      ...job,
      outcome: "advanced",
      state: "awaiting-approval",
      usage: {
        calls: 2,
        inputTokens: 200,
        outputTokens: 100,
        estimatedUsd: 0.2,
        unpricedCalls: 0,
        lines: [
          expect.objectContaining({ company: "anthropic", model: "claude-sonnet-5-5", calls: 1 }),
          expect.objectContaining({ company: "openai", route: "openai-api", calls: 1 }),
        ],
      },
    });
  });

  it("never carry the run's content or an error's message", () => {
    const lines = [
      logLine("INFO", "run job finished", runOutcomeFields(job, "advanced", run)),
      logLine("INFO", "run job finished", runOutcomeFields(job, "missing")),
      logLine("ERROR", "run queue error", { err: errorFields(new Error(marker)) }),
    ];

    for (const line of lines) expect(line).not.toContain(marker);
    expect(JSON.parse(lines[2] ?? "{}")).toMatchObject({
      severity: "ERROR",
      err: { type: "Error", frames: expect.any(Array) },
    });
  });

  it("name quarantined material by kind, result id and signal codes only", () => {
    const quarantined = [
      {
        kind: "job-source" as const,
        resultId: "result-1",
        signals: ["instruction-override"],
        text: marker,
      },
    ];
    const line = logLine(
      "WARNING",
      "run paused for quarantined material",
      quarantineFields(job, quarantined),
    );

    expect(JSON.parse(line)).toEqual({
      severity: "WARNING",
      message: "run paused for quarantined material",
      ...job,
      quarantined: [
        { kind: "job-source", resultId: "result-1", signals: ["instruction-override"] },
      ],
      screening: {
        tenantId: job.tenantId,
        resultIds: ["result-1"],
        signals: ["instruction-override"],
      },
    });
    expect(line).not.toContain(marker);
  });
});
