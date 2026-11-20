import type { CanonicalCandidateProfileExtractionSource } from "./candidate-profile-extraction.js";
import {
  type CanonicalProfileExtractionControls,
  type CanonicalProfileExtractionExecutor,
  executeCanonicalProfileExtractionWithFallback,
} from "./canonical-profile-extraction-fallback.js";
import { createCanonicalProfileExtractionPartCache } from "./canonical-profile-extraction-parts.js";

/**
 * The employment-detail live check (#2722): short, made-up pasted career notes that state a
 * salary and a reason for leaving go through the real extraction prompt once, and the check
 * reports whether both come back as `employment-detail` facts. No candidate material is read.
 */

/** Invented notes in the shape a candidate pastes; every name and number is made up. */
export const profileDetailLiveCheckNotes = `Career notes

Tidewater Energy Data, Platform Engineer, March 2021 to June 2024.
- Moved the billing jobs from cron to a Kafka pipeline, cutting failed runs by 40%.
- Ran the on-call rota for six engineers.
- Final salary: 64,000 EUR a year.
- Reason for leaving: the Lyon office closed and I did not want to relocate.

Copperleaf Insurance, Backend Engineer, 2018 to 2021.
- Built the claims API in Kotlin.
`;

export interface ProfileDetailLiveCheckResult {
  readonly company: string;
  readonly modelId: string;
  readonly completed: boolean;
  readonly factCount: number | null;
  readonly employmentDetailFacts: number;
  readonly salaryKept: boolean;
  readonly reasonForLeavingKept: boolean;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly passed: boolean;
}

interface ProposedFact {
  readonly category?: unknown;
  readonly field?: unknown;
  readonly value?: unknown;
}

const mentions = (fact: ProposedFact, pattern: RegExp): boolean =>
  pattern.test(`${String(fact.field ?? "")} ${String(fact.value ?? "")}`);

/** Extracts the notes once and checks that the salary and the reason for leaving are kept. */
export async function runProfileDetailLiveCheck(input: {
  readonly executor: CanonicalProfileExtractionExecutor;
  readonly controls: Omit<CanonicalProfileExtractionControls, "partCache">;
}): Promise<ProfileDetailLiveCheckResult> {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  const executor: CanonicalProfileExtractionExecutor = {
    execute: async (request) => {
      const response = await input.executor.execute(request);
      inputTokens = (inputTokens ?? 0) + response.usage.inputTokens;
      outputTokens = (outputTokens ?? 0) + response.usage.outputTokens;
      return response;
    },
  };
  const source: CanonicalCandidateProfileExtractionSource = {
    id: "synthetic-notes",
    mediaType: "text/markdown",
    checksum: `synthetic-notes-${profileDetailLiveCheckNotes.length}`,
    text: profileDetailLiveCheckNotes,
  };
  let facts: readonly ProposedFact[] | null = null;
  try {
    const output = await executeCanonicalProfileExtractionWithFallback(
      executor,
      { operationId: "profile-detail-live-check", sources: [source] },
      { ...input.controls, partCache: createCanonicalProfileExtractionPartCache() },
    );
    facts = Array.isArray(output.facts) ? (output.facts as readonly ProposedFact[]) : null;
  } catch {
    facts = null;
  }
  const details = (facts ?? []).filter((fact) => fact.category === "employment-detail");
  const salaryKept = details.some((fact) => mentions(fact, /salary|64,000/iu));
  const reasonForLeavingKept = details.some((fact) => mentions(fact, /leav|relocate|closed/iu));
  return {
    company: input.controls.model.company,
    modelId: input.controls.model.modelId,
    completed: facts !== null,
    factCount: facts?.length ?? null,
    employmentDetailFacts: details.length,
    salaryKept,
    reasonForLeavingKept,
    inputTokens,
    outputTokens,
    passed: facts !== null && salaryKept && reasonForLeavingKept,
  };
}
