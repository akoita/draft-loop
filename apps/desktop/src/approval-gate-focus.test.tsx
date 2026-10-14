import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  approvalAttemptNeedsGate,
  approvalGateHeadingId,
  focusApprovalGate,
} from "./approval-gate-focus.js";
import type { ApprovalReadiness } from "./approval-readiness.js";
import { createFixtureReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";

const blocked: ApprovalReadiness = {
  artifactId: "artifact-1",
  artifactVersion: 2,
  applicationReady: false,
  blockers: [
    { code: "unmet-rubric-threshold", dimension: "relevance", score: 0.22, threshold: 0.8 },
  ],
};

describe("approval gate focus", () => {
  it("sends an approval attempt to the gate only while final CV checks block it", () => {
    expect(approvalAttemptNeedsGate(blocked, "pending")).toBe(true);
    expect(approvalAttemptNeedsGate(blocked, "rejected")).toBe(true);
    expect(approvalAttemptNeedsGate({ ...blocked, applicationReady: true }, "pending")).toBe(false);
    expect(approvalAttemptNeedsGate(null, "pending")).toBe(false);
    expect(approvalAttemptNeedsGate(blocked, "approved")).toBe(false);
  });

  it("scrolls the gate into view and focuses its heading", () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const documentRef = {
      getElementById: (id: string) =>
        id === approvalGateHeadingId ? { scrollIntoView, focus } : null,
    } as unknown as Document;

    expect(focusApprovalGate(documentRef)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(focusApprovalGate({ getElementById: () => null } as unknown as Document)).toBe(false);
  });

  it("renders the gate heading as a programmatic focus target", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );

    expect(html).toContain(
      `<h2 id="${approvalGateHeadingId}" tabindex="-1">Human approval gate</h2>`,
    );
  });
});
