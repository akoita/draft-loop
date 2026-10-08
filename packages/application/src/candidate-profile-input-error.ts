import {
  maximumCanonicalCandidateProfileExtractionCharacters,
  maximumCanonicalCandidateProfileExtractionSourceCharacters,
} from "./candidate-profile-extraction.js";

const numberFormat = new Intl.NumberFormat("en-US");

/** Wording shared with source derivation for one source over the per-source limit. */
export function candidateProfileSourceTooLargeMessage(): string {
  return `A selected source is longer than the ${numberFormat.format(
    maximumCanonicalCandidateProfileExtractionSourceCharacters,
  )}-character limit for profile derivation. Split it into smaller files and derive again.`;
}

export function candidateProfileSourceEmptyMessage(): string {
  return "A selected source has no extractable text. Check that each file contains readable text.";
}

export function candidateProfileTotalTooLargeMessage(characterCount: number): string {
  return `The selected career evidence is too large for one profile: ${numberFormat.format(
    characterCount,
  )} characters after removing duplicates, limit ${numberFormat.format(
    maximumCanonicalCandidateProfileExtractionCharacters,
  )}. Remove or split sources and try again.`;
}

/** Input-preparation failure whose user message is fixed and free of source content or ids. */
export class CandidateProfileInputError extends Error {
  readonly userMessage: string;

  constructor(userMessage: string) {
    super(userMessage);
    this.name = "CandidateProfileInputError";
    this.userMessage = userMessage;
  }
}
