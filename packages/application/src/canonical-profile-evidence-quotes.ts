import { maximumCanonicalCandidateProfileValueLength } from "@draft-loop/domain";
import type { CanonicalCandidateProfileExtractionProposal } from "@draft-loop/schemas";
import { createEvidenceSourceIndex, valueOccursInQuote } from "./evidence-text-normalization.js";

/**
 * Replace a quote that matches its source only after Markdown formatting or typographic
 * punctuation is ignored with the exact source substring it matched, so quotes stay verbatim.
 * The value must remain inside the replacement; anything else is left for the grounding checks.
 */
export function repairCanonicalProfileEvidenceQuotes(
  proposal: CanonicalCandidateProfileExtractionProposal,
  sourceTexts: ReadonlyMap<string, string>,
): CanonicalCandidateProfileExtractionProposal {
  const sourceIndex = createEvidenceSourceIndex(sourceTexts);
  let changed = false;
  const facts = proposal.facts.map((fact) => {
    let evidenceChanged = false;
    const evidence = fact.evidence.map((item) => {
      const exactQuote = sourceIndex.locateExactQuote(item.sourceId, item.quote);
      if (
        exactQuote === undefined ||
        exactQuote.length > maximumCanonicalCandidateProfileValueLength ||
        !valueOccursInQuote(fact.value, exactQuote)
      ) {
        return item;
      }
      evidenceChanged = true;
      changed = true;
      return { ...item, quote: exactQuote };
    });
    return evidenceChanged ? { ...fact, evidence } : fact;
  });

  return changed ? { ...proposal, facts } : proposal;
}
