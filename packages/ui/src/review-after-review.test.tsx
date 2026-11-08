import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HostPanelsContext } from "./host-panels.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

/** The host's extras, such as the prepare panel, follow the CV and never push it down. */
describe("the panel after the CV", () => {
  const fixture = createFixtureReviewState();
  const panel = <aside id="after-review-panel">extra</aside>;

  it("follows the draft once a run exists", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={fixture} onAction={() => undefined} afterReview={panel} />,
    );
    expect(html.indexOf('id="after-review-panel"')).toBeGreaterThan(
      html.indexOf('id="artifact-review"'),
    );
  });

  it("follows the setup steps before a run", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace
        state={{ ...fixture, state: "collecting", runId: "pending" }}
        onAction={() => undefined}
        afterReview={panel}
      />,
    );
    expect(html.indexOf('id="after-review-panel"')).toBeGreaterThan(
      html.indexOf('class="panel onboarding-panel"'),
    );
  });

  it("offers a visible way to the panel when the host has one (#2578)", () => {
    const withPanel = renderToStaticMarkup(
      <HostPanelsContext.Provider value={{ application: () => panel }}>
        <ReviewWorkspace state={fixture} onAction={() => undefined} afterReview={panel} />
      </HostPanelsContext.Provider>,
    );
    expect(withPanel).toContain("doc-toolbar-prepare");
    expect(withPanel.indexOf("doc-toolbar-prepare")).toBeLessThan(
      withPanel.indexOf('id="after-review-panel"'),
    );

    const without = renderToStaticMarkup(
      <ReviewWorkspace state={fixture} onAction={() => undefined} afterReview={panel} />,
    );
    expect(without).not.toContain("doc-toolbar-prepare");
  });
});
