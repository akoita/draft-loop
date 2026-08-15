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
    expect(html).toContain('aria-label="claim to source inspection"');
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

  it("renders content-free provider recovery choices and blocks approval/export", () => {
    const state = {
      ...createFixtureReviewState(),
      state: "provider-error" as const,
      providerFailure: {
        code: "authentication" as const,
        explanation: "The provider could not authenticate. Check the configured credential.",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        step: "author" as const,
        attempt: 1,
        maxAttempts: 3,
        retryAvailable: false,
        availableActions: ["return-to-review", "stop"] as const,
        diagnostics: [],
      },
    };
    const html = renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);

    expect(html).toContain('aria-label="provider failure"');
    expect(html).toContain("The provider could not authenticate");
    expect(html).toContain("Return to review");
    expect(html).toContain("Stop run");
    expect(html).not.toContain(">Retry<");
    expect(html).toMatch(/Approve artifact[^<]*<\/button>/u);
    expect(html).toContain("disabled");
  });
});
