import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function rule(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`no rule for ${selector}`);
  return styles.slice(start, styles.indexOf("}", start));
}

describe("the running bar on the review page (#1831)", () => {
  it("keeps room below the draft for the bar while a run is in progress", () => {
    expect(rule("body:has(.workspace-activity) .review-column > .claims-panel")).toContain(
      "margin-top: var(--workspace-activity-room);",
    );
    expect(rule("body:has(.workspace-activity)")).toContain("--workspace-activity-room:");
    // On a phone the bar wraps to two rows, so the room grows.
    expect(styles).toContain("--workspace-activity-room: calc(112px + var(--space-4));");
  });

  it("puts the traceability bar directly under the draft, where the room is kept", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );
    const column = html.slice(html.indexOf('class="review-column"'));
    expect(column).toContain('<section class="claims-panel"');
  });
});
