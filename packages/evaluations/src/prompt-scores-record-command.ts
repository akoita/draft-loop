import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

import type { LiveResult } from "./eval-live.js";
import {
  addPromptScore,
  parsePromptScoreManifest,
  promptScoreEntryFromLiveResult,
  promptScoreRises,
} from "./prompt-scores.js";

/*
 * `pnpm eval:scores:record`: copies one recorded `pnpm eval:live` result into the prompt score
 * manifest, so the prompt score gate accepts its models and prompt versions. It calls no model.
 *
 *   pnpm eval:scores:record --label v22-after
 *   pnpm eval:scores:record --label v22-after --reason "The one extra fail is a judge false alarm."
 *
 * With no --label it takes the last result. --cost-cap-usd names the cap of a result recorded
 * before eval:live wrote its cap.
 */

const { values } = parseArgs({
  options: {
    label: { type: "string" },
    reason: { type: "string" },
    "cost-cap-usd": { type: "string" },
    results: { type: "string" },
    manifest: { type: "string" },
  },
});

const repository = resolve(import.meta.dirname, "../../..");
const resultsPath = resolve(
  values.results ?? join(repository, "packages/evaluations/fixtures/eval-live/results.json"),
);
const manifestPath = resolve(
  values.manifest ?? join(repository, "packages/evaluations/prompt-scores.json"),
);

const results = (
  JSON.parse(readFileSync(resultsPath, "utf8")) as { readonly results: readonly LiveResult[] }
).results;
const result =
  values.label === undefined
    ? results.at(-1)
    : [...results].reverse().find((candidate) => candidate.label === values.label);
if (result === undefined) {
  throw new Error(
    values.label === undefined
      ? `${resultsPath} holds no result.`
      : `${resultsPath} holds no result labelled "${values.label}".`,
  );
}
const costCapUsd =
  result.costCapUsd ??
  (values["cost-cap-usd"] === undefined ? undefined : Number(values["cost-cap-usd"]));
if (costCapUsd === undefined || !Number.isFinite(costCapUsd) || costCapUsd <= 0) {
  throw new Error("This result records no cost cap; pass the run's cap with --cost-cap-usd.");
}

const parsed = parsePromptScoreManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
if (parsed.manifest === null) throw new Error(parsed.problems.join("\n"));
const reason = values.reason?.trim();
const entry = promptScoreEntryFromLiveResult(result, {
  costCapUsd,
  ...(reason === undefined || reason === "" ? {} : { reason }),
});
const { previous, rises } = promptScoreRises(entry, parsed.manifest.entries);
if (previous !== null && rises.length > 0 && entry.reason === undefined) {
  for (const { mode, before, after } of rises) {
    process.stderr.write(
      `rise: ${mode} ${Math.round(before * 100)}% -> ${Math.round(after * 100)}% against "${previous.label}"\n`,
    );
  }
  process.stderr.write("Not recorded: fix the prompt, or rerun with a written --reason.\n");
  process.exit(1);
}
const manifest = addPromptScore(parsed.manifest, entry);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(
  `recorded "${entry.label}" in ${manifestPath}; run pnpm format before committing\n`,
);
