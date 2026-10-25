/**
 * The critic's finding text as a person reads it. The critic sees the draft with internal ids,
 * for claims, job requirements and retrieved evidence, and is asked to quote them so the author
 * can act; the review screens name those things by their text instead. The run keeps the original
 * message, which the author's revision reads.
 */

const quoteLimit = 80;

function quoted(text: string): string {
  const single = text.replace(/\s+/gu, " ").trim();
  return `“${single.length > quoteLimit ? `${single.slice(0, quoteLimit - 1).trimEnd()}…` : single}”`;
}

function escaped(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** An id as the critic quotes it: bare, or in straight or curly quotes, or in backticks. */
function idPattern(id: string): RegExp {
  return new RegExp(`(['"‘“\`]?)${escaped(id)}(['"’”\`]?)`, "gu");
}

/** The model-facing evidence table's ids, and retrieved chunks named by a long hex id. */
const evidenceReference = /\bevidence-reference-\d+\b/gu;
const retrievedEvidence =
  /\bretrievedEvidence(?:\s+(?:ids?|IDs?|chunks?))?\s+['"`]?[0-9a-f]{12,}['"`]?/gu;
const bareChunkId = /(['"`]?)\b[0-9a-f]{24,}\b(['"`]?)/gu;
/** Ids the labels did not name, such as a claim of an earlier draft. */
const leftoverClaim = /(['"`]?)\bclaim-[A-Za-z0-9-]+(['"`]?)/gu;
const leftoverRequirement = /(['"`]?)\b(?:extraction-)?requirement-[A-Za-z0-9-]+(['"`]?)/gu;

export interface FindingLabels {
  /** Requirement id → the requirement's text. */
  readonly requirements?: ReadonlyMap<string, string>;
  /** Claim id → the claim's text in the reviewed draft. */
  readonly claims?: ReadonlyMap<string, string>;
}

export function readableFindingMessage(message: string, labels: FindingLabels = {}): string {
  let text = message;
  // Longer ids first, so an id that extends another is replaced whole.
  const named = [...(labels.requirements ?? []), ...(labels.claims ?? [])]
    .filter(([id, label]) => id.length > 0 && label.trim().length > 0)
    .sort(([left], [right]) => right.length - left.length);
  for (const [id, label] of named) text = text.replace(idPattern(id), quoted(label));
  return text
    .replace(retrievedEvidence, "the cited evidence")
    .replace(evidenceReference, "its cited evidence")
    .replace(bareChunkId, "the cited evidence")
    .replace(leftoverClaim, "a claim")
    .replace(leftoverRequirement, "a job requirement");
}
