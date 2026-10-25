import {
  type ApprovalReadiness,
  formatApprovalReadinessBlocker,
} from "@draft-loop/ui/approval-readiness";
import type { ReviewFinding } from "@draft-loop/ui/model";

/** The editorial warning codes `cli-critic-v4` and later report, in the order the verdict names them. */
const editorialLabels = [
  ["editorial-source-note", "copied source notes or narration"],
  ["editorial-fragment", "fragments"],
  ["editorial-negative-aside", "negative asides"],
  ["editorial-missing-evidence", "job-relevant evidence left out"],
] as const;

export interface SendVerdict {
  readonly ready: boolean;
  readonly headline: "Ready to send" | "Not ready to send yet";
  /** Plain reasons, each naming what to resolve; empty when ready. */
  readonly reasons: readonly string[];
}

/**
 * One plain verdict for the reviewed draft: whether it is ready to send, and if not, why.
 *
 * It reads what the review already decided (unresolved blocking findings, the final CV checks)
 * and adds the critic's unresolved editorial warnings, which do not block approval but are what
 * makes a grounded draft read like copied notes.
 */
export function sendVerdict(input: {
  readonly blocking: readonly ReviewFinding[];
  readonly warnings: readonly ReviewFinding[];
  readonly readiness: ApprovalReadiness | null;
}): SendVerdict {
  const reasons: string[] = [];
  if (input.blocking.length > 0) {
    reasons.push(
      `${input.blocking.length} blocking finding${input.blocking.length === 1 ? "" : "s"} to resolve`,
    );
  }
  if (input.readiness?.applicationReady === false) {
    reasons.push(...input.readiness.blockers.map(formatApprovalReadinessBlocker));
  }
  for (const [code, label] of editorialLabels) {
    const count = input.warnings.filter((finding) => finding.code === code).length;
    if (count > 0) reasons.push(`${label} (${count})`);
  }
  return reasons.length === 0
    ? { ready: true, headline: "Ready to send", reasons }
    : { ready: false, headline: "Not ready to send yet", reasons };
}
