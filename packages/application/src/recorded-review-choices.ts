import type { CandidateBlockEdit } from "@draft-loop/orchestrator";
import type { DecisionRecord } from "@draft-loop/storage";

import type { FindingDecision, RecordReviewDecisionCommand } from "./index.js";

const findingDecisions: ReadonlySet<string> = new Set([
  "pending",
  "accepted",
  "rejected",
  "deferred",
  "overridden",
]);

interface RecordedReviewChoices {
  readonly decisions: ReadonlyMap<string, FindingDecision>;
  readonly edits: ReadonlyMap<string, string>;
}

/**
 * The candidate's latest decision per finding, and latest edit per block of the artifact under
 * review: an edit recorded against an earlier version does not carry over to a revision (#1900).
 */
export function recordedChoices(
  records: readonly DecisionRecord[],
  artifactId: string | undefined,
): RecordedReviewChoices {
  const decisions = new Map<string, FindingDecision>();
  const edits = new Map<string, string>();
  const ordered = [...records].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  for (const { payload, artifactId: recordArtifactId } of ordered) {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) continue;
    const { action, findingId, decision, blockId, replacementText } = payload as Readonly<
      Record<string, unknown>
    >;
    if (
      action === "finding-decision" &&
      typeof findingId === "string" &&
      typeof decision === "string" &&
      findingDecisions.has(decision)
    ) {
      decisions.set(findingId, decision as FindingDecision);
    }
    if (
      action === "edit-block" &&
      recordArtifactId === artifactId &&
      typeof blockId === "string" &&
      typeof replacementText === "string"
    )
      edits.set(blockId, replacementText);
  }
  return { decisions, edits };
}

/** The candidate's latest edit per block of one artifact version, as approval applies them. */
export function recordedReviewEdits(
  records: readonly DecisionRecord[],
  artifactId: string,
): readonly CandidateBlockEdit[] {
  return [...recordedChoices(records, artifactId).edits].map(([blockId, text]) => ({
    blockId,
    text,
  }));
}

/** The stored decision type one recorded finding decision is filed under. */
export function findingDecisionType(
  decision: Extract<RecordReviewDecisionCommand, { readonly kind: "finding" }>["decision"],
): "accept-finding" | "reject-finding" | "edit" {
  switch (decision) {
    case "accepted":
      return "accept-finding";
    case "rejected":
      return "reject-finding";
    case "deferred":
      return "edit";
    case "overridden":
      return "reject-finding";
    case "pending":
      return "edit";
  }
}
