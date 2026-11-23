import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

import { checkPromptScores, type PromptScorePair } from "@draft-loop/evaluations";

import { promptTemplateVersion } from "./author-adjudication.js";
import { economyDefaultModelPair } from "./default-model-selection.js";

/*
 * `pnpm eval:scores`, part of `pnpm lint` (#2836): fails when the prompt versions or the default
 * models a new run uses have no score in packages/evaluations/prompt-scores.json, nor a waiver
 * that is still running. It reads the manifest and the code; it calls no model.
 */

/** The pair a new run uses: the current prompt versions on the default (Economy) models. */
function currentPromptScorePair(): PromptScorePair {
  const models = economyDefaultModelPair();
  return {
    author: {
      modelId: models.author.model,
      promptTemplateVersion: promptTemplateVersion("author"),
    },
    critic: {
      modelId: models.critic.model,
      promptTemplateVersion: promptTemplateVersion("critic"),
    },
  };
}

const manifestPath = resolve(import.meta.dirname, "../../evaluations/prompt-scores.json");
const check = checkPromptScores({
  manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as unknown,
  current: currentPromptScorePair(),
  today: new Date().toISOString().slice(0, 10),
});
for (const note of check.notes) process.stdout.write(`prompt scores: ${note}\n`);
for (const problem of check.problems) process.stderr.write(`prompt scores: ${problem}\n`);
if (!check.ok) {
  process.stderr.write("prompt scores: see docs/evaluation/prompt-score-gate.md\n");
  process.exitCode = 1;
}
