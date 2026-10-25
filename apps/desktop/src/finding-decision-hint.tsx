import type { ReviewFinding } from "@draft-loop/ui/model";
import type { JSX } from "react";
import {
  ACCEPT_UNAVAILABLE_NOTE,
  acceptUnavailable,
  type ExplainedFindingDecision,
  type FindingDecisionContext,
  findingDecisionEffects,
} from "./finding-decision-help.js";

const hintLabels: Readonly<Record<ExplainedFindingDecision, string>> = {
  accepted: "Accept",
  rejected: "Reject",
  overridden: "Override",
  deferred: "Defer",
};

const hintOrder: readonly ExplainedFindingDecision[] = [
  "accepted",
  "rejected",
  "overridden",
  "deferred",
];

/** The element id that describes one decision button; buttons point at it with aria-describedby. */
export function findingDecisionHintId(baseId: string, decision: ExplainedFindingDecision): string {
  return `${baseId}-effect-${decision}`;
}

export function findingAcceptGuardId(baseId: string): string {
  return `${baseId}-accept-guard`;
}

/**
 * A quiet, one-line-per-decision explanation of what each decision does to the
 * next revision and to approval, plus the reason Accept is unavailable when no
 * revision can fix a blocking finding.
 */
export function FindingDecisionHint({
  finding,
  context,
  baseId,
}: {
  readonly finding: Pick<ReviewFinding, "severity">;
  readonly context: FindingDecisionContext;
  readonly baseId: string;
}): JSX.Element {
  const effects = findingDecisionEffects(finding, context);
  return (
    <>
      {acceptUnavailable(finding, context) ? (
        <p className="finding-accept-guard" id={findingAcceptGuardId(baseId)}>
          {ACCEPT_UNAVAILABLE_NOTE}
        </p>
      ) : null}
      <ul className="finding-decision-hint" aria-label="What each decision does">
        {hintOrder.map((decision) => (
          <li id={findingDecisionHintId(baseId, decision)} key={decision}>
            <strong>{hintLabels[decision]}:</strong> {effects[decision]}
          </li>
        ))}
      </ul>
    </>
  );
}
