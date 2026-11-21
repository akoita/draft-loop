import type { RunSpanAttributes, RunSpanName } from "@draft-loop/domain/run-span";

/**
 * Output quality in the daily digest (#3240): each day's `evaluate_run` spans reduced by author
 * and critic model, then the last seven days compared with the seven before, so the outer loop
 * sees a quality drop and not only failures. Scores, counts and model ids only.
 */

export interface DigestQualityPair {
  readonly authorModel: string;
  readonly criticModel: string;
  /** Runs that reached review or stopped that day. */
  readonly runs: number;
  /** Of those, the runs the critic found ready. */
  readonly ready: number;
  /** Sums, so days add up before averaging. */
  readonly readinessSum: number;
  readonly readinessRuns: number;
  readonly uncoveredSum: number;
  readonly errorFindingsSum: number;
  readonly estimatedUsd: number;
}

export interface DigestQuality {
  readonly runs: number;
  readonly ready: number;
  readonly estimatedUsd: number;
  /** The day's evaluated runs' cost divided by its ready drafts; `null` without one. */
  readonly costPerReadyDraft: number | null;
  readonly pairs: readonly DigestQualityPair[];
}

interface QualitySpan {
  readonly name: RunSpanName;
  readonly attributes: RunSpanAttributes;
}

const text = (value: unknown): string =>
  typeof value === "string" && value !== "" ? value : "unknown";

const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const round = (value: number, places = 4): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Reduces one day's spans to its quality section. */
export function digestQuality(spans: readonly QualitySpan[]): DigestQuality {
  const pairs = new Map<string, DigestQualityPair>();
  for (const span of spans) {
    if (span.name !== "evaluate_run") continue;
    const a = span.attributes;
    const authorModel = text(a["draftloop.quality.author_model"]);
    const criticModel = text(a["gen_ai.request.model"]);
    const key = `${authorModel}\u0000${criticModel}`;
    const pair = pairs.get(key) ?? {
      authorModel,
      criticModel,
      runs: 0,
      ready: 0,
      readinessSum: 0,
      readinessRuns: 0,
      uncoveredSum: 0,
      errorFindingsSum: 0,
      estimatedUsd: 0,
    };
    const readiness = number(a["draftloop.quality.readiness"]);
    pairs.set(key, {
      ...pair,
      runs: pair.runs + 1,
      ready: pair.ready + (a["draftloop.quality.ready"] === true ? 1 : 0),
      readinessSum: pair.readinessSum + (readiness ?? 0),
      readinessRuns: pair.readinessRuns + (readiness === undefined ? 0 : 1),
      uncoveredSum: pair.uncoveredSum + (number(a["draftloop.quality.uncovered"]) ?? 0),
      errorFindingsSum:
        pair.errorFindingsSum + (number(a["draftloop.quality.error_findings"]) ?? 0),
      estimatedUsd: pair.estimatedUsd + (number(a["draftloop.estimated_usd"]) ?? 0),
    });
  }
  const sorted = [...pairs.values()]
    .map((pair) => ({
      ...pair,
      readinessSum: round(pair.readinessSum),
      estimatedUsd: round(pair.estimatedUsd),
    }))
    .sort(
      (a, b) =>
        b.runs - a.runs ||
        a.authorModel.localeCompare(b.authorModel) ||
        a.criticModel.localeCompare(b.criticModel),
    );
  const runs = sorted.reduce((sum, pair) => sum + pair.runs, 0);
  const ready = sorted.reduce((sum, pair) => sum + pair.ready, 0);
  const estimatedUsd = round(sorted.reduce((sum, pair) => sum + pair.estimatedUsd, 0));
  return {
    runs,
    ready,
    estimatedUsd,
    costPerReadyDraft: ready === 0 ? null : round(estimatedUsd / ready),
    pairs: sorted,
  };
}

/** One model pair's week: rates and means over the runs that reached review. */
export interface QualityWeek {
  readonly runs: number;
  readonly readyRate: number | null;
  readonly readiness: number | null;
  readonly uncovered: number | null;
  readonly errorFindings: number | null;
}

export type QualityTrendMetric = "ready-rate" | "readiness";

export interface QualityTrendPair {
  readonly authorModel: string;
  readonly criticModel: string;
  readonly current: QualityWeek;
  readonly previous: QualityWeek;
  /** Metrics that fell by more than the threshold, with enough runs in both weeks. */
  readonly drops: readonly QualityTrendMetric[];
}

export interface QualityTrend {
  /** The last day of the current week, as YYYY-MM-DD. */
  readonly through: string;
  readonly pairs: readonly QualityTrendPair[];
}

/** A drop counts when a week's value is this much lower than the week before, relatively. */
export const qualityDropThreshold = 0.05;
/** Each week needs this many runs of a pair before its drop counts. */
export const minimumTrendRuns = 5;

const dayMs = 24 * 60 * 60 * 1000;

function week(pairs: readonly DigestQualityPair[]): QualityWeek {
  const runs = pairs.reduce((sum, pair) => sum + pair.runs, 0);
  const readinessRuns = pairs.reduce((sum, pair) => sum + pair.readinessRuns, 0);
  const sum = (field: "ready" | "readinessSum" | "uncoveredSum" | "errorFindingsSum") =>
    pairs.reduce((total, pair) => total + pair[field], 0);
  return {
    runs,
    readyRate: runs === 0 ? null : round(sum("ready") / runs),
    readiness: readinessRuns === 0 ? null : round(sum("readinessSum") / readinessRuns),
    uncovered: runs === 0 ? null : round(sum("uncoveredSum") / runs),
    errorFindings: runs === 0 ? null : round(sum("errorFindingsSum") / runs),
  };
}

const dropped = (current: number | null, previous: number | null): boolean =>
  current !== null &&
  previous !== null &&
  previous > 0 &&
  (previous - current) / previous > qualityDropThreshold;

/**
 * Compares the seven days through `through` with the seven before, per model pair. Days whose
 * stored digest predates the quality section count as days with no evaluated runs.
 */
export function qualityTrend(
  through: string,
  days: readonly { readonly day: string; readonly quality?: DigestQuality }[],
): QualityTrend {
  const end = Date.parse(`${through}T00:00:00.000Z`);
  const byPair = new Map<
    string,
    {
      authorModel: string;
      criticModel: string;
      current: DigestQualityPair[];
      previous: DigestQualityPair[];
    }
  >();
  for (const day of days) {
    const age = Math.round((end - Date.parse(`${day.day}T00:00:00.000Z`)) / dayMs);
    if (!(age >= 0 && age < 14)) continue;
    const saved = day.quality?.pairs;
    for (const pair of Array.isArray(saved) ? saved : []) {
      const key = `${pair.authorModel}\u0000${pair.criticModel}`;
      const entry = byPair.get(key) ?? {
        authorModel: pair.authorModel,
        criticModel: pair.criticModel,
        current: [],
        previous: [],
      };
      (age < 7 ? entry.current : entry.previous).push(pair);
      byPair.set(key, entry);
    }
  }
  const pairs = [...byPair.values()].map((entry) => {
    const current = week(entry.current);
    const previous = week(entry.previous);
    const enough = current.runs >= minimumTrendRuns && previous.runs >= minimumTrendRuns;
    const drops: QualityTrendMetric[] = [];
    if (enough && dropped(current.readyRate, previous.readyRate)) drops.push("ready-rate");
    if (enough && dropped(current.readiness, previous.readiness)) drops.push("readiness");
    return {
      authorModel: entry.authorModel,
      criticModel: entry.criticModel,
      current,
      previous,
      drops,
    };
  });
  pairs.sort(
    (a, b) =>
      b.current.runs - a.current.runs ||
      a.authorModel.localeCompare(b.authorModel) ||
      a.criticModel.localeCompare(b.criticModel),
  );
  return { through, pairs };
}
