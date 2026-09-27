import type {
  CandidateKnowledgeLexicalHit,
  CandidateKnowledgeRetrievalStatus,
} from "@draft-loop/domain";

export const candidateContactEvidenceQuery =
  "contact identity header email phone telephone linkedin";
export const candidateContactEvidenceQueryLimit = 20;

export interface CandidateContactEvidenceQueryResult {
  readonly status: CandidateKnowledgeRetrievalStatus;
  readonly hits: readonly CandidateKnowledgeLexicalHit[];
}

const contactRecordLabelPattern =
  /^\s{0,3}(?:#{1,6}\s*)?(?:[-*•]\s*)?(?:\*\*)?(?:candidate\s+(?:contact|identity|header)|(?:contact|identity|header)(?:\s*(?:\/|&)\s*(?:contact|identity|header))*|contact(?:\s+(?:details|information))?|cv\s+header|profile\s+header)(?:(?:\*\*)\s*[:.]?|[:.]\s*(?:\*\*)?)\s*/iu;
const emailPattern =
  /\b([\p{L}\p{N}.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?)+)\b/giu;
const phonePattern =
  /\b(?:phone|telephone|mobile|tel)(?:\s+(?:number|no\.?))?\s*[:=]\s*([+\d().\s-]+)/iu;
const linkedInProfilePattern = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[a-z\d_%.-]+\/?/iu;
const disallowedContactClausePattern =
  /\b(?:do\s+not|example|fake|placeholder|sample|template|unavailable|none|not\s+(?:provided|available|listed|recorded)|your[-_.\s]+(?:name|email|phone)|policy|instructions?|company|employer|recruiter|hiring)\b|<[^>]+>/iu;
const companyContactPattern =
  /^\s{0,3}(?:#{1,6}\s*)?(?:\*\*)?company\s+(?:contact|identity|header)\b/iu;

function contactClauses(line: string, labelEnd: number): string[] {
  return line
    .slice(labelEnd)
    .split(/\s*[|;]\s*|(?<=[.!?])\s+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== "");
}

function hasUsableEmail(clause: string): boolean {
  for (const match of clause.matchAll(emailPattern)) {
    const address = match[1];
    if (address !== undefined) return true;
  }
  return false;
}

function hasLabeledPhone(clause: string): boolean {
  const match = phonePattern.exec(clause);
  if (match === null) return false;
  const digits = match[1]?.replace(/\D/gu, "") ?? "";
  return digits.length >= 7;
}

/** Accept only an explicit, substantive candidate contact/header clause. */
export function isCandidateContactRecord(text: string): boolean {
  return text.split(/\r\n|[\r\n]/u).some((line) => {
    const label = contactRecordLabelPattern.exec(line);
    if (label === null || companyContactPattern.test(line)) return false;
    return contactClauses(line, label[0].length).some(
      (clause) =>
        !disallowedContactClausePattern.test(clause) &&
        (hasUsableEmail(clause) || hasLabeledPhone(clause) || linkedInProfilePattern.test(clause)),
    );
  });
}

/** Select one unchanged contact record from matched pinned-source results. */
export function selectCandidateContactEvidence(
  result: CandidateContactEvidenceQueryResult,
): CandidateKnowledgeLexicalHit | undefined {
  if (result.status !== "matched") return undefined;
  return result.hits.find(({ text }) => isCandidateContactRecord(text));
}
