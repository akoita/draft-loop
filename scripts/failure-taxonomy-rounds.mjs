#!/usr/bin/env node
// Runs the fictional full-CV cohorts through ordinary author–critic rounds for failure labelling
// (#1105). Each round is one CLI workspace with --max-rounds 1. Drafts and findings are written to a
// private directory outside the repository; only labels go back into the repository.
//
// Dry run, no provider call:   node scripts/failure-taxonomy-rounds.mjs --out ~/ftx --fixture
// Paid run (needs the owner's go, keys in the environment):
//   node scripts/failure-taxonomy-rounds.mjs --out ~/ftx --preset economy --total-cap-usd 3
import { execFileSync } from "node:child_process";
import console from "node:console";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

const repository = resolve(import.meta.dirname, "..");
const fixtures = join(repository, "packages/evaluations/fixtures");
const cli = join(repository, "apps/cli/bin/draft-loop.mjs");

/** Repetitions per case: the non-tech cases get one more so they hold 16 of 40 rounds. */
const repetitions = { "non-tech-cv-cohort": 4 };
const defaultRepetitions = 3;

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    preset: { type: "string", default: "economy" },
    fixture: { type: "boolean", default: false },
    "per-run-cap-usd": { type: "string", default: "0.07" },
    "total-cap-usd": { type: "string", default: "3" },
    only: { type: "string" },
  },
});
if (values.out === undefined) throw new Error("--out <private directory> is required.");
const out = resolve(values.out);
if (out.startsWith(repository)) throw new Error("--out must be outside the repository.");
const perRunCap = Number(values["per-run-cap-usd"]);
const totalCap = Number(values["total-cap-usd"]);

const cases = readdirSync(fixtures)
  .filter((cohort) => cohort.endsWith("-cohort"))
  .flatMap((cohort) =>
    readdirSync(join(fixtures, cohort))
      .filter((name) => name.startsWith("case-"))
      .map((name) => ({ cohort, name, directory: join(fixtures, cohort, name) })),
  )
  .filter(({ name }) => values.only === undefined || values.only.split(",").includes(name));

const run = (args) =>
  execFileSync(process.execPath, [cli, ...args], { cwd: repository, encoding: "utf8" });

function collect(workspace) {
  const database = new DatabaseSync(join(workspace, ".draft-loop/history.sqlite"), {
    readOnly: true,
  });
  try {
    const runRow = database
      .prepare("select id, state, total_cost_usd, last_error_json from runs limit 1")
      .get();
    const artifact = database
      .prepare("select payload_json from artifact_versions order by version desc limit 1")
      .get();
    const findings = database
      .prepare(
        "select code, category, severity, message, requirement_id from findings order by created_at",
      )
      .all();
    return {
      run: runRow ?? null,
      artifact: artifact === undefined ? null : JSON.parse(artifact.payload_json),
      findings,
    };
  } finally {
    database.close();
  }
}

mkdirSync(out, { recursive: true });
let spent = 0;
const summary = [];
rounds: for (const testCase of cases) {
  const count = repetitions[testCase.cohort] ?? defaultRepetitions;
  for (let repetition = 1; repetition <= count; repetition += 1) {
    const id = `${testCase.name}-r${repetition}`;
    const roundDirectory = join(out, id);
    if (existsSync(join(roundDirectory, "round.json"))) continue;
    if (!values.fixture && spent + perRunCap > totalCap) {
      console.log(`stop: ${spent.toFixed(4)} spent, next round could pass the ${totalCap} cap`);
      break rounds;
    }
    const sources = join(roundDirectory, "sources");
    const workspace = join(roundDirectory, "workspace");
    mkdirSync(sources, { recursive: true });
    copyFileSync(join(testCase.directory, "candidate-profile.md"), join(sources, "profile.md"));
    run([
      "init",
      workspace,
      "-j",
      join(testCase.directory, "job-description.md"),
      "-s",
      sources,
      "--max-rounds",
      "1",
      "--max-cost-usd",
      String(perRunCap),
      ...(values.fixture ? ["--fixture"] : []),
    ]);
    let status;
    try {
      run([
        "start",
        workspace,
        ...(values.fixture ? [] : ["--model-preset", values.preset, "--allow-provider-data"]),
      ]);
    } catch (error) {
      console.log(`${id}: start failed: ${String(error.message).split("\n")[0]}`);
    }
    try {
      status = run(["status", workspace]);
    } catch (error) {
      status = String(error.stdout ?? error.message);
    }
    const collected = collect(workspace);
    const cost = Number(collected.run?.total_cost_usd ?? 0);
    spent += cost;
    writeFileSync(
      join(roundDirectory, "round.json"),
      `${JSON.stringify({ id, cohort: testCase.cohort, caseName: testCase.name, repetition, status, ...collected }, null, 2)}\n`,
    );
    summary.push({
      id,
      state: collected.run?.state ?? "none",
      cost,
      findings: collected.findings.length,
    });
    console.log(
      `${id}: state=${collected.run?.state} cost=${cost.toFixed(4)} total=${spent.toFixed(4)}`,
    );
  }
}
writeFileSync(join(out, "summary.json"), `${JSON.stringify({ spent, summary }, null, 2)}\n`);
console.log(`done: ${summary.length} rounds, ${spent.toFixed(4)} USD`);
