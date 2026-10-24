import { describe, expect, it } from "vitest";

import {
  formatUsd,
  runControls,
  runError,
  runStatus,
  shouldPoll,
  startProblem,
  startRunBody,
  usageLimitWait,
} from "./run-model.js";
import { syntheticBrief, syntheticRun } from "./test-fixtures.js";

describe("run progress", () => {
  it("keeps reading an active run and stops at review or an end", () => {
    expect(shouldPoll(syntheticRun)).toBe(true);
    for (const state of ["awaiting-approval", "paused", "stopped", "approved", "exported"])
      expect(shouldPoll({ ...syntheticRun, state })).toBe(false);
  });

  it("says where the run is", () => {
    expect(runStatus(syntheticRun)).toBe("Round 1: the critic is reviewing");
    expect(runStatus({ ...syntheticRun, currentStep: null })).toBe(
      "The critic is reviewing the draft",
    );
    expect(runStatus({ ...syntheticRun, state: "awaiting-approval" })).toBe(
      "Ready for your review",
    );
  });

  it("explains a usage-limit wait and other errors", () => {
    const waiting = {
      ...syntheticRun,
      state: "paused",
      lastError: {
        code: "usage-limit",
        retryable: true,
        usageLimitResetsAt: "2026-10-23T14:30:00.000Z",
      },
    };
    expect(usageLimitWait(waiting, "en-GB")).toBe(
      "A model's usage limit was reached. The run continues after 23 Oct 2026, 14:30 UTC.",
    );
    expect(runError(waiting)).toBeUndefined();
    expect(
      runError({
        ...syntheticRun,
        lastError: { code: "provider-error", retryable: false, usageLimitResetsAt: null },
      }),
    ).toBe("The run stopped on an error (provider-error).");
    expect(
      runError({
        ...syntheticRun,
        lastError: {
          code: "rate-limit",
          retryable: true,
          usageLimitResetsAt: null,
          failedCall: {
            role: "critic",
            company: "openai",
            model: "gpt-test-critic",
            route: "openai-api",
            status: 429,
            providerErrorType: "tokens",
            providerErrorCode: "rate_limit_exceeded",
            rateLimit: "tokens",
            retryAfterSeconds: 20,
          },
        },
      }),
    ).toBe("The last step failed (rate-limit, the critic's call to openai) and will be retried.");
  });

  it("allows only the controls the state permits", () => {
    expect(runControls(syntheticRun)).toEqual({ pause: true, resume: false, stop: true });
    expect(runControls({ ...syntheticRun, state: "paused" })).toEqual({
      pause: false,
      resume: true,
      stop: true,
    });
    expect(runControls({ ...syntheticRun, state: "exported" })).toEqual({
      pause: false,
      resume: false,
      stop: false,
    });
  });

  it("formats cost", () => {
    expect(formatUsd(0.0421)).toBe("US$0.042");
    expect(formatUsd(2.5)).toBe("US$2.50");
  });
});

describe("starting a run", () => {
  it("needs a reviewed brief", () => {
    expect(startProblem(undefined)).toMatch(/Paste a job post/);
    expect(startProblem(syntheticBrief)).toBe("Mark the job brief reviewed before starting a run.");
    expect(startProblem({ ...syntheticBrief, status: "reviewed" })).toBeUndefined();
    expect(startRunBody(syntheticBrief)).toEqual({
      opportunityBrief: { briefId: "brief-1", version: 2 },
    });
  });
});
