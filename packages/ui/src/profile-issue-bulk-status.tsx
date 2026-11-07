import type {
  CanonicalCandidateProfileIssueSeverity,
  CanonicalCandidateProfileIssueStatus,
} from "@draft-loop/domain";
import { t } from "@lingui/core/macro";
import type { CanonicalCandidateProfileIssueResult } from "./bridge.js";

const bulkStatusOptions = (): readonly (readonly [
  CanonicalCandidateProfileIssueStatus,
  string,
])[] => [
  ["open", t`Open`],
  ["acknowledged", t`Acknowledged`],
  ["resolved", t`Resolved`],
];

/** Applies one status to every issue of a severity so long duplicate lists need one action. */
export function ProfileIssueBulkStatus({
  severity,
  issues,
  editable,
  onIssueStatusChange,
}: {
  readonly severity: CanonicalCandidateProfileIssueSeverity;
  readonly issues: readonly CanonicalCandidateProfileIssueResult[];
  readonly editable: boolean;
  readonly onIssueStatusChange: (
    issueId: string,
    status: CanonicalCandidateProfileIssueStatus,
  ) => void;
}) {
  if (issues.length < 2) return null;
  return (
    <fieldset
      className="profile-issue-bulk"
      aria-label={t`Set status for all ${issues.length} ${severity} issues`}
    >
      <span>
        {t`Set all`} {issues.length}:
      </span>
      {bulkStatusOptions().map(([status, label]) => (
        <button
          key={status}
          className="button button-outline"
          type="button"
          disabled={!editable || issues.every((issue) => issue.status === status)}
          onClick={() => {
            for (const issue of issues) {
              if (issue.status !== status) onIssueStatusChange(issue.id, status);
            }
          }}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
