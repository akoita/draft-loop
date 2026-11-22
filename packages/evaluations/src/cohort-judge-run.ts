import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { createDecisionModel, type DecisionModel } from "@draft-loop/providers/decisions";

import type { JudgeProbabilities, JudgeQuestion } from "./cohort-judge.js";

// gpt-6-luna list prices; the pessimistic estimate counts the input once per question.
const inputUsdPerMillion = 0.1;
const outputUsdPerMillion = 0.5;

export interface JudgeItem {
  readonly id: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly questions: readonly JudgeQuestion[];
}

/**
 * Sends each item the cache at `cachePath` lacks to the decision model, under a spend cap, and
 * returns every cached answer. Fictional cohort cases only. The cache holds question names and
 * probabilities, never draft text.
 */
export async function judgeItems(options: {
  readonly items: readonly JudgeItem[];
  readonly cachePath: string;
  readonly model: string;
  readonly maxUsd: number;
  readonly apiKey?: string;
  readonly decisionModel?: DecisionModel;
  readonly log?: (line: string) => void;
}): Promise<{
  readonly answers: Readonly<Record<string, JudgeProbabilities>>;
  readonly spentUsd: number;
}> {
  const cache: Record<string, JudgeProbabilities> = existsSync(options.cachePath)
    ? (JSON.parse(readFileSync(options.cachePath, "utf8")) as Record<string, JudgeProbabilities>)
    : {};
  const pending = options.items.filter(({ id }) => cache[id] === undefined);
  const estimate = pending.reduce(
    (sum, { input, questions }) =>
      sum +
      ((JSON.stringify(input).length / 3) * questions.length * inputUsdPerMillion) / 1_000_000,
    0,
  );
  if (estimate > options.maxUsd) {
    throw new Error(`Estimated $${estimate.toFixed(4)} exceeds the $${options.maxUsd} cap.`);
  }
  let spentUsd = 0;
  if (pending.length === 0) return { answers: cache, spentUsd };
  const decisionModel = options.decisionModel ?? openAIDecisionModel(options);
  mkdirSync(dirname(options.cachePath), { recursive: true });
  for (const { id, input, questions } of pending) {
    if (spentUsd >= options.maxUsd) {
      options.log?.(`stop: $${spentUsd.toFixed(4)} reached the cap`);
      break;
    }
    const result = await decisionModel.decide({
      input,
      questions,
      // Fictional cohort cases only: no candidate material is sent.
      dataPolicy: {
        allowTransmission: true,
        allowedVendors: [decisionModel.identity.vendor],
        sensitiveData: false,
        sensitiveDataAcknowledged: false,
      },
    });
    spentUsd +=
      ((result.usage?.inputTokens ?? 0) * inputUsdPerMillion +
        (result.usage?.outputTokens ?? 0) * outputUsdPerMillion) /
      1_000_000;
    cache[id] = Object.fromEntries(
      questions.map(({ name }) => {
        const answer = result.answers[name];
        return [name, answer?.kind === "predicate" ? answer.probability : null];
      }),
    );
    writeFileSync(options.cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    options.log?.(`${id}: answered by ${result.model}, $${spentUsd.toFixed(4)}`);
  }
  return { answers: cache, spentUsd };
}

function openAIDecisionModel(options: {
  readonly apiKey?: string;
  readonly model: string;
}): DecisionModel {
  const apiKey = options.apiKey ?? "";
  if (apiKey.trim() === "") throw new Error("Set OPENAI_API_KEY first.");
  return createDecisionModel({ vendor: "openai-decisions", apiKey, model: options.model });
}
