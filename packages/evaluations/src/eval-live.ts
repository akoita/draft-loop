/**
 * The live evaluation's content-free result and its regression check (#3289, part 3 of #1107).
 *
 * A result holds, per failure mode, the share of rounds that fail it, together with the models
 * and prompt versions that wrote the drafts. A new result is compared only with the last one
 * recorded for the same models, prompt versions and judge.
 */

import type { JudgeThresholds } from "./cohort-judge.js";
import type { ModeVerdict } from "./cohort-scorer.js";

/** Modes the live evaluation tracks; `must-cover-omission` waits for a better judge (#3293). */
export const liveFailureModes = [
  "no-draft",
  "placeholder-left",
  "altered-number",
  "role-omission",
  "chronology-drift",
  "attribution-inflation",
  "scope-stretch",
  "unsupported-claim",
] as const;
export type LiveFailureMode = (typeof liveFailureModes)[number];

/** Thresholds tuned on the train split with planted failures (docs/evaluation/failure-taxonomy.md). */
export const liveJudgeThresholds: JudgeThresholds = Object.freeze({
  "must-cover-omission": 0.1,
  "attribution-inflation": 0.9,
  "scope-stretch": 0.7,
  "unsupported-claim": 0.8,
});

export interface LiveModels {
  readonly author: { readonly modelId: string; readonly promptTemplateVersion: string };
  readonly critic: { readonly modelId: string; readonly promptTemplateVersion: string };
}

export interface LiveResult {
  readonly recordedAt: string;
  readonly label: string;
  readonly commit: string;
  readonly models: LiveModels;
  readonly judge: { readonly version: string; readonly model: string } | null;
  readonly cases: readonly string[];
  readonly rounds: number;
  readonly costUsd: number;
  /** The run's total cost cap; results recorded before #2836 lack it. */
  readonly costCapUsd?: number;
  readonly failRates: Readonly<Partial<Record<LiveFailureMode, number>>>;
}

/**
 * The share of rounds failing each mode. A round with no draft fails `no-draft` and counts
 * for no other mode; a mode no round was scored on is left out.
 */
export function liveFailRates(
  rounds: readonly (Readonly<Partial<Record<LiveFailureMode, ModeVerdict>>> | null)[],
): Readonly<Partial<Record<LiveFailureMode, number>>> {
  const rates: Partial<Record<LiveFailureMode, number>> = {};
  if (rounds.length === 0) return rates;
  rates["no-draft"] = rounds.filter((round) => round === null).length / rounds.length;
  const drafted = rounds.filter((round) => round !== null);
  for (const mode of liveFailureModes) {
    if (mode === "no-draft") continue;
    const scored = drafted.filter((round) => round[mode] !== undefined);
    if (scored.length === 0) continue;
    rates[mode] = scored.filter((round) => round[mode] === "fail").length / scored.length;
  }
  return rates;
}

/** Results are comparable only when the same models, prompt versions and judge produced them. */
export function liveResultKey(result: Pick<LiveResult, "models" | "judge">): string {
  const { author, critic } = result.models;
  return [
    author.modelId,
    author.promptTemplateVersion,
    critic.modelId,
    critic.promptTemplateVersion,
    result.judge === null ? "no-judge" : `${result.judge.version}@${result.judge.model}`,
  ].join("|");
}

export interface LiveRegression {
  readonly mode: LiveFailureMode;
  readonly before: number;
  readonly after: number;
}

/**
 * Modes whose fail rate rose by more than one round's worth against the last comparable result.
 * One extra failing round is within the noise of a small run, so it does not count.
 */
export function liveRegressions(
  current: LiveResult,
  history: readonly LiveResult[],
): { readonly baseline: LiveResult | null; readonly regressions: readonly LiveRegression[] } {
  const key = liveResultKey(current);
  const baseline = [...history].reverse().find((result) => liveResultKey(result) === key) ?? null;
  if (baseline === null) return { baseline, regressions: [] };
  const tolerance = 1 / Math.max(1, Math.min(current.rounds, baseline.rounds));
  const regressions = liveFailureModes.flatMap((mode) => {
    const before = baseline.failRates[mode];
    const after = current.failRates[mode];
    if (before === undefined || after === undefined) return [];
    return after - before > tolerance + 1e-9 ? [{ mode, before, after }] : [];
  });
  return { baseline, regressions };
}
