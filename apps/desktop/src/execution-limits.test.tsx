import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import { executionLimitText, formatLimitDuration } from "./execution-limits.js";
import {
  createFixtureReviewState,
  type DesktopReviewState,
  type ReviewExecutionView,
} from "./model.js";
import { ReviewWorkspace } from "./review.js";

const authorOnSession: ReviewExecutionView = {
  status: "running",
  step: "author",
  provider: "anthropic",
  model: "claude-opus-5-5",
  attempt: 1,
  elapsedMs: 54_300,
  callLimitMs: 600_000,
  timeoutRemainingMs: null,
};

function stateWith(execution: ReviewExecutionView): DesktopReviewState {
  return { ...createFixtureReviewState(), state: "drafting", execution };
}

describe("execution limit formatting", () => {
  it("formats whole minutes as minutes and anything else as seconds", () => {
    expect(formatLimitDuration(600_000)).toBe("10 min");
    expect(formatLimitDuration(60_000)).toBe("1 min");
    expect(formatLimitDuration(90_000)).toBe("90s");
    expect(formatLimitDuration(1_500)).toBe("2s");
    expect(formatLimitDuration(0)).toBe("0s");
  });

  it("shows the call limit and says the run itself has no limit", () => {
    expect(executionLimitText(authorOnSession)).toBe(" · call limit 10 min · no run limit");
  });

  it("shows what is left of the run limit after the call limit", () => {
    expect(executionLimitText({ callLimitMs: 120_000, timeoutRemainingMs: 54_100 })).toBe(
      " · call limit 2 min · run limit in 55s",
    );
  });

  it("omits the call limit when the route sets none or the field is absent", () => {
    expect(executionLimitText({ callLimitMs: null, timeoutRemainingMs: 55_000 })).toBe(
      " · run limit in 55s",
    );
    expect(executionLimitText({ timeoutRemainingMs: null })).toBe(" · no run limit");
  });
});

describe("run-progress line", () => {
  it("names the provider call's limit instead of claiming there is no timeout", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={stateWith(authorOnSession)} onAction={() => undefined} />,
    );
    expect(html).toContain(
      "author · anthropic/claude-opus-5-5 · attempt 1 · elapsed 54s · call limit 10 min · no run limit",
    );
    expect(html).not.toContain("no timeout configured");
  });
});

/*
 * A real payload goes through the real review-state validator, so a call limit the host sends
 * reaches the renderer unchanged.
 */
describe("execution call limit over the bridge", () => {
  it("accepts a real payload with the call limit unchanged", async () => {
    const state = stateWith(authorOnSession);
    const bridge: NativeBridge = {
      capabilities: ["review.load"],
      invoke: async () => ({ ok: true, value: state }) as never,
    };
    const result = await createCapabilityPort(bridge).execute({
      type: "review.load",
      input: { workspaceId: state.workspaceId },
    });
    expect(result).toMatchObject({ ok: true, value: { execution: { callLimitMs: 600_000 } } });
  });
});
