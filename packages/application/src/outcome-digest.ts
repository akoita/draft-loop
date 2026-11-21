/**
 * Member outcomes in the daily digest (#3245): what members did with their drafts that day,
 * counted by author and critic model where the run is known, so a quality drop reads against real
 * outcomes and not only the critic's view. Counts and model ids only: no finding text, note text
 * or ids leave this module.
 */

export const digestOutcomeKinds = [
  "finding-accepted",
  "finding-rejected",
  "exported",
  "refunded",
  "stopped",
] as const;

export type DigestOutcomeKind = (typeof digestOutcomeKinds)[number];

/** One thing a member did, or one thing that happened to their run, that day. */
export interface DigestOutcomeEvent {
  readonly runId: string;
  readonly kind: DigestOutcomeKind;
}

/** The author and critic models a run was evaluated with, from its `evaluate_run` span. */
export interface DigestRunPair {
  readonly runId: string;
  readonly authorModel: string;
  readonly criticModel: string;
}

export interface DigestOutcomeCounts {
  readonly findingsAccepted: number;
  readonly findingsRejected: number;
  readonly exported: number;
  readonly refunded: number;
  /** Runs stopped or out of budget before approval. */
  readonly stopped: number;
}

export interface DigestOutcomePair extends DigestOutcomeCounts {
  /** `unknown` when the run has no evaluation to name its models. */
  readonly authorModel: string;
  readonly criticModel: string;
}

export interface DigestOutcomes {
  /** Feedback notes members sent that day, in every organisation. */
  readonly feedbackNotes: number;
  readonly pairs: readonly DigestOutcomePair[];
}

const field: Record<DigestOutcomeKind, keyof DigestOutcomeCounts> = {
  "finding-accepted": "findingsAccepted",
  "finding-rejected": "findingsRejected",
  exported: "exported",
  refunded: "refunded",
  stopped: "stopped",
};

export const noOutcomes: DigestOutcomeCounts = {
  findingsAccepted: 0,
  findingsRejected: 0,
  exported: 0,
  refunded: 0,
  stopped: 0,
};

/** Reduces one day's outcome events to counts per model pair. */
export function digestOutcomes(input: {
  readonly events: readonly DigestOutcomeEvent[];
  readonly runPairs: readonly DigestRunPair[];
  readonly feedbackNotes: number;
}): DigestOutcomes {
  const pairOf = new Map(input.runPairs.map((pair) => [pair.runId, pair]));
  const pairs = new Map<string, DigestOutcomePair>();
  for (const event of input.events) {
    const known = pairOf.get(event.runId);
    const authorModel = known?.authorModel ?? "unknown";
    const criticModel = known?.criticModel ?? "unknown";
    const key = `${authorModel}\u0000${criticModel}`;
    const pair = pairs.get(key) ?? { authorModel, criticModel, ...noOutcomes };
    const name = field[event.kind];
    pairs.set(key, { ...pair, [name]: pair[name] + 1 });
  }
  return {
    feedbackNotes: input.feedbackNotes,
    pairs: [...pairs.values()].sort(
      (a, b) =>
        a.authorModel.localeCompare(b.authorModel) || a.criticModel.localeCompare(b.criticModel),
    ),
  };
}

/** A week's outcomes for one pair, with the share of decided findings the member accepted. */
export interface OutcomeWeek extends DigestOutcomeCounts {
  readonly acceptRate: number | null;
}

/** Adds days' counts up into a week. */
export function outcomeWeek(counts: readonly DigestOutcomeCounts[]): OutcomeWeek {
  const total = { ...noOutcomes };
  for (const each of counts) {
    for (const name of Object.keys(total) as (keyof DigestOutcomeCounts)[]) {
      total[name] += Number.isFinite(each[name]) ? each[name] : 0;
    }
  }
  const decided = total.findingsAccepted + total.findingsRejected;
  return {
    ...total,
    acceptRate:
      decided === 0 ? null : Math.round((total.findingsAccepted / decided) * 10_000) / 10_000,
  };
}
