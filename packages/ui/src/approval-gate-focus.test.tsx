import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  approvalAttemptNeedsGate,
  approvalBlockerId,
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
  it("sends an approval attempt to the footer's blocker only while final CV checks block it", () => {
    expect(approvalAttemptNeedsGate(blocked, "pending")).toBe(true);
    expect(approvalAttemptNeedsGate(blocked, "rejected")).toBe(true);
    expect(approvalAttemptNeedsGate({ ...blocked, applicationReady: true }, "pending")).toBe(false);
    expect(approvalAttemptNeedsGate(null, "pending")).toBe(false);
    expect(approvalAttemptNeedsGate(blocked, "approved")).toBe(false);
  });

  it("scrolls the blocker line into view and focuses it", () => {
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const documentRef = {
      getElementById: (id: string) => (id === approvalBlockerId ? { scrollIntoView, focus } : null),
    } as unknown as Document;

    expect(focusApprovalGate(documentRef)).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(focusApprovalGate({ getElementById: () => null } as unknown as Document)).toBe(false);
  });

  it("renders the footer's blocker line as a programmatic focus target", () => {
    const html = renderToStaticMarkup(
      <ReviewWorkspace state={createFixtureReviewState()} onAction={() => undefined} />,
    );

    expect(html).toMatch(
      new RegExp(`<p id="${approvalBlockerId}" class="gate-blocker [^"]+" tabindex="-1"`, "u"),
    );
    expect(html).not.toContain("Human approval gate");
    expect(html).not.toContain("approval-gate-heading");
  });
});
