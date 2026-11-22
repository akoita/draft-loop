/**
 * Model-judged scoring of one draft against a fictional cohort case (#3288, part 2 of #1107).
 *
 * It covers the failure modes a rule cannot decide: left-out must-cover facts, inflated
 * attribution, stretched scope and unsupported claims. Each is a closed yes/no question to a
 * decision model, which answers with a probability; code turns probabilities into verdicts by
 * threshold. The deterministic modes stay in `cohort-scorer.ts`.
 */

import type { ModeVerdict } from "./cohort-scorer.js";

/** Bump when a question, the input shape or the verdict rule changes. */
export const cohortJudgeVersion = "cohort-judge-v1";

export const judgedFailureModes = [
  "must-cover-omission",
  "attribution-inflation",
  "scope-stretch",
  "unsupported-claim",
] as const;
export type JudgedFailureMode = (typeof judgedFailureModes)[number];

/** The modes asked once per draft, as a statement whose truth means the draft fails. */
export const judgedModeStatements: Readonly<
  Record<Exclude<JudgedFailureMode, "must-cover-omission">, string>
> = Object.freeze({
  "attribution-inflation":
    "The draft presents work that the source profile describes as a team's, supervised, shared or someone else's as the candidate's own sole ownership, leadership or authority. Wording that keeps the shared or supervised scope does not count.",
  "scope-stretch":
    "The draft presents something the source profile records only as attended, booked, planned, in progress or partly evidenced as a credential, qualification or skill the candidate fully holds.",
  "unsupported-claim":
    "The draft states a qualification, job title, award or responsibility that the source profile does not support, such as one of the listed unsupported claims. Rewording a fact the profile states does not count.",
});

export interface CohortCaseExpectations {
  readonly mustCover: readonly { readonly id: string; readonly fact: string }[];
  readonly prohibitedClaims?: readonly { readonly id: string; readonly claim: string }[];
}

export interface JudgeQuestion {
  readonly kind: "predicate";
  readonly name: string;
  readonly instructions: string;
}

const mustCoverPrefix = "must-cover:";

/** One question per must-cover fact, then one per remaining mode. */
export function cohortJudgeQuestions(
  expectations: CohortCaseExpectations,
): readonly JudgeQuestion[] {
  return [
    ...expectations.mustCover.map(({ id, fact }) => ({
      kind: "predicate" as const,
      name: `${mustCoverPrefix}${id}`,
      instructions: `The draft states this fact from the source profile and keeps its meaning: ${fact}`,
    })),
    ...Object.entries(judgedModeStatements).map(([name, instructions]) => ({
      kind: "predicate" as const,
      name,
      instructions,
    })),
  ];
}

/** The shared input every question is about. Fictional cases only. */
export function cohortJudgeInput(input: {
  readonly profile: string;
  readonly draft: string;
  readonly expectations: CohortCaseExpectations;
}): Readonly<Record<string, unknown>> {
  return {
    sourceProfile: input.profile,
    draft: input.draft,
    unsupportedClaims: (input.expectations.prohibitedClaims ?? []).map(({ claim }) => claim),
  };
}

/** Probability per question name; `null` where the model refused or did not answer. */
export type JudgeProbabilities = Readonly<Record<string, number | null>>;
export type JudgeThresholds = Readonly<Record<JudgedFailureMode, number>>;

export const defaultJudgeThresholds: JudgeThresholds = Object.freeze({
  "must-cover-omission": 0.5,
  "attribution-inflation": 0.5,
  "scope-stretch": 0.5,
  "unsupported-claim": 0.5,
});

/**
 * Verdicts from one draft's probabilities. A must-cover fact counts as covered when its
 * probability reaches the threshold; a mode statement fails when it does. A missing answer
 * fails closed.
 */
export function cohortJudgeVerdicts(
  probabilities: JudgeProbabilities,
  thresholds: JudgeThresholds = defaultJudgeThresholds,
): Readonly<Record<JudgedFailureMode, ModeVerdict>> {
  const facts = Object.entries(probabilities).filter(([name]) => name.startsWith(mustCoverPrefix));
  const omitted = facts.some(
    ([, probability]) => probability === null || probability < thresholds["must-cover-omission"],
  );
  const verdicts = { "must-cover-omission": omitted ? "fail" : "pass" } as Record<
    JudgedFailureMode,
    ModeVerdict
  >;
  for (const mode of Object.keys(judgedModeStatements) as Exclude<
    JudgedFailureMode,
    "must-cover-omission"
  >[]) {
    const probability = probabilities[mode];
    verdicts[mode] =
      probability === null || probability === undefined || probability >= thresholds[mode]
        ? "fail"
        : "pass";
  }
  return verdicts;
}

const thresholdGrid = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const;

/**
 * Picks each mode's threshold on the tuning rounds: the one with the best balanced accuracy,
 * nearest 0.5 on a tie. A mode whose tuning rounds hold only one label keeps 0.5, since one
 * class alone cannot place a threshold.
 */
export function tuneJudgeThresholds(
  rounds: readonly {
    readonly probabilities: JudgeProbabilities;
    readonly labels: Readonly<Record<string, ModeVerdict>>;
  }[],
): JudgeThresholds {
  const tuned = { ...defaultJudgeThresholds };
  for (const mode of judgedFailureModes) {
    const rated = rounds.filter(({ labels }) => labels[mode] !== undefined);
    const fails = rated.filter(({ labels }) => labels[mode] === "fail");
    const passes = rated.filter(({ labels }) => labels[mode] === "pass");
    if (fails.length === 0 || passes.length === 0) continue;
    const balanced = (threshold: number): number => {
      const at = { ...defaultJudgeThresholds, [mode]: threshold };
      const rate = (subset: typeof rated, verdict: ModeVerdict) =>
        subset.filter(
          ({ probabilities }) => cohortJudgeVerdicts(probabilities, at)[mode] === verdict,
        ).length / subset.length;
      return (rate(fails, "fail") + rate(passes, "pass")) / 2;
    };
    let best = 0.5;
    let bestScore = balanced(0.5);
    for (const threshold of thresholdGrid) {
      const score = balanced(threshold);
      if (
        score > bestScore ||
        (score === bestScore && Math.abs(threshold - 0.5) < Math.abs(best - 0.5))
      ) {
        best = threshold;
        bestScore = score;
      }
    }
    tuned[mode] = best;
  }
  return tuned;
}
