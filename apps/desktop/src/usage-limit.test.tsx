import type { RunError, RunSnapshot } from "@draft-loop/orchestrator";
import { usageLimitView } from "@draft-loop/review-state/usage-limit-view";
import { bridgeCapabilities, createCapabilityPort, type NativeBridge } from "@draft-loop/ui/bridge";
import {
  createFixtureReviewState,
  type DesktopReviewState,
  reduceReviewState,
  type UsageLimitView,
} from "@draft-loop/ui/model";
import { ReviewWorkspace } from "@draft-loop/ui/review";
import { usageLimitText } from "@draft-loop/ui/usage-limit";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const resetsAt = "2026-10-16T15:30:00.000Z";
const limited: UsageLimitView = {
  provider: "anthropic",
  model: "claude-exact",
  step: "critic",
  resetsAt,
};

function pausedOn(usageLimit: UsageLimitView | null): DesktopReviewState {
  return { ...createFixtureReviewState(), state: "paused", usageLimit };
}

function render(state: DesktopReviewState): string {
  return renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
}

describe("usage-limit text", () => {
  it("names the provider and the time the limit resets", () => {
    expect(usageLimitText(limited, "UTC")).toBe(
      "Usage limit reached on Anthropic · try again after Oct 16, 2026, 3:30 PM",
    );
  });

  it("says later when the reset time is unknown or invalid", () => {
    expect(usageLimitText({ provider: "openai", resetsAt: null })).toBe(
      "Usage limit reached on OpenAI · try again after later",
    );
    expect(usageLimitText({ provider: "openai", resetsAt: "soon" })).toContain("after later");
  });
});

describe("paused run on a usage limit", () => {
  it("shows the reason, the interrupted step and Resume", () => {
    const html = render(pausedOn(limited));
    expect(html).toContain('aria-label="run recovery"');
    expect(html).toContain("Usage limit reached on Anthropic · try again after");
    expect(html).toContain("Resume retries the critic step where it stopped");
    expect(html).toMatch(/Resume review<\/button>/u);
  });

  it("says later when the provider reported no time", () => {
    const html = render(pausedOn({ ...limited, resetsAt: null }));
    expect(html).toContain("Usage limit reached on Anthropic · try again after later");
  });

  it("shows no usage-limit line for an ordinary pause", () => {
    expect(render(pausedOn(null))).not.toContain("Usage limit reached");
  });

  it("clears the reason when the review resumes", () => {
    const resumed = reduceReviewState(pausedOn(limited), { type: "resume" });
    expect(resumed.state).toBe("reviewing");
    expect(resumed.usageLimit).toBeNull();
  });
});

describe("usage-limit projection from the run snapshot", () => {
  const usageLimitError: RunError = {
    code: "usage-limit",
    message: "The subscription usage limit was reached.",
    provider: "anthropic",
    modelId: "claude-exact",
    step: "critic",
    attempt: 1,
    maxAttempts: 3,
    retryable: false,
    usageLimitResetsAt: resetsAt,
    providerRequestId: null,
  };

  function snapshot(overrides: Partial<RunSnapshot>): RunSnapshot {
    return {
      schemaVersion: 1,
      runId: "run-1",
      workspaceId: "workspace-1",
      contextSnapshotId: "context-1",
      state: "paused",
      round: 1,
      currentStep: "critic",
      budget: { maxRounds: 3 },
      artifact: null,
      findings: [],
      latestEvaluation: null,
      scoreHistory: [],
      executionHistory: [],
      totalCostUsd: 0,
      approval: "pending",
      startedAt: resetsAt,
      updatedAt: resetsAt,
      lastError: usageLimitError,
      ...overrides,
    };
  }

  it("projects the provider, step and reset time of a usage-limit pause", () => {
    expect(usageLimitView(snapshot({}))).toEqual(limited);
  });

  it("projects an unknown reset time as null", () => {
    const { usageLimitResetsAt: _omitted, ...error } = usageLimitError;
    expect(usageLimitView(snapshot({ lastError: error }))?.resetsAt).toBeNull();
  });

  it("projects nothing for other pauses and failures", () => {
    expect(usageLimitView(snapshot({ lastError: null }))).toBeNull();
    expect(usageLimitView(snapshot({ state: "provider-error" }))).toBeNull();
    expect(
      usageLimitView(snapshot({ lastError: { ...usageLimitError, code: "timeout" } })),
    ).toBeNull();
  });
});

describe("usage limit across the review bridge", () => {
  function portReturning(value: unknown) {
    const native: NativeBridge = {
      capabilities: bridgeCapabilities,
      invoke: async () => ({ ok: true, value }),
    };
    return createCapabilityPort(native);
  }
  const load = (state: unknown) =>
    portReturning(state).execute({
      type: "review.load",
      input: { workspaceId: createFixtureReviewState().workspaceId },
    });

  it("carries a usage limit through the real port", async () => {
    const state = pausedOn(limited);
    await expect(load(state)).resolves.toEqual({ ok: true, value: state });
    const unknownTime = pausedOn({ ...limited, resetsAt: null });
    await expect(load(unknownTime)).resolves.toEqual({ ok: true, value: unknownTime });
  });

  it("refuses a malformed usage limit", async () => {
    for (const usageLimit of [
      { ...limited, resetsAt: "tomorrow-ish" },
      { ...limited, step: "export" },
      { ...limited, extra: true },
      { ...limited, provider: "not an identifier!" },
    ]) {
      await expect(load({ ...pausedOn(null), usageLimit })).resolves.toMatchObject({ ok: false });
    }
  });
});
