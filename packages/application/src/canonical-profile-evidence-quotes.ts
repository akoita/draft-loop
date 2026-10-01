import type { CanonicalCandidateProfileExtractionProposal } from "@draft-loop/schemas";

const outerEmphasisPairs = ["**", "__", "*", "_"] as const;

function normalizeEvidenceText(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

function quoteSupportsValue(quote: string, sourceText: string, value: string): boolean {
  const normalizedQuote = normalizeEvidenceText(quote);
  const normalizedValue = normalizeEvidenceText(value);
  return (
    normalizedQuote.length > 0 &&
    normalizedValue.length > 0 &&
    normalizeEvidenceText(sourceText).includes(normalizedQuote) &&
    normalizedQuote.includes(normalizedValue)
  );
}

function removeOneOuterEmphasisPair(quote: string): string | undefined {
  for (const pair of outerEmphasisPairs) {
    if (quote.length <= pair.length * 2 || !quote.startsWith(pair) || !quote.endsWith(pair)) {
      continue;
    }
    const inner = quote.slice(pair.length, -pair.length);
    return normalizeEvidenceText(inner).length === 0 ? undefined : inner;
  }
  return undefined;
}

/** Remove one outer emphasis pair only when the unchanged value remains exactly grounded. */
export function repairCanonicalProfileEvidenceQuotes(
  proposal: CanonicalCandidateProfileExtractionProposal,
  sourceTexts: ReadonlyMap<string, string>,
): CanonicalCandidateProfileExtractionProposal {
  let changed = false;
  const facts = proposal.facts.map((fact) => {
    let evidenceChanged = false;
    const evidence = fact.evidence.map((item) => {
      const sourceText = sourceTexts.get(item.sourceId);
      if (sourceText === undefined || quoteSupportsValue(item.quote, sourceText, fact.value)) {
        return item;
      }
      const candidateQuote = removeOneOuterEmphasisPair(item.quote);
      if (
        candidateQuote === undefined ||
        !quoteSupportsValue(candidateQuote, sourceText, fact.value)
      ) {
        return item;
      }
      evidenceChanged = true;
      changed = true;
      return { ...item, quote: candidateQuote };
    });
    return evidenceChanged ? { ...fact, evidence } : fact;
  });

  return changed ? { ...proposal, facts } : proposal;
}
