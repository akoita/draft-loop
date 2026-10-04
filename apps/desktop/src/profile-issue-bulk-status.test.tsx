import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CanonicalCandidateProfileIssueResult } from "./bridge.js";
import { ProfileIssueBulkStatus } from "./profile-issue-bulk-status.js";

function warning(
  id: string,
  status: CanonicalCandidateProfileIssueResult["status"],
): CanonicalCandidateProfileIssueResult {
  return {
    id,
    code: "duplicate",
    severity: "warning",
    status,
    message: "Candidate-provided sources contain a possible duplicate record.",
    factIds: [],
    sourceRefs: [],
  };
}

const warnings = [warning("w-1", "open"), warning("w-2", "open"), warning("w-3", "resolved")];

function buttons(element: ReactElement | null): ReactElement<{
  readonly children: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}>[] {
  const props = element?.props as { readonly children: readonly unknown[] } | undefined;
  return (props?.children[1] ?? []) as ReturnType<typeof buttons>;
}

describe("profile issue bulk status", () => {
  it("sets every issue of a severity that does not already have the chosen status", () => {
    const onIssueStatusChange = vi.fn();
    const element = ProfileIssueBulkStatus({
      severity: "warning",
      issues: warnings,
      editable: true,
      onIssueStatusChange,
    });
    const acknowledged = buttons(element).find(
      (button) => button.props.children === "Acknowledged",
    );
    acknowledged?.props.onClick();

    expect(onIssueStatusChange.mock.calls).toEqual([
      ["w-1", "acknowledged"],
      ["w-2", "acknowledged"],
      ["w-3", "acknowledged"],
    ]);
  });

  it("renders an accessible group and disables no-op or read-only choices", () => {
    const html = renderToStaticMarkup(
      <ProfileIssueBulkStatus
        severity="warning"
        issues={warnings.map((issue) => ({ ...issue, status: "resolved" as const }))}
        editable
        onIssueStatusChange={() => undefined}
      />,
    );
    expect(html).toContain('aria-label="Set status for all 3 warning issues"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Resolved/u);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Open/u);

    const readOnly = renderToStaticMarkup(
      <ProfileIssueBulkStatus
        severity="error"
        issues={warnings}
        editable={false}
        onIssueStatusChange={() => undefined}
      />,
    );
    expect(readOnly.match(/disabled=""/gu)).toHaveLength(3);
  });

  it("omits the control when a severity has a single issue", () => {
    expect(
      ProfileIssueBulkStatus({
        severity: "error",
        issues: warnings.slice(0, 1),
        editable: true,
        onIssueStatusChange: () => undefined,
      }),
    ).toBeNull();
  });
});
