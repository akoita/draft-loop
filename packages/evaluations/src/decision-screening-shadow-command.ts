import { contentScreeningCorpus } from "@draft-loop/ingestion/content-screening-corpus";
import { createDecisionModel, type DecisionModel } from "@draft-loop/providers/decisions";

import {
  estimateScreeningShadowTokens,
  type ScreeningShadowCaseResult,
  scoreScreeningShadow,
  screeningCaseResult,
  screeningQuestions,
} from "./decision-screening-shadow.js";

/*
 * `pnpm test:decision-shadow:live`: run `decision-shadow-1` (#2247). Sends every case of the
 * synthetic content-screening corpus to Jev, once, and prints a content-free report as JSON.
 *
 * Inputs (environment):
 * - DRAFT_LOOP_JEV_API_KEY: required.
 * - DRAFT_LOOP_DECISION_SHADOW_MAX_USD: spend cap, default 0.50. The run refuses to start when
 *   its pessimistic estimate exceeds the cap, and stops when recorded usage reaches it.
 * - DRAFT_LOOP_DECISION_SHADOW_THRESHOLD: probability that counts as a signal, default 0.5.
 */

const jevInputUsdPerMillion = 0.042;
const concurrency = 4;

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

export async function runScreeningShadow(
  model: DecisionModel,
  options: { readonly maxUsd: number; readonly threshold: number },
): Promise<
  ReturnType<typeof scoreScreeningShadow> & { readonly answeredModels: readonly string[] }
> {
  const estimatedUsd =
    (estimateScreeningShadowTokens(contentScreeningCorpus) / 1_000_000) * jevInputUsdPerMillion;
  if (estimatedUsd > options.maxUsd) {
    throw new Error(
      `Estimated cost $${estimatedUsd.toFixed(4)} exceeds the $${options.maxUsd} cap.`,
    );
  }
  const questions = screeningQuestions();
  const results: ScreeningShadowCaseResult[] = [];
  const answeredModels = new Set<string>();
  let spentTokens = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < contentScreeningCorpus.length) {
      const corpusCase = contentScreeningCorpus[next];
      next += 1;
      if (corpusCase === undefined) return;
      if ((spentTokens / 1_000_000) * jevInputUsdPerMillion >= options.maxUsd) return;
      const started = performance.now();
      const result = await model.decide({
        input: corpusCase.text,
        questions,
        // Synthetic corpus only: no candidate material is sent.
        dataPolicy: {
          allowTransmission: true,
          allowedVendors: [model.identity.vendor],
          sensitiveData: false,
          sensitiveDataAcknowledged: false,
        },
      });
      spentTokens += result.usage?.inputTokens ?? 0;
      answeredModels.add(result.model);
      results.push(
        screeningCaseResult(
          corpusCase,
          result,
          Math.round(performance.now() - started),
          options.threshold,
        ),
      );
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  results.sort((a, b) => a.id.localeCompare(b.id));
  return {
    ...scoreScreeningShadow(results, jevInputUsdPerMillion),
    answeredModels: [...answeredModels].sort(),
  };
}

async function main(): Promise<void> {
  const apiKey = process.env.DRAFT_LOOP_JEV_API_KEY ?? "";
  if (apiKey.trim() === "") {
    throw new Error("Set DRAFT_LOOP_JEV_API_KEY first: source ~/.config/draft-loop/jev.env");
  }
  const model = createDecisionModel({ apiKey });
  const report = await runScreeningShadow(model, {
    maxUsd: numberFromEnv("DRAFT_LOOP_DECISION_SHADOW_MAX_USD", 0.5),
    threshold: numberFromEnv("DRAFT_LOOP_DECISION_SHADOW_THRESHOLD", 0.5),
  });
  process.stdout.write(
    `${JSON.stringify({ run: "decision-shadow-1", model: model.identity, ...report }, null, 2)}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? ` (${String(error.code)})`
        : "";
    process.stderr.write(
      `decision-shadow-1 failed${code}: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
