/**
 * What a career profile derivation would send before it runs (#3182): the sources reused from the
 * latest version and those extracted again, their characters, the expected model calls and a cost
 * range. Content-free and computed without a model call, so a screen can show it before the
 * person starts a large extraction.
 */

import type { ModelPricing } from "@draft-loop/providers";

import { planCanonicalProfileExtractionCalls } from "./canonical-profile-extraction-plan.js";

/** The extraction model's output budget and price, when the deployment knows them. */
export interface CanonicalProfileExtractionBudget {
  readonly maxOutputTokens?: number | undefined;
  readonly pricing?: ModelPricing | undefined;
}

export interface CanonicalCandidateProfileDerivationEstimate {
  readonly reusedSourceCount: number;
  readonly extractedSourceCount: number;
  /** Characters of the sources that would be sent, after sensitivity filtering. */
  readonly extractedCharacters: number;
  /** Planned calls; the adaptive split after an output-limit failure can add a few. */
  readonly calls: number;
  /** In US dollars; null when the extraction model has no catalog price. */
  readonly estimatedUsd: { readonly low: number; readonly high: number } | null;
}

export interface EstimateCanonicalProfileExtractionInput {
  readonly sources: readonly { readonly id: string; readonly text: string }[];
  readonly reusedSourceCount: number;
  readonly budget?: CanonicalProfileExtractionBudget;
}

// Prose tokenizes near four characters a token; JSON-like and French text nearer three.
const inputCharactersPerTokenLow = 4;
const inputCharactersPerTokenHigh = 3;
// Each call also sends the extraction instructions and the output schema.
const promptTokensPerCall = 3_000;
// Measured extraction output per source character: 0.85 for prose, up to 1.33 for dense text
// (`pnpm test:profile-windows:live`, 2026-10-10); the window planner allows 1.6.
const outputTokensPerCharacterLow = 0.85;
const outputTokensPerCharacterHigh = 1.6;

const roundUsd = (value: number): number => Math.round(value * 100) / 100;

function usd(pricing: ModelPricing, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * pricing.inputUsdPerMillionTokens +
      outputTokens * pricing.outputUsdPerMillionTokens) /
    1_000_000
  );
}

/** The estimate for the sources a derivation would send now. */
export function estimateCanonicalProfileExtraction(
  input: EstimateCanonicalProfileExtractionInput,
): CanonicalCandidateProfileDerivationEstimate {
  const characters = input.sources.reduce((total, source) => total + source.text.length, 0);
  const planned = planCanonicalProfileExtractionCalls(input.sources, input.budget?.maxOutputTokens);
  const calls = planned?.length ?? (input.sources.length === 0 ? 0 : 1);
  const pricing = input.budget?.pricing;
  const estimatedUsd =
    pricing === undefined
      ? null
      : {
          low: roundUsd(
            usd(
              pricing,
              characters / inputCharactersPerTokenLow + calls * promptTokensPerCall,
              characters * outputTokensPerCharacterLow,
            ),
          ),
          high: roundUsd(
            usd(
              pricing,
              characters / inputCharactersPerTokenHigh + calls * promptTokensPerCall,
              characters * outputTokensPerCharacterHigh,
            ),
          ),
        };
  return {
    reusedSourceCount: input.reusedSourceCount,
    extractedSourceCount: input.sources.length,
    extractedCharacters: characters,
    calls,
    estimatedUsd,
  };
}
