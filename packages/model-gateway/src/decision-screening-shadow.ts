import {
  createDecisionModel,
  type DecisionModel,
  DecisionModelError,
  type DecisionModelIdentity,
  defaultScreeningThreshold,
  type ScreeningProbabilities,
  screeningProbabilities,
  screeningQuestions,
  screeningSignalsAt,
} from "@draft-loop/providers/decisions";

/**
 * The hosted screening shadow (#2247): after the rules have screened a public job page, a decision
 * model answers the screening judgments for the same text, and one content-free log line records
 * how its signals compare with the stored verdict. It never changes a verdict, a stored result or
 * quarantine, and it never throws. Only job-page text reaches it: the caller checks the kind, and
 * every request states that it carries no sensitive data.
 */

/** Jev's published input price; output is free. */
export const jevInputUsdPerMillion = 0.042;

/** A job page is cut here before it is sent: about 20,000 tokens, well inside the cap. */
export const screeningShadowMaxChars = 60_000;

export const screeningShadowTimeoutMs = 2_000;

export interface ScreeningShadowLog {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

export interface ScreeningShadowInput {
  readonly text: string;
  readonly tenantId: string;
  /** The stored screening result the shadow is compared with. */
  readonly resultId: string;
  readonly verdict: string;
  readonly signals: readonly string[];
  readonly log: ScreeningShadowLog;
}

export interface DecisionScreeningShadow {
  readonly identity: DecisionModelIdentity;
  /** Resolves once the line is logged; a failure is logged too, never thrown. */
  observe(input: ScreeningShadowInput): Promise<void>;
}

export interface DecisionScreeningShadowOptions {
  readonly model: DecisionModel;
  /** Spend per UTC day; calls stop for the rest of the day once recorded usage reaches it. */
  readonly maxDailyUsd: number;
  readonly inputUsdPerMillion?: number;
  readonly threshold?: number;
  readonly now?: () => Date;
}

type Agreement = "both" | "screening-only" | "model-only" | "neither";

function rounded(probabilities: ScreeningProbabilities): Record<string, number | null> {
  return Object.fromEntries(
    Object.entries(probabilities).map(([name, value]) => [
      name,
      value === null ? null : Math.round(value * 100) / 100,
    ]),
  );
}

export function createDecisionScreeningShadow(
  options: DecisionScreeningShadowOptions,
): DecisionScreeningShadow {
  const { model, maxDailyUsd } = options;
  if (!Number.isFinite(maxDailyUsd) || maxDailyUsd <= 0) {
    throw new RangeError("The screening shadow's daily cap must be a positive number.");
  }
  const price = options.inputUsdPerMillion ?? jevInputUsdPerMillion;
  const threshold = options.threshold ?? defaultScreeningThreshold;
  const now = options.now ?? (() => new Date());
  let day = "";
  let spentUsd = 0;
  let capLogged = false;

  return {
    identity: model.identity,
    observe: async (input) => {
      const base = {
        tenantId: input.tenantId,
        resultId: input.resultId,
        vendor: model.identity.vendor,
      };
      const today = now().toISOString().slice(0, 10);
      if (today !== day) {
        day = today;
        spentUsd = 0;
        capLogged = false;
      }
      if (spentUsd >= maxDailyUsd) {
        if (!capLogged) {
          capLogged = true;
          input.log.warn(
            { screeningShadow: { ...base, maxDailyUsd } },
            "content screening shadow daily cap reached",
          );
        }
        return;
      }
      const truncated = input.text.length > screeningShadowMaxChars;
      const started = performance.now();
      try {
        const result = await model.decide({
          input: truncated ? input.text.slice(0, screeningShadowMaxChars) : input.text,
          questions: screeningQuestions(),
          // A public job page: third-party text, never candidate material.
          dataPolicy: {
            allowTransmission: true,
            allowedVendors: [model.identity.vendor],
            sensitiveData: false,
            sensitiveDataAcknowledged: false,
          },
        });
        const inputTokens = result.usage?.inputTokens ?? 0;
        const estimatedUsd = (inputTokens / 1_000_000) * price;
        spentUsd += estimatedUsd;
        const probabilities = screeningProbabilities(result.answers);
        const signals = screeningSignalsAt(probabilities, threshold);
        const flagged = input.verdict !== "clear";
        const agreement: Agreement =
          signals.length > 0
            ? flagged
              ? "both"
              : "model-only"
            : flagged
              ? "screening-only"
              : "neither";
        input.log.info(
          {
            screeningShadow: {
              ...base,
              model: result.model,
              requestId: result.requestId,
              threshold,
              verdict: input.verdict,
              screeningSignals: [...input.signals],
              modelSignals: [...signals],
              agreement,
              probabilities: rounded(probabilities),
              truncated,
              latencyMs: Math.round(performance.now() - started),
              inputTokens,
              estimatedUsd,
            },
          },
          "content screening shadow",
        );
      } catch (error) {
        input.log.warn(
          {
            screeningShadow: {
              ...base,
              code: error instanceof DecisionModelError ? error.code : "unknown",
              latencyMs: Math.round(performance.now() - started),
            },
          },
          "content screening shadow failed",
        );
      }
    },
  };
}

/** The Jev shadow the API runs, with its key and the shadow's short timeout. */
export function createJevScreeningShadow(options: {
  readonly apiKey: string;
  readonly maxDailyUsd: number;
}): DecisionScreeningShadow {
  return createDecisionScreeningShadow({
    model: createDecisionModel({ apiKey: options.apiKey, timeoutMs: screeningShadowTimeoutMs }),
    maxDailyUsd: options.maxDailyUsd,
  });
}
