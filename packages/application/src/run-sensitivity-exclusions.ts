import type { ContextSnapshot } from "@draft-loop/domain";

import {
  type CandidateKnowledgeSensitivityExclusions,
  createCandidateKnowledgeSensitivityExclusions,
} from "./candidate-knowledge-sensitivity-exclusion.js";
import {
  excludedSensitivityTiersForConsent,
  readSensitiveKnowledgeConsent,
} from "./sensitive-knowledge-consent.js";

/**
 * Build the run's withheld-section filter from the workspace's sensitive-knowledge consent.
 *
 * The consent is read once per start or resume, before retrieval or any provider request; an
 * invalid consent file throws and stops the run. One filter serves both retrieval and the
 * outgoing-request guard so they cannot disagree. Without a pinned knowledge selection nothing is
 * withheld and the consent is not consulted.
 */
export async function runSensitivityExclusions(
  root: string,
  config: {
    readonly candidateKnowledgeSelection?: {
      readonly entries: readonly { readonly storeRoot: string; readonly knowledgeBaseId: string }[];
    };
  },
  context: Pick<ContextSnapshot, "candidateKnowledgeSelection">,
): Promise<CandidateKnowledgeSensitivityExclusions | undefined> {
  const binding = config.candidateKnowledgeSelection;
  const selection = context.candidateKnowledgeSelection;
  if (binding === undefined || selection === undefined) return undefined;
  const consent = await readSensitiveKnowledgeConsent(root);
  return createCandidateKnowledgeSensitivityExclusions(binding.entries, selection, {
    excludedTiers: excludedSensitivityTiersForConsent(consent.allowSensitive),
  });
}
