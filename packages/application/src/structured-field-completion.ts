import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import type { AuthorArtifactProposal } from "@draft-loop/schemas";

import { tokens } from "./claim-coverage.js";

type ProposalBlock = AuthorArtifactProposal["sections"][number]["blocks"][number];
type ProposalClaim = ProposalBlock["claims"][number];

interface Segment {
  /** Segment text exactly as it appears in the block, trimmed. */
  readonly text: string;
  /** Character offset of `text` in the block text. */
  readonly start: number;
}

// Field separators: `|`, `•`, `·`, `—`, `–`, `,`, `;`, line breaks, and `/`
// only when surrounded by whitespace. Commas between digits and dashes inside
// numeric ranges are kept; see `keepsSeparator`.
const separatorPattern = /[|•·—–,;\r\n]|(?<=\s)\/(?=\s)/gu;
const dashPattern = /^\p{Pd}$/u;
const digitPattern = /\p{N}/u;
const monthPattern =
  /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\.?$/u;
const openRangeEndPattern = /^(?:present|now|current|today|ongoing)$/u;
// A leading label of one to four words followed by a colon.
const labelPattern = /^([^\s:]+(?:[ \t]+[^\s:]+){0,3})[ \t]*:/u;
const letterOrDigit = /[\p{L}\p{N}]/u;

/** Normalize like the whole-block check, and collapse every dash with its surrounding space to `-`. */
function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\s*\p{Pd}\s*/gu, "-")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * A side of a dash is numeric when its nearest non-space token contains a
 * digit, or is a month name followed (away from the dash) by such a token,
 * as in "Jan 2019 – Dec 2021".
 */
function numericSide(nearestFirst: readonly string[]): boolean {
  const [nearest, next] = nearestFirst;
  if (nearest === undefined) return false;
  if (digitPattern.test(nearest)) return true;
  return (
    monthPattern.test(nearest.toLocaleLowerCase("en-US")) &&
    next !== undefined &&
    digitPattern.test(next)
  );
}

/** Keep thousands separators and numeric-range dashes inside one segment. */
function keepsSeparator(text: string, index: number, separator: string): boolean {
  if (separator === ",") {
    return digitPattern.test(text[index - 1] ?? "") && digitPattern.test(text[index + 1] ?? "");
  }
  if (!dashPattern.test(separator)) return false;
  const before = text
    .slice(0, index)
    .split(/\s+/u)
    .filter((word) => word !== "")
    .reverse();
  const after = text
    .slice(index + separator.length)
    .split(/\s+/u)
    .filter((word) => word !== "");
  return numericSide(before) && (numericSide(after) || openEndedSide(after));
}

/** An open range end such as "2019 – Present" stays one segment with its start. */
function openEndedSide(nearestFirst: readonly string[]): boolean {
  const nearest = nearestFirst[0]?.replace(/[^\p{L}]+$/u, "").toLocaleLowerCase("en-US");
  return nearest !== undefined && openRangeEndPattern.test(nearest);
}

function trimmedSegment(text: string, start: number): Segment | undefined {
  const leading = text.length - text.trimStart().length;
  const value = text.trim();
  if (!letterOrDigit.test(value)) return undefined;
  return { text: value, start: start + leading };
}

/** Split block text into trimmed field segments, splitting a leading `Label:` off each one. */
export function structuredFieldSegments(text: string): readonly Segment[] {
  const pieces: Segment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(separatorPattern)) {
    if (keepsSeparator(text, match.index, match[0])) continue;
    const piece = trimmedSegment(text.slice(cursor, match.index), cursor);
    if (piece !== undefined) pieces.push(piece);
    cursor = match.index + match[0].length;
  }
  const last = trimmedSegment(text.slice(cursor), cursor);
  if (last !== undefined) pieces.push(last);

  return pieces.flatMap((piece) => {
    const label = labelPattern.exec(piece.text);
    if (label === null) return [piece];
    const labelText = label[1] ?? "";
    return [
      trimmedSegment(labelText, piece.start),
      trimmedSegment(piece.text.slice(label[0].length), piece.start + label[0].length),
    ].filter((segment): segment is Segment => segment !== undefined);
  });
}

function isLetterOrDigit(character: string | undefined): boolean {
  return character !== undefined && letterOrDigit.test(character);
}

/**
 * Verbatim normalized match, with dash variants unified, bounded by
 * non-letter-or-digit characters or the string edges.
 */
export function containsBoundedField(evidenceText: string, field: string): boolean {
  const haystack = normalized(evidenceText);
  const needle = normalized(field);
  if (needle === "") return false;
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return false;
    const before = index === 0 ? undefined : [...haystack.slice(0, index)].at(-1);
    const after = [...haystack.slice(index + needle.length)][0];
    if (!isLetterOrDigit(before) && !isLetterOrDigit(after)) return true;
    from = index + 1;
  }
}

function claimCoveredPositions(
  words: readonly string[],
  claims: readonly ProposalClaim[],
): readonly boolean[] {
  const covered = words.map(() => false);
  for (const claim of claims) {
    if (!claim.substantive) continue;
    const claimWords = tokens(claim.text);
    if (claimWords.length === 0) continue;
    for (let start = 0; start <= words.length - claimWords.length; start += 1) {
      if (claimWords.every((word, offset) => words[start + offset] === word)) {
        covered.fill(true, start, start + claimWords.length);
      }
    }
  }
  return covered;
}

function sameClaim(left: ProposalClaim, right: ProposalClaim): boolean {
  return (
    left.text === right.text &&
    left.substantive === right.substantive &&
    left.evidenceChunkIds.length === right.evidenceChunkIds.length &&
    left.evidenceChunkIds.every((id, index) => right.evidenceChunkIds[index] === id)
  );
}

/**
 * Add one substantive claim per structured field (heading, contact line, or
 * list item) whose exact text appears in evidence. Blocks with substantive
 * claims search only the chunks those claims cite; blocks without any search
 * all retrieved evidence. Fields absent from evidence get no claim, and the
 * added claims still pass through every grounding check.
 */
export function completeStructuredFieldClaims(
  block: ProposalBlock,
  retrievedEvidence: readonly ScoredEvidenceChunk[],
): ProposalBlock {
  const substantiveClaims = block.claims.filter((claim) => claim.substantive);
  const citedIds = new Set(substantiveClaims.flatMap((claim) => claim.evidenceChunkIds));
  const searchable =
    substantiveClaims.length > 0
      ? retrievedEvidence.filter((chunk) => citedIds.has(chunk.id))
      : retrievedEvidence;
  if (searchable.length === 0) return block;

  const words = tokens(block.text);
  const covered = claimCoveredPositions(words, block.claims);
  const added: ProposalClaim[] = [];

  for (const segment of structuredFieldSegments(block.text)) {
    const segmentWords = tokens(segment.text);
    const offset = tokens(block.text.slice(0, segment.start)).length;
    const alignsWithBlock = segmentWords.every((word, index) => words[offset + index] === word);
    if (segmentWords.length === 0 || !alignsWithBlock) continue;
    if (segmentWords.every((_, index) => covered[offset + index])) continue;

    const evidenceChunkIds = searchable
      .filter((chunk) => containsBoundedField(chunk.text, segment.text))
      .map((chunk) => chunk.id);
    if (evidenceChunkIds.length === 0) continue;

    const claim: ProposalClaim = { text: segment.text, substantive: true, evidenceChunkIds };
    if ([...block.claims, ...added].some((existing) => sameClaim(existing, claim))) continue;
    added.push(claim);
  }

  return added.length === 0 ? block : { ...block, claims: [...block.claims, ...added] };
}
