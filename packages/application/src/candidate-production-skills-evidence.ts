import type {
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalStatus,
} from "@draft-loop/domain";

export const candidateProductionSkillsEvidenceQuery = "production experience";
export const candidateProductionSkillsEvidenceQueryLimit = 20;

const productionExperienceRecordPattern =
  /^[ \t]*(?:\*\*Production experience:\*\*|\*\*Production experience\*\*:|Production experience:)[ \t]*(.*?)[ \t]*$/iu;
const unavailableProductionExperiencePattern =
  /^(?:unavailable|not\s+(?:available|provided|listed|specified|applicable|recorded)|unknown|none\b|no\b|lack(?:s|ing)?(?:\s+of)?\b|n\s*\/\s*a\b)/iu;

/** Match only an explicit, substantive production-experience record. */
export function isProductionSkillsRecord(text: string): boolean {
  return text.split(/\r\n|[\r\n]/u).some((line) => {
    const match = productionExperienceRecordPattern.exec(line);
    const body = match?.[1]
      ?.replace(/\*+$/u, "")
      .replace(/^(?:[-*•–—]\s*)+/u, "")
      .trim();
    return (
      body !== undefined &&
      /[\p{L}\p{N}]/u.test(body) &&
      !unavailableProductionExperiencePattern.test(body)
    );
  });
}

/** Select the first valid record from matched results, preserving retrieval order. */
export function selectCandidateProductionSkillsEvidence(result: {
  readonly status: CandidateKnowledgeRetrievalStatus;
  readonly hits: readonly CandidateKnowledgeLexicalHit[];
}): CandidateKnowledgeLexicalHit | undefined {
  if (result.status !== "matched") return undefined;
  return result.hits.find(({ text }) => isProductionSkillsRecord(text));
}
