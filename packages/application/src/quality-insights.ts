import type { QualityDigest } from "./quality-digest.js";
import type { QualityTrend } from "./quality-trend.js";

/**
 * The outer loop's insight ledger (#2917): each recurring pattern in the daily quality digests,
 * keyed by its mechanism, with when it was first and last seen and its status. A pattern unseen for
 * 14 days is resolved; one seen again after that is recurring; a dismissed one stays dismissed, so
 * the morning diagnosis never reports it as new again. Keys hold codes and model ids only.
 */

export const qualityInsightStatuses = ["new", "recurring", "resolved", "dismissed"] as const;
export type QualityInsightStatus = (typeof qualityInsightStatuses)[number];

export interface QualityInsight {
  /** The mechanism, such as `failure:author:<model>:invalid-response:max_tokens`. */
  readonly key: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly daysSeen: number;
  readonly occurrences: number;
  /** Up to three runs from the last day it was seen. */
  readonly runIds: readonly string[];
  readonly status: QualityInsightStatus;
  /** The GitHub issue filed for it, once one is. */
  readonly issue: number | null;
}

export interface QualityInsightChange {
  readonly key: string;
  readonly from: QualityInsightStatus | null;
  readonly to: QualityInsightStatus;
}

/** A pattern the owner chose not to act on, or one already tracked by an issue. */
export interface QualityInsightDismissal {
  readonly key: string;
  readonly reason: string;
  readonly issue?: number;
}

/**
 * Dismissed patterns. Add one by PR when the owner says a pattern needs nothing, or link an issue
 * to a pattern it tracks; the next digest applies it.
 */
export const qualityInsightDismissals: readonly QualityInsightDismissal[] = [];

export const insightResolveAfterDays = 14;

interface Observation {
  readonly key: string;
  readonly occurrences: number;
  readonly runIds: readonly string[];
}

/** The patterns one digest shows. */
export function insightObservations(
  digest: QualityDigest,
  trend?: QualityTrend,
): readonly Observation[] {
  const observations: Observation[] = digest.failures.map((failure) => ({
    key: [
      "failure",
      failure.step,
      failure.model,
      failure.errorType,
      failure.failureReason ?? failure.failureStage ?? "none",
    ].join(":"),
    occurrences: failure.count,
    runIds: failure.runIds,
  }));
  for (const rejection of digest.patchRejections) {
    observations.push({
      key: `patch-rejection:${rejection.code}`,
      occurrences: rejection.count,
      runIds: [],
    });
  }
  if (digest.retrieval.empty > 0) {
    observations.push({ key: "retrieval:empty", occurrences: digest.retrieval.empty, runIds: [] });
  }
  if (digest.retrieval.singleSource > 0) {
    observations.push({
      key: "retrieval:single-source",
      occurrences: digest.retrieval.singleSource,
      runIds: [],
    });
  }
  // A week whose quality fell against the week before (#3240), per model pair and metric.
  for (const pair of trend?.pairs ?? []) {
    for (const metric of pair.drops) {
      observations.push({
        key: `quality-drop:${metric}:${pair.authorModel}:${pair.criticModel}`,
        occurrences: pair.current.runs,
        runIds: [],
      });
    }
  }
  return observations;
}

const dayMs = 24 * 60 * 60 * 1000;
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);

/** The ledger after one day's digest: the rows to save and how their statuses changed. */
export function nextQualityInsights(input: {
  readonly day: string;
  readonly existing: readonly QualityInsight[];
  readonly observations: readonly Observation[];
  readonly dismissals?: readonly QualityInsightDismissal[];
}): {
  readonly insights: readonly QualityInsight[];
  readonly changes: readonly QualityInsightChange[];
} {
  const dismissals = new Map(
    (input.dismissals ?? qualityInsightDismissals).map((dismissal) => [dismissal.key, dismissal]),
  );
  const existing = new Map(input.existing.map((insight) => [insight.key, insight]));
  const insights: QualityInsight[] = [];
  const changes: QualityInsightChange[] = [];
  const seen = new Set<string>();

  const record = (previous: QualityInsight | undefined, next: QualityInsight) => {
    insights.push(next);
    if (previous?.status !== next.status) {
      changes.push({ key: next.key, from: previous?.status ?? null, to: next.status });
    }
  };

  for (const observation of input.observations) {
    seen.add(observation.key);
    const previous = existing.get(observation.key);
    const dismissal = dismissals.get(observation.key);
    const status: QualityInsightStatus =
      dismissal !== undefined || previous?.status === "dismissed"
        ? "dismissed"
        : previous === undefined
          ? "new"
          : previous.status === "new" && previous.lastSeen === input.day
            ? "new"
            : "recurring";
    record(previous, {
      key: observation.key,
      firstSeen: previous?.firstSeen ?? input.day,
      lastSeen: input.day,
      daysSeen: (previous?.daysSeen ?? 0) + (previous?.lastSeen === input.day ? 0 : 1),
      occurrences: (previous?.occurrences ?? 0) + observation.occurrences,
      runIds: observation.runIds.slice(0, 3),
      status,
      issue: dismissal?.issue ?? previous?.issue ?? null,
    });
  }

  for (const previous of input.existing) {
    if (seen.has(previous.key)) continue;
    const dismissal = dismissals.get(previous.key);
    const stale =
      (previous.status === "new" || previous.status === "recurring") &&
      daysBetween(previous.lastSeen, input.day) >= insightResolveAfterDays;
    const status: QualityInsightStatus =
      dismissal !== undefined ? "dismissed" : stale ? "resolved" : previous.status;
    const issue = dismissal?.issue ?? previous.issue;
    if (status !== previous.status || issue !== previous.issue) {
      record(previous, { ...previous, status, issue });
    }
  }

  return { insights, changes };
}
