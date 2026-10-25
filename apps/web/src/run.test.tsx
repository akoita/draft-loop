import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RunPanel, type RunPanelProps } from "./run.js";
import { noRejection, syntheticRun } from "./test-fixtures.js";

const props: RunPanelProps = {
  run: syntheticRun,
  startProblem: undefined,
  messages: [],
  busy: false,
  onStart: () => {},
  onControl: () => {},
  onReview: () => {},
};

describe("run screen", () => {
  it("offers to start the first run, or says why it cannot", () => {
    expect(renderToStaticMarkup(<RunPanel {...props} run={undefined} />)).toContain("Start a run");
    const blocked = renderToStaticMarkup(
      <RunPanel
        {...props}
        run={undefined}
        startProblem="Mark the job brief reviewed before starting a run."
      />,
    );
    expect(blocked).toContain('disabled="">Start a run</button>');
    expect(blocked).toContain("Mark the job brief reviewed before starting a run.");
  });

  it("follows an active run with its cost and routes, and offers pause and stop", () => {
    const html = renderToStaticMarkup(<RunPanel {...props} />);

    expect(html).toContain("Round 1: the critic is reviewing");
    expect(html).toContain("<dd>US$0.042</dd>");
    expect(html).toContain("author: vertex-ai, critic: openai-api");
    expect(html).toContain("Pause");
    expect(html).toContain("Stop for good");
    expect(html).not.toContain("Start another run");
    expect(html).not.toContain("Resume");
  });

  it("opens the review once the run waits for it", () => {
    const html = renderToStaticMarkup(
      <RunPanel
        {...props}
        run={{ ...syntheticRun, state: "awaiting-approval", findingCount: 3 }}
      />,
    );

    expect(html).toContain("Ready for your review");
    expect(html).toContain("Review the draft");
    expect(html).toContain("Start another run");
  });

  it("shows a usage-limit wait on a paused run, with resume", () => {
    const html = renderToStaticMarkup(
      <RunPanel
        {...props}
        run={{
          ...syntheticRun,
          state: "paused",
          lastError: {
            code: "usage-limit",
            retryable: true,
            usageLimitResetsAt: "2026-10-23T14:30:00.000Z",
            ...noRejection,
          },
          routes: [
            {
              step: "author",
              route: "anthropic-api",
              fallback: { from: "vertex-ai", cause: "quota" },
            },
          ],
        }}
      />,
    );

    expect(html).toContain("usage limit was reached");
    expect(html).toContain("Resume");
    expect(html).toContain("author: anthropic-api (fallback from vertex-ai)");
  });

  it("asks for the transmission consent above the start button", () => {
    const html = renderToStaticMarkup(
      <RunPanel {...props} run={undefined} consent={<p>Transmission consent</p>} />,
    );

    expect(html.indexOf("Transmission consent")).toBeGreaterThan(-1);
    expect(html.indexOf("Transmission consent")).toBeLessThan(html.indexOf("Start a run"));
  });

  it("shows why screening refused the start, above the actions", () => {
    const html = renderToStaticMarkup(
      <RunPanel {...props} run={undefined} quarantine={<p>The job brief is quarantined.</p>} />,
    );

    expect(html.indexOf("The job brief is quarantined.")).toBeGreaterThan(-1);
    expect(html.indexOf("The job brief is quarantined.")).toBeLessThan(html.indexOf("Start a run"));
  });
});
