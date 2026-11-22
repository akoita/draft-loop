import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  type CohortCaseExpectations,
  cohortJudgeInput,
  cohortJudgeQuestions,
  cohortJudgeVerdicts,
  cohortJudgeVersion,
  judgedFailureModes,
  tuneJudgeThresholds,
} from "./cohort-judge.js";
import { judgeItems } from "./cohort-judge-run.js";
import { type CaseSeeds, seededDrafts } from "./cohort-judge-seeds.js";
import { agreementWithLabels, draftText, type ModeVerdict } from "./cohort-scorer.js";

/**
 * Runs the model judge on the private failure-taxonomy rounds and prints its agreement with the
 * labels: thresholds tuned on train, then checked on dev. Prints no draft text. Answers are saved
 * next to the rounds, so a second run with the same version and model makes no call.
 *
 *   OPENAI_API_KEY=... pnpm exec tsx packages/evaluations/src/cohort-judge-command.ts \
 *     ~/draft-loop-ftx --max-usd 0.5
 *
 * Fictional cases only. Held-out rounds are not sent unless `--splits` names them.
 */

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    splits: { type: "string", default: "train,dev" },
    "max-usd": { type: "string", default: "0.5" },
    model: { type: "string", default: "gpt-6-luna" },
    seeded: { type: "boolean", default: false },
  },
});
const directory = positionals[0];
if (directory === undefined) throw new Error("Pass the private rounds directory.");
const splits = values.splits.split(",");
const maxUsd = Number(values["max-usd"]);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("--max-usd must be positive.");
const model = values.model;

interface LabelledRound {
  readonly id: string;
  readonly split: string;
  readonly labels: Readonly<Record<string, ModeVerdict>>;
  readonly seeded?: boolean;
}

const fixtures = new URL("../fixtures/", import.meta.url);
const labels = JSON.parse(
  readFileSync(new URL("failure-taxonomy/labels.json", fixtures), "utf8"),
) as { readonly rounds: readonly LabelledRound[] };

const seeds = JSON.parse(
  readFileSync(new URL("failure-taxonomy/seeds.json", fixtures), "utf8"),
) as { readonly cases: Readonly<Record<string, CaseSeeds>> };

const rounds = labels.rounds.flatMap((round) => {
  if (!splits.includes(round.split) || round.labels["no-draft"] === "fail") return [];
  const saved = JSON.parse(
    readFileSync(join(resolve(directory), round.id, "round.json"), "utf8"),
  ) as { readonly cohort: string; readonly caseName: string; readonly artifact: unknown };
  if (saved.artifact === null) return [];
  const caseUrl = new URL(`${saved.cohort}/${saved.caseName}/`, fixtures);
  const expectations = JSON.parse(
    readFileSync(new URL("expectations.json", caseUrl), "utf8"),
  ) as CohortCaseExpectations;
  const profile = readFileSync(new URL("candidate-profile.md", caseUrl), "utf8");
  const draft = draftText(saved.artifact);
  const questions = cohortJudgeQuestions(expectations);
  const real = { round, input: cohortJudgeInput({ profile, draft, expectations }), questions };
  const caseSeeds = seeds.cases[saved.caseName];
  if (!values.seeded || caseSeeds === undefined) return [real];
  const copies = seededDrafts({ roundId: round.id, draft, labels: round.labels, seeds: caseSeeds });
  return [
    real,
    ...copies.map((copy) => ({
      round: { id: copy.id, split: round.split, labels: copy.labels, seeded: true },
      input: cohortJudgeInput({ profile, draft: copy.draft, expectations }),
      questions,
    })),
  ];
});

const { answers: cache, spentUsd } = await judgeItems({
  items: rounds.map(({ round, input, questions }) => ({ id: round.id, input, questions })),
  cachePath: join(resolve(directory), "judge", `${cohortJudgeVersion}-${model}.json`),
  model,
  maxUsd,
  apiKey: process.env.OPENAI_API_KEY ?? "",
  log: (line) => process.stdout.write(`${line}\n`),
});

const judged = rounds.flatMap(({ round }) => {
  const probabilities = cache[round.id];
  return probabilities === undefined ? [] : [{ ...round, probabilities }];
});
const thresholds = tuneJudgeThresholds(judged.filter(({ split }) => split === "train"));
process.stdout.write(
  `\n${cohortJudgeVersion} on ${model}, spent $${spentUsd.toFixed(4)} this run\nthresholds tuned on train: ${JSON.stringify(thresholds)}\n`,
);
const percent = (value: number | null) => (value === null ? "-" : `${Math.round(value * 100)}%`);
const groups = splits.flatMap((split) =>
  values.seeded ? [[split, false] as const, [split, true] as const] : [[split, false] as const],
);
for (const [split, seeded] of groups) {
  const subset = judged
    .filter((round) => round.split === split && (round.seeded === true) === seeded)
    .map(({ probabilities, labels: roundLabels }) => ({
      scored: cohortJudgeVerdicts(probabilities, thresholds),
      labels: roundLabels,
    }));
  process.stdout.write(`\n${split}${seeded ? " planted" : ""} (${subset.length} drafts)\n`);
  for (const row of agreementWithLabels(subset, judgedFailureModes)) {
    process.stdout.write(
      `  ${row.mode}: agreement ${percent(row.agreement)}, TPR ${percent(row.truePositiveRate)}, TNR ${percent(row.trueNegativeRate)}\n`,
    );
  }
}
