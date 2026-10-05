import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createFixtureReviewState, reduceReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const autopilotInput = (html: string): string =>
  html.match(/<input type="checkbox"[^>]*>\s*Autopilot/u)?.[0] ?? "";

const withAutopilot = (autopilot: boolean | undefined) => {
  const state = createFixtureReviewState();
  const { autopilot: _autopilot, ...setup } = state.setup;
  return { ...state, setup: autopilot === undefined ? setup : { ...setup, autopilot } };
};

describe("autopilot toggle", () => {
  it("shows the workspace setting, off by default, with the round limit", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={withAutopilot(false)} onAction={() => undefined} />,
    );

    expect(html).toContain("Autopilot: run all 2 rounds without stopping");
    expect(html).toContain("a claim is disputed");
    expect(autopilotInput(html)).not.toBe("");
    expect(autopilotInput(html)).not.toContain('checked=""');
  });

  it("shows the setting as on when the workspace enables it", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={withAutopilot(true)} onAction={() => undefined} />,
    );

    expect(autopilotInput(html)).toContain('checked=""');
  });

  it("hides the setting when the host does not report it", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={withAutopilot(undefined)} onAction={() => undefined} />,
    );

    expect(html).not.toContain("Autopilot");
  });

  it("reflects a toggle immediately in the local state", () => {
    const state = withAutopilot(false);

    expect(reduceReviewState(state, { type: "set-autopilot", enabled: true }).setup.autopilot).toBe(
      true,
    );
  });
});
