import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createFixtureReviewState } from "./model.js";
import { RunDetailsDrawer } from "./run-details.js";
import { formatEstimatedUsd, RunStepsList } from "./run-steps.js";
import type { RunStepAdvance } from "./run-steps-model.js";

const advances: readonly RunStepAdvance[] = [
  {
    spanId: "w1",
    startedAt: "2026-11-11T12:00:00.000Z",
    durationMs: 50_000,
    failed: true,
    attempts: [
      {
        spanId: "a1",
        step: "author",
        round: 1,
        attempt: 1,
        durationMs: 30_000,
        model: "claude-sonnet-5-5",
        estimatedUsd: 0.12,
        failed: false,
        errorType: null,
      },
      {
        spanId: "a2",
        step: "critic",
        round: 1,
        attempt: 2,
        durationMs: null,
        model: null,
        estimatedUsd: 0.004,
        failed: true,
        errorType: "rate-limited",
      },
    ],
  },
];

describe("RunStepsList", () => {
  it("lists each attempt with its model, duration, cost and failure, folded by default", () => {
    const markup = renderToStaticMarkup(<RunStepsList advances={advances} />);
    expect(markup).toContain('<details class="run-steps">');
    expect(markup).not.toContain("<details open");
    expect(markup).toContain("2 model calls");
    expect(markup).toContain("about $0.12");
    expect(markup).toContain("one or more failed");
    expect(markup).toContain("Author");
    expect(markup).toContain("30 s");
    expect(markup).toContain("Critic");
    expect(markup).toContain("attempt 2");
    expect(markup).toContain("not finished");
    expect(markup).toContain("about $0.004");
    expect(markup).toContain("Failed: rate-limited");
  });

  it("renders nothing for a run with no recorded step", () => {
    expect(renderToStaticMarkup(<RunStepsList advances={[]} />)).toBe("");
  });

  it("formats small estimates to a tenth of a cent", () => {
    expect(formatEstimatedUsd(1.234)).toBe("$1.23");
    expect(formatEstimatedUsd(0.0042)).toBe("$0.004");
    expect(formatEstimatedUsd(0)).toBe("$0.00");
  });
});

describe("RunDetailsDrawer steps", () => {
  it("shows no Steps section before a trace is read, with or without the capability", () => {
    const drawer = (loadTrace?: () => Promise<readonly []>) =>
      renderToStaticMarkup(
        <RunDetailsDrawer
          id="run-details"
          open
          onClose={() => undefined}
          returnFocusRef={createRef<HTMLElement>()}
          state={createFixtureReviewState()}
          describeState={(state) => state}
          start={null}
          autopilot={null}
          {...(loadTrace === undefined ? {} : { loadTrace })}
        />,
      );
    expect(drawer()).not.toContain("run-steps");
    expect(drawer(async () => [])).not.toContain("run-steps");
  });
});
