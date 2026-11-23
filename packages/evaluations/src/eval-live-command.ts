import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import {
  type CohortCaseExpectations,
  cohortJudgeInput,
  cohortJudgeQuestions,
  cohortJudgeVerdicts,
  cohortJudgeVersion,
} from "./cohort-judge.js";
import { judgeItems } from "./cohort-judge-run.js";
import { draftText, type ModeVerdict, scoreCohortDraft } from "./cohort-scorer.js";
import {
  type LiveFailureMode,
  type LiveModels,
  type LiveResult,
  liveFailRates,
  liveFailureModes,
  liveJudgeThresholds,
  liveRegressions,
} from "./eval-live.js";

/*
 * `pnpm eval:live`: runs the Economy pair over cohort cases, one CLI workspace per round, scores
 * each draft with the deterministic scorer and the model judge, prints content-free fail rates,
 * and exits 1 when a mode's fail rate rose against the last recorded result for the same models
 * and prompt versions. Manual and paid; it never runs in hosted CI. Drafts stay in --out.
 *
 *   pnpm eval:live --out ~/draft-loop-eval/v21 --label track-a-after --total-cap-usd 1 --record
 *
 * Pin the previous prompt versions for a before run with DRAFT_LOOP_EVAL_AUTHOR_PROMPT_VERSION
 * and DRAFT_LOOP_EVAL_CRITIC_PROMPT_VERSION. The writer needs ANTHROPIC_API_KEY, the critic and
 * the judge OPENAI_API_KEY. --fixture runs the offline agents and skips the judge, for free.
 */

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    label: { type: "string", default: "unlabelled" },
    cases: { type: "string", default: "case-nurse,case-sales,case-teacher,case-electrician" },
    repetitions: { type: "string", default: "2" },
    "per-run-cap-usd": { type: "string", default: "0.25" },
    "total-cap-usd": { type: "string", default: "1" },
    "judge-max-usd": { type: "string", default: "0.1" },
    "judge-model": { type: "string", default: "gpt-6-luna" },
    fixture: { type: "boolean", default: false },
    record: { type: "boolean", default: false },
  },
});
if (values.out === undefined) throw new Error("--out <private directory> is required.");
const out = resolve(values.out);
const repository = resolve(import.meta.dirname, "../../..");
const fixtures = join(repository, "packages/evaluations/fixtures");
const resultsPath = join(fixtures, "eval-live/results.json");

execFileSync(
  process.execPath,
  [
    join(repository, "scripts/failure-taxonomy-rounds.mjs"),
    "--out",
    out,
    "--only",
    values.cases,
    "--repetitions",
    values.repetitions,
    "--per-run-cap-usd",
    values["per-run-cap-usd"],
    "--total-cap-usd",
    values["total-cap-usd"],
    ...(values.fixture ? ["--fixture"] : []),
  ],
  { cwd: repository, stdio: "inherit", env: process.env },
);

interface SavedRound {
  readonly id: string;
  readonly cohort: string;
  readonly caseName: string;
  readonly artifact: unknown;
  readonly models: LiveModels | null;
  readonly run: { readonly total_cost_usd?: number } | null;
}

const cases = values.cases.split(",");
const saved = readdirSync(out)
  .map((name) => join(out, name, "round.json"))
  .filter((path) => existsSync(path))
  .map((path) => JSON.parse(readFileSync(path, "utf8")) as SavedRound)
  .filter((round) => cases.includes(round.caseName));
if (saved.length === 0) throw new Error("No rounds were produced.");

const models = saved[0]?.models ?? null;
if (models === null) throw new Error("The first round recorded no model configuration.");
const sameModels = (round: SavedRound) => JSON.stringify(round.models) === JSON.stringify(models);
if (!saved.every(sameModels)) {
  throw new Error("Rounds in --out used different models or prompt versions; use a fresh --out.");
}

const caseFiles = (round: SavedRound) => {
  const directory = join(fixtures, round.cohort, round.caseName);
  return {
    profile: readFileSync(join(directory, "candidate-profile.md"), "utf8"),
    jobDescription: readFileSync(join(directory, "job-description.md"), "utf8"),
    expectations: JSON.parse(
      readFileSync(join(directory, "expectations.json"), "utf8"),
    ) as CohortCaseExpectations,
  };
};

const drafted = saved.filter((round) => round.artifact !== null);
const judge = values.fixture ? null : { version: cohortJudgeVersion, model: values["judge-model"] };
const { answers, spentUsd } =
  judge === null
    ? { answers: {}, spentUsd: 0 }
    : await judgeItems({
        items: drafted.map((round) => {
          const { profile, expectations } = caseFiles(round);
          return {
            id: round.id,
            input: cohortJudgeInput({ profile, draft: draftText(round.artifact), expectations }),
            questions: cohortJudgeQuestions(expectations),
          };
        }),
        cachePath: join(out, "judge", `${judge.version}-${judge.model}.json`),
        model: judge.model,
        maxUsd: Number(values["judge-max-usd"]),
        apiKey: process.env.OPENAI_API_KEY ?? "",
        log: (line) => process.stdout.write(`${line}\n`),
      });

const verdicts = saved.map((round): Partial<Record<LiveFailureMode, ModeVerdict>> | null => {
  if (round.artifact === null) return null;
  const { profile, jobDescription } = caseFiles(round);
  const scored = scoreCohortDraft({ artifact: round.artifact, profile, jobDescription }).verdicts;
  const probabilities = (answers as Record<string, Readonly<Record<string, number | null>>>)[
    round.id
  ];
  if (probabilities === undefined) return scored;
  const judged = cohortJudgeVerdicts(probabilities, liveJudgeThresholds);
  return {
    ...scored,
    "attribution-inflation": judged["attribution-inflation"],
    "scope-stretch": judged["scope-stretch"],
    "unsupported-claim": judged["unsupported-claim"],
  };
});

const commit = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
  cwd: repository,
  encoding: "utf8",
}).trim();
const result: LiveResult = {
  recordedAt: new Date().toISOString(),
  label: values.label,
  commit,
  models,
  judge,
  cases,
  rounds: saved.length,
  costUsd:
    Math.round(
      (saved.reduce((sum, round) => sum + Number(round.run?.total_cost_usd ?? 0), 0) + spentUsd) *
        10_000,
    ) / 10_000,
  failRates: liveFailRates(verdicts),
};

const history = (
  JSON.parse(readFileSync(resultsPath, "utf8")) as { readonly results: readonly LiveResult[] }
).results;
const { baseline, regressions } = liveRegressions(result, history);

const percent = (value: number | undefined) =>
  value === undefined ? "-" : `${Math.round(value * 100)}%`;
process.stdout.write(
  `\n${result.label}: ${result.rounds} rounds, $${result.costUsd}, author ${models.author.promptTemplateVersion}, critic ${models.critic.promptTemplateVersion}\n`,
);
for (const mode of liveFailureModes) {
  const before = baseline === null ? "" : ` (was ${percent(baseline.failRates[mode])})`;
  process.stdout.write(`  ${mode}: ${percent(result.failRates[mode])}${before}\n`);
}
process.stdout.write(
  baseline === null
    ? "\nno earlier result for these models and prompt versions\n"
    : `\ncompared with ${baseline.label} (${baseline.commit})\n`,
);

if (values.record && !values.fixture) {
  writeFileSync(
    resultsPath,
    `${JSON.stringify({ schemaVersion: 1, results: [...history, result] }, null, 2)}\n`,
  );
  process.stdout.write(
    `recorded in ${resultsPath}; add it to the prompt score manifest with pnpm eval:scores:record --label ${result.label}\n`,
  );
}
if (regressions.length > 0) {
  for (const { mode, before, after } of regressions) {
    process.stderr.write(`regression: ${mode} rose from ${percent(before)} to ${percent(after)}\n`);
  }
  process.exitCode = 1;
}
