import { createHash } from "node:crypto";

import type { ReadinessEvaluation, ReadinessFinding } from "@draft-loop/evaluations";
import type { DraftArtifact, RevisionFindingClassification } from "@draft-loop/schemas";

import { findingIdentity, targetOf } from "./finding-attribution.js";

/*
 * Stop on finding resolution, pause on persisting findings (#1113).
 *
 * The score-delta rule (`stable-convergence`) stops when scores stop moving, even when the same
 * blocking finding comes back every round. This module reads the blocking findings instead:
 *
 * - `consensus-ready`: the draft is ready and the blocking findings of the previous round are
 *   resolved. The author's fix and the critic's verdict agree.
 * - `persisting-findings`: a blocking finding with the same `findingIdentity` blocked two
 *   consecutive rounds. The run pauses for the candidate, autopilot included.
 *
 * The candidate's decision sticks: a blocking finding the candidate rejected, overrode or deferred
 * in an earlier round never causes a pause when it recurs. Only accepted or undecided findings do.
 *
 * Only an exact identity match counts. Identities use positional block keys, so a block inserted
 * between rounds can turn one finding into a resolved-plus-new pair; that is a near-miss and never
 * pauses a run.
 */

/** A finding decision the candidate recorded in the review, by the id the review gave the finding. */
export interface FindingDecisionEntry {
  readonly findingId: string;
  /** pending, accepted, rejected, deferred or overridden; the last entry for a finding wins. */
  readonly decision: string;
}

/**
 * The id the review gives the finding at `index` of a round's findings: scoped to the reviewed
 * artifact so a decision never carries over to another draft. The desktop review and the
 * persisted finding decisions use this id.
 */
export function reviewFindingId(
  run: { readonly runId: string; readonly round: number },
  artifact: Pick<DraftArtifact, "id"> | null,
  index: number,
  code: string,
): string {
  const artifactIdentity = artifact?.id ?? `round-${run.round}`;
  const scope = createHash("sha256").update(artifactIdentity).digest("hex").slice(0, 16);
  return `${run.runId}:finding:${scope}:${index}:${code}`;
}

/** Read the finding decisions out of stored decision payloads; other payloads are skipped. */
export function findingDecisionsFromPayloads(
  payloads: readonly unknown[],
): readonly FindingDecisionEntry[] {
  return payloads.flatMap((payload) => {
    if (typeof payload !== "object" || payload === null) return [];
    const { action, findingId, decision } = payload as Record<string, unknown>;
    return action === "finding-decision" &&
      typeof findingId === "string" &&
      typeof decision === "string"
      ? [{ findingId, decision }]
      : [];
  });
}

const settledDecisions: ReadonlySet<string> = new Set(["rejected", "overridden", "deferred"]);

/** The rounds of evidence the rule needs: the classification of this round's critic pass, if any. */
export interface ConsensusInput {
  readonly runId: string;
  /** The artifact the critic reviewed in this round. */
  readonly artifact: DraftArtifact;
  /** The run's findings after this critic pass, in the order the review numbers them. */
  readonly findings: readonly ReadinessFinding[];
  /** The candidate's recorded finding decisions, oldest first; empty when none are available. */
  readonly decisions?: readonly FindingDecisionEntry[];
  /** The evaluation of the round before this one, or null when this is the first round. */
  readonly previousEvaluation: ReadinessEvaluation | null | undefined;
  /** The classification of the accepted findings after this critic pass, when the round was adjudicated. */
  readonly classification?: RevisionFindingClassification | undefined;
}

export interface ConsensusAssessment {
  /** The evaluation with its final stop reason and the blocking identities of this round. */
  readonly evaluation: ReadinessEvaluation;
  /** The blocking finding identities that persisted from the previous round; empty when none did. */
  readonly persisting: readonly string[];
}

/** The exact identities of the findings that block this round. */
export function blockingFindingIdentities(
  evaluation: Pick<ReadinessEvaluation, "findings">,
  artifact: DraftArtifact,
): readonly string[] {
  const identities = new Set<string>();
  for (const finding of evaluation.findings) {
    if (finding.severity !== "error") continue;
    identities.add(
      findingIdentity({ code: finding.code, target: targetOf(artifact, finding) }, artifact),
    );
  }
  return [...identities].sort();
}

/**
 * Decide the consensus stop reason for one critic pass.
 *
 * With a classification, persisting findings are the accepted blocking findings the critic raised
 * again, so a recurrence of a finding the candidate rejected is a preserved disagreement and does
 * not count. Without one, as in autopilot rounds, the identities of the previous round's blocking
 * findings are compared with this round's.
 */
export function assessConsensus(
  evaluation: ReadinessEvaluation,
  input: ConsensusInput,
): ConsensusAssessment {
  const blocking = blockingFindingIdentities(evaluation, input.artifact);
  const previous = input.previousEvaluation;
  const consecutive = previous?.round === evaluation.round - 1;
  const previousBlocking = consecutive ? (previous?.blockingFindingIdentities ?? []) : [];
  const refs = input.findings.flatMap((finding, index) =>
    finding.severity === "error"
      ? [
          {
            identity: findingIdentity(
              { code: finding.code, target: targetOf(input.artifact, finding) },
              input.artifact,
            ),
            findingId: reviewFindingId(
              { runId: input.runId, round: evaluation.round },
              input.artifact,
              index,
              finding.code,
            ),
          },
        ]
      : [],
  );
  // Decisions were made on the previous round's findings; carry each settled identity forward.
  const latestDecision = new Map(
    (input.decisions ?? []).map(({ findingId, decision }) => [findingId, decision]),
  );
  const settled = new Set(previous?.settledFindingIdentities ?? []);
  for (const { identity, findingId } of previous?.blockingFindingRefs ?? []) {
    const decision = latestDecision.get(findingId);
    if (decision !== undefined && settledDecisions.has(decision)) settled.add(identity);
    else if (decision === "accepted") settled.delete(identity);
  }

  let persisting: readonly string[];
  let resolved: number;
  if (input.classification !== undefined) {
    const accepted = input.classification.findings.filter(({ severity }) => severity === "error");
    persisting = [
      ...new Set(
        accepted
          .filter(({ status }) => status === "persisting")
          .map((entry) => entry.findingIdentity),
      ),
    ].sort();
    resolved = accepted.filter(({ status }) => status === "resolved").length;
  } else {
    const current = new Set(blocking);
    persisting = previousBlocking.filter(
      (identity) => current.has(identity) && !settled.has(identity),
    );
    resolved = previousBlocking.filter((identity) => !current.has(identity)).length;
  }

  let stopReason = evaluation.stopReason;
  if (evaluation.ready && resolved > 0) {
    stopReason = "consensus-ready";
  } else if (stopReason === "blocked-findings" && persisting.length > 0) {
    stopReason = "persisting-findings";
  }
  return {
    evaluation: {
      ...evaluation,
      stopReason,
      blockingFindingIdentities: blocking,
      blockingFindingRefs: refs,
      settledFindingIdentities: [...settled].sort(),
      persistingFindingIdentities: persisting,
    },
    persisting,
  };
}
