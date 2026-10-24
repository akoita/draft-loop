import type { ApplicationService } from "@draft-loop/application";
import {
  type ExecutionRecord,
  failedProviderCall,
  type RunSnapshot,
} from "@draft-loop/orchestrator";
import { normalizeProviderError } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { failedCallLines } from "./failed-call-logging.js";
import { createRunJobHandler } from "./run-job-handler.js";

/** Synthetic text standing in for a draft a provider quotes back in its error message. */
const marker = "SYNTHETIC-CANDIDATE-TEXT";

const job = { tenantId: "tenant-a", workspaceId: "workspace-1", runId: "run-1" };

/** An error shaped as the OpenAI SDK throws it, with the critic's draft in its message and body. */
function openAiError(status: number, body: object, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`${status} ${marker}`), {
    status,
    headers: new Headers(headers),
    error: { message: marker, ...body },
    ...body,
  });
}

/** The critic's failed execution, as the orchestrator records it from the adapter's error. */
function failedCritic(error: unknown, attempt = 1, retryable = false): ExecutionRecord {
  const normalized = normalizeProviderError("openai", error, "openai-api");
  return {
    id: `run-1:1:critic:attempt:${attempt}`,
    runId: "run-1",
    contextSnapshotId: "context-1",
    round: 1,
    step: "critic",
    status: "failed",
    provider: "openai",
    modelId: "gpt-test-critic",
    providerRequestId: null,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedUsd: null,
    completedAt: "2026-10-24T10:00:00.000Z",
    errorCode: normalized.code,
    attempt,
    maxAttempts: 3,
    retryable,
    failedCall: failedProviderCall(normalized, {
      step: "critic",
      provider: "openai",
      modelId: "gpt-test-critic",
    }),
  };
}

const run = (state: string, ...executionHistory: ExecutionRecord[]) =>
  ({
    runId: "run-1",
    state,
    executionHistory,
    lastError: executionHistory.length === 0 ? null : { code: "provider-error", message: marker },
    budget: { maxRounds: 3, maxCostUsd: 2, maxDurationMs: 600_000 },
  }) as unknown as RunSnapshot;

describe("the worker's failed-call lines", () => {
  it("log a failed critic call on the OpenAI route by role, company, model, route, status and code only", () => {
    const failed = failedCritic(
      openAiError(401, { type: "invalid_request_error", code: "invalid_api_key" }),
    );

    const lines = failedCallLines(job, run("provider-error", failed), run("reviewing"));

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        severity: "ERROR",
        message: "provider call failed",
        runId: "run-1",
        step: "critic",
        role: "critic",
        attempt: 1,
        company: "openai",
        model: "gpt-test-critic",
        route: "openai-api",
        status: 401,
        code: "authentication",
        providerErrorType: "invalid_request_error",
        providerErrorCode: "invalid_api_key",
      },
    ]);
  });

  it("say which limit refused a rate-limited call and when to retry", () => {
    const failed = failedCritic(
      openAiError(
        429,
        { type: "tokens", code: "rate_limit_exceeded" },
        { "x-ratelimit-remaining-tokens": "0", "retry-after": "20" },
      ),
      1,
      true,
    );

    const [line] = failedCallLines(job, run("provider-error", failed), run("reviewing"));

    expect(JSON.parse(line ?? "{}")).toMatchObject({
      severity: "WARNING",
      code: "rate-limit",
      status: 429,
      providerErrorCode: "rate_limit_exceeded",
      rateLimit: "tokens",
      retryAfterSeconds: 20,
    });
  });

  it("never carry the provider's message, even when it quotes candidate text", () => {
    const failed = failedCritic(
      openAiError(400, { type: `invalid ${marker}`, code: `${marker} in the draft` }),
    );

    const lines = failedCallLines(job, run("provider-error", failed), run("reviewing"));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(marker);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ code: "invalid-request", status: 400 });
  });

  it("log each failure once, in the job that met it", () => {
    const first = failedCritic(openAiError(500, {}), 1, true);
    const second = failedCritic(openAiError(500, {}), 2, true);

    expect(
      failedCallLines(job, run("provider-error", first, second), run("provider-error", first)),
    ).toHaveLength(1);
    expect(
      failedCallLines(job, run("provider-error", first), run("provider-error", first)),
    ).toEqual([]);
    expect(failedCallLines(job)).toEqual([]);
  });

  it("are given the run as the job first read it", async () => {
    const failed = failedCritic(openAiError(401, { code: "invalid_api_key" }));
    const lines: string[] = [];
    const handler = createRunJobHandler({
      serviceFor: () =>
        ({
          status: async () => run("reviewing"),
          resume: async () => run("provider-error", failed),
        }) as Pick<ApplicationService, "status" | "resume">,
      workspaceRoot: () => "/tenants/tenant-a/workspaces/workspace-1",
      allowProviderData: true,
      budgetCeiling: { maxRounds: 5, maxCostUsd: 3, maxDurationMs: 1_800_000 },
      onOutcome: (queued, _outcome, last, before) =>
        lines.push(...failedCallLines(queued, last, before)),
    });

    await handler(job, { requeue: async () => undefined });

    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ role: "critic", route: "openai-api", status: 401 }),
    ]);
  });
});
