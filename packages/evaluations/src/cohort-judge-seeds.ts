/**
 * Planted failures for measuring the model judge (#3291). Real rounds rarely fail three of the
 * judged modes and rarely keep every must-cover fact, so copies of real drafts get one planted
 * sentence each, labelled by construction. Only the planted mode is labelled on a copy.
 */

import type { JudgedFailureMode } from "./cohort-judge.js";
import type { ModeVerdict } from "./cohort-scorer.js";

export const plantedModes = [
  "attribution-inflation",
  "scope-stretch",
  "unsupported-claim",
] as const;
export type PlantedMode = (typeof plantedModes)[number];

export type CaseSeeds = Readonly<Record<PlantedMode, string>> & {
  /** One draft-style sentence per must-cover fact id of the case. */
  readonly mustCover: Readonly<Record<string, string>>;
};

export interface SeededDraft {
  readonly id: string;
  readonly draft: string;
  readonly labels: Readonly<Partial<Record<JudgedFailureMode, ModeVerdict>>>;
}

/**
 * The copies one real draft yields: one per planted mode the real draft passes, and one that
 * states every must-cover fact.
 */
export function seededDrafts(input: {
  readonly roundId: string;
  readonly draft: string;
  readonly labels: Readonly<Record<string, ModeVerdict>>;
  readonly seeds: CaseSeeds;
}): readonly SeededDraft[] {
  const planted = plantedModes
    .filter((mode) => input.labels[mode] === "pass")
    .map((mode) => ({
      id: `${input.roundId}+${mode}`,
      draft: `${input.draft}\n${input.seeds[mode]}`,
      labels: { [mode]: "fail" as const },
    }));
  const complete = {
    id: `${input.roundId}+must-cover`,
    draft: `${input.draft}\n${Object.values(input.seeds.mustCover).join("\n")}`,
    labels: { "must-cover-omission": "pass" as const },
  };
  return [...planted, complete];
}
