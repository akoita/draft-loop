import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DisplayPreferenceProvider } from "./display-preference.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

function guided(state: ReturnType<typeof createFixtureReviewState>): string {
  return renderToStaticMarkup(
    <DisplayPreferenceProvider value={{ preference: { mode: "guided", guideHidden: false } }}>
      <ReviewWorkspace state={state} onAction={() => undefined} />
    </DisplayPreferenceProvider>,
  );
}

describe("the review screen's guided hint", () => {
  const hint = "Accept or reject each one, then select Approve artifact.";

  it("asks to read the draft when there is one", () => {
    expect(guided(createFixtureReviewState())).toContain(hint);
  });

  it("says nothing about reading a draft when the run has none", () => {
    const fixture = createFixtureReviewState();
    const empty = { ...fixture, artifact: { ...fixture.artifact, version: 0 } };
    expect(guided(empty)).not.toContain(hint);
  });

  it("waits while the review is still running", () => {
    const fixture = createFixtureReviewState();
    const running = { ...fixture, execution: { ...fixture.execution, status: "running" as const } };
    expect(guided(running)).not.toContain(hint);
  });
});
