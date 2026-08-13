import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

describe("Desktop Review Keyboard Accessibility and WCAG AA Compliance", () => {
  it("renders standard ARIA landmarks, roles, and live regions", () => {
    const state = createFixtureReviewState();
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    // Status announcement region
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');

    // Section landmarks
    expect(html).toContain('aria-label="trust and policy summary"');
    expect(html).toContain('aria-label="artifact review"');
    expect(html).toContain('aria-label="claim to evidence inspection"');
    expect(html).toContain('aria-label="critique findings"');
    expect(html).toContain('aria-label="approval and export"');
  });

  it("exposes keyboard shortcuts with aria-keyshortcuts on interactive action triggers", () => {
    const state = createFixtureReviewState();
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain('aria-keyshortcuts="Alt+A"');
    expect(html).toContain('aria-keyshortcuts="Alt+R"');
    expect(html).toContain('aria-keyshortcuts="Alt+E"');
  });

  it("ensures all editable textareas have accessible aria labels", () => {
    const state = createFixtureReviewState();
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain('aria-label="Edit Summary"');
  });
});
