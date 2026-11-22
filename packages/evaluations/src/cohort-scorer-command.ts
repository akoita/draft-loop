import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

import { agreementWithLabels, scoreCohortDraft } from "./cohort-scorer.js";

/**
 * Scores the private failure-taxonomy rounds with the deterministic scorer and prints its
 * agreement with the labels, per split. Prints no draft text.
 *
 *   pnpm exec tsx packages/evaluations/src/cohort-scorer-command.ts ~/draft-loop-ftx
 */

interface LabelledRound {
  readonly id: string;
  readonly split: string;
  readonly labels: Readonly<Record<string, "pass" | "fail">>;
}

const directory = process.argv[2];
if (directory === undefined) throw new Error("Pass the private rounds directory.");
const fixtures = new URL("../fixtures/", import.meta.url);
const labels = JSON.parse(
  readFileSync(new URL("failure-taxonomy/labels.json", fixtures), "utf8"),
) as { readonly rounds: readonly LabelledRound[] };

const scored = labels.rounds.flatMap((round) => {
  const path = join(resolve(directory), round.id, "round.json");
  const saved = JSON.parse(readFileSync(path, "utf8")) as {
    readonly cohort: string;
    readonly caseName: string;
    readonly artifact: unknown;
  };
  if (saved.artifact === null || round.labels["no-draft"] === "fail") return [];
  const caseUrl = new URL(`${saved.cohort}/${saved.caseName}/`, fixtures);
  const score = scoreCohortDraft({
    artifact: saved.artifact,
    profile: readFileSync(new URL("candidate-profile.md", caseUrl), "utf8"),
    jobDescription: readFileSync(new URL("job-description.md", caseUrl), "utf8"),
  });
  return [{ split: round.split, scored: score.verdicts, labels: round.labels }];
});

const percent = (value: number | null) => (value === null ? "-" : `${Math.round(value * 100)}%`);
for (const split of ["train", "dev", "held-out", "all"]) {
  const subset = split === "all" ? scored : scored.filter((pair) => pair.split === split);
  process.stdout.write(`\n${split} (${subset.length} rounds)\n`);
  for (const row of agreementWithLabels(subset)) {
    process.stdout.write(
      `  ${row.mode}: agreement ${percent(row.agreement)}, TPR ${percent(row.truePositiveRate)}, TNR ${percent(row.trueNegativeRate)}\n`,
    );
  }
}
