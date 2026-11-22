import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import { createDecisionModel } from "@draft-loop/providers/decisions";

import {
  type CohortCaseExpectations,
  cohortJudgeInput,
  cohortJudgeQuestions,
  cohortJudgeVerdicts,
  cohortJudgeVersion,
  type JudgeProbabilities,
  judgedFailureModes,
  tuneJudgeThresholds,
} from "./cohort-judge.js";
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
  },
});
const directory = positionals[0];
if (directory === undefined) throw new Error("Pass the private rounds directory.");
const splits = values.splits.split(",");
const maxUsd = Number(values["max-usd"]);
if (!Number.isFinite(maxUsd) || maxUsd <= 0) throw new Error("--max-usd must be positive.");
const model = values.model;
// gpt-6-luna list prices; a pessimistic estimate counts the input once per question.
const inputUsdPerMillion = 0.1;
const outputUsdPerMillion = 0.5;

interface LabelledRound {
  readonly id: string;
  readonly split: string;
  readonly labels: Readonly<Record<string, ModeVerdict>>;
}

const fixtures = new URL("../fixtures/", import.meta.url);
const labels = JSON.parse(
  readFileSync(new URL("failure-taxonomy/labels.json", fixtures), "utf8"),
) as { readonly rounds: readonly LabelledRound[] };

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
  const input = cohortJudgeInput({
    profile: readFileSync(new URL("candidate-profile.md", caseUrl), "utf8"),
    draft: draftText(saved.artifact),
    expectations,
  });
  return [{ round, input, questions: cohortJudgeQuestions(expectations) }];
});

const cacheDirectory = join(resolve(directory), "judge");
const cachePath = join(cacheDirectory, `${cohortJudgeVersion}-${model}.json`);
const cache: Record<string, JudgeProbabilities> = existsSync(cachePath)
  ? (JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, JudgeProbabilities>)
  : {};

const pending = rounds.filter(({ round }) => cache[round.id] === undefined);
const estimate = pending.reduce(
  (sum, { input, questions }) =>
    sum + ((JSON.stringify(input).length / 3) * questions.length * inputUsdPerMillion) / 1_000_000,
  0,
);
if (estimate > maxUsd) {
  throw new Error(`Estimated $${estimate.toFixed(4)} exceeds the $${maxUsd} cap.`);
}

let spentUsd = 0;
if (pending.length > 0) {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (apiKey.trim() === "") throw new Error("Set OPENAI_API_KEY first.");
  const decisionModel = createDecisionModel({ vendor: "openai-decisions", apiKey, model });
  mkdirSync(cacheDirectory, { recursive: true });
  for (const { round, input, questions } of pending) {
    if (spentUsd >= maxUsd) {
      process.stdout.write(`stop: $${spentUsd.toFixed(4)} reached the cap\n`);
      break;
    }
    const result = await decisionModel.decide({
      input,
      questions,
      // Fictional cohort cases only: no candidate material is sent.
      dataPolicy: {
        allowTransmission: true,
        allowedVendors: ["openai-decisions"],
        sensitiveData: false,
        sensitiveDataAcknowledged: false,
      },
    });
    spentUsd +=
      ((result.usage?.inputTokens ?? 0) * inputUsdPerMillion +
        (result.usage?.outputTokens ?? 0) * outputUsdPerMillion) /
      1_000_000;
    cache[round.id] = Object.fromEntries(
      questions.map(({ name }) => {
        const answer = result.answers[name];
        return [name, answer?.kind === "predicate" ? answer.probability : null];
      }),
    );
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    process.stdout.write(`${round.id}: answered by ${result.model}, $${spentUsd.toFixed(4)}\n`);
  }
}

const judged = rounds.flatMap(({ round }) => {
  const probabilities = cache[round.id];
  return probabilities === undefined ? [] : [{ ...round, probabilities }];
});
const thresholds = tuneJudgeThresholds(judged.filter(({ split }) => split === "train"));
process.stdout.write(
  `\n${cohortJudgeVersion} on ${model}, spent $${spentUsd.toFixed(4)} this run\nthresholds tuned on train: ${JSON.stringify(thresholds)}\n`,
);
const percent = (value: number | null) => (value === null ? "-" : `${Math.round(value * 100)}%`);
for (const split of splits) {
  const subset = judged
    .filter((round) => round.split === split)
    .map(({ probabilities, labels: roundLabels }) => ({
      scored: cohortJudgeVerdicts(probabilities, thresholds),
      labels: roundLabels,
    }));
  process.stdout.write(`\n${split} (${subset.length} rounds)\n`);
  for (const row of agreementWithLabels(subset, judgedFailureModes)) {
    process.stdout.write(
      `  ${row.mode}: agreement ${percent(row.agreement)}, TPR ${percent(row.truePositiveRate)}, TNR ${percent(row.trueNegativeRate)}\n`,
    );
  }
}
