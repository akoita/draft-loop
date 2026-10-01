import { maximumCandidateKnowledgeRetrievalQueryLength } from "@draft-loop/domain";
import { evidenceQueryTerms } from "@draft-loop/storage/evidence-retrieval-precision";

const candidateKnowledgeSearchBoundsMessage =
  "Candidate knowledge search text exceeds the effective query limit; shorten unusually long terms and try again.";

/** Adapt only oversized lexical queries using the storage tokenizer's exact term projection. */
export function candidateKnowledgeSearchText(text: string): string {
  if (text.length <= maximumCandidateKnowledgeRetrievalQueryLength) return text;
  const searchText = evidenceQueryTerms(text).join(" ");
  if (searchText.length > maximumCandidateKnowledgeRetrievalQueryLength) {
    throw new Error(candidateKnowledgeSearchBoundsMessage);
  }
  return searchText;
}
