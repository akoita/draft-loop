import {
  type ContentScreeningCorpusCase,
  contentScreeningCorpus,
} from "@draft-loop/ingestion/content-screening-corpus";
import { screenTextWithRules } from "@draft-loop/ingestion/content-screening-rules";
import { createDecisionModel, type DecisionModel } from "@draft-loop/providers/decisions";

import { ruleEvadingCorpus } from "./decision-screening-evading-corpus.js";
import {
  estimateScreeningShadowTokens,
  runCosts,
  type ScreeningSetReport,
  type ScreeningShadowCaseResult,
  scoreScreeningSet,
  screeningCaseResult,
  screeningQuestions,
  screeningShadowVersion,
} from "./decision-screening-shadow.js";

/*
 * `pnpm test:decision-shadow:live`: run the decision shadow test (#2247). Sends every case of the
 * synthetic rule corpus and of the rule-evading corpus to Jev, once, and prints a content-free
 * report as JSON: ids, labels and probabilities, never case text.
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

export interface ScreeningShadowReport {
  readonly version: string;
  readonly threshold: number;
  readonly answeredModels: readonly string[];
  /** The rule screener's own test set: every attack in it is one the rules catch. */
  readonly ruleCorpus: ScreeningSetReport;
  /** Attacks phrased around the rules, and hard clean controls: what a model would add. */
  readonly ruleEvading: ScreeningSetReport;
  readonly latencyMs: { readonly p50: number; readonly p95: number; readonly max: number };
  readonly inputTokens: number;
  readonly estimatedCostUsd: number;
  /** True when the cap stopped the run before every case was sent. */
  readonly stoppedAtCap: boolean;
}

export async function runScreeningShadow(
  model: DecisionModel,
  options: { readonly maxUsd: number; readonly threshold: number },
): Promise<ScreeningShadowReport> {
  const sets: readonly (readonly [string, readonly ContentScreeningCorpusCase[]])[] = [
    ["ruleCorpus", contentScreeningCorpus],
    ["ruleEvading", ruleEvadingCorpus],
  ];
  const queue = sets.flatMap(([set, cases]) => cases.map((corpusCase) => ({ set, corpusCase })));
  const estimatedUsd =
    (estimateScreeningShadowTokens(queue.map((item) => item.corpusCase)) / 1_000_000) *
    jevInputUsdPerMillion;
  if (estimatedUsd > options.maxUsd) {
    throw new Error(
      `Estimated cost $${estimatedUsd.toFixed(4)} exceeds the $${options.maxUsd} cap.`,
    );
  }
  const questions = screeningQuestions();
  const results = new Map<string, ScreeningShadowCaseResult[]>(sets.map(([set]) => [set, []]));
  const answeredModels = new Set<string>();
  let spentTokens = 0;
  let stoppedAtCap = false;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < queue.length) {
      const item = queue[next];
      next += 1;
      if (item === undefined) return;
      if ((spentTokens / 1_000_000) * jevInputUsdPerMillion >= options.maxUsd) {
        stoppedAtCap = true;
        return;
      }
      const started = performance.now();
      const result = await model.decide({
        input: item.corpusCase.text,
        questions,
        // Synthetic corpora only: no candidate material is sent.
        dataPolicy: {
          allowTransmission: true,
          allowedVendors: [model.identity.vendor],
          sensitiveData: false,
          sensitiveDataAcknowledged: false,
        },
      });
      const latencyMs = Math.round(performance.now() - started);
      spentTokens += result.usage?.inputTokens ?? 0;
      answeredModels.add(result.model);
      results
        .get(item.set)
        ?.push(
          screeningCaseResult(
            item.corpusCase,
            result,
            screenTextWithRules(item.corpusCase.text),
            latencyMs,
          ),
        );
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const sorted = (set: string): ScreeningShadowCaseResult[] =>
    [...(results.get(set) ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  return {
    version: screeningShadowVersion,
    threshold: options.threshold,
    answeredModels: [...answeredModels].sort(),
    ruleCorpus: scoreScreeningSet(sorted("ruleCorpus"), options.threshold),
    ruleEvading: scoreScreeningSet(sorted("ruleEvading"), options.threshold),
    ...runCosts([...sorted("ruleCorpus"), ...sorted("ruleEvading")], jevInputUsdPerMillion),
    stoppedAtCap,
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
    `${JSON.stringify({ run: "decision-shadow-2", model: model.identity, ...report }, null, 2)}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? ` (${String(error.code)})`
        : "";
    process.stderr.write(
      `decision shadow test failed${code}: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  });
}
