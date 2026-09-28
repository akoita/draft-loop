import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalHit,
} from "@draft-loop/domain";
import {
  createCandidateKnowledgeLexicalHit,
  maximumCandidateKnowledgeRetrievalChunkTextLength,
} from "@draft-loop/domain";
import {
  isCandidateEvidenceIdCommentLine,
  isLeadingMarkdownHeadingOnly,
  parseLeadingMarkdownHeading,
} from "./candidate-knowledge-heading.js";
import { lexicalDigest } from "./candidate-knowledge-source-chunks.js";
import {
  matchesRequiredSectionEvidence,
  matchesRequiredSectionHeading,
} from "./required-section-evidence.js";

const markdownHeadingPattern = /^\s{0,3}(#{1,6})\s+/u;

interface BodySlice {
  readonly chunkId: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly text: string;
}

function provenanceKey(value: {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly sourceId: string;
  readonly versionId: string;
}): string {
  return JSON.stringify([value.storeId, value.knowledgeBaseId, value.sourceId, value.versionId]);
}

/**
 * Join a matched section heading to its adjacent pinned-source body. The
 * heading itself is never sufficient evidence, and no following section may
 * leak into the composed record.
 */
export function composeCandidateRequiredSectionBodyEvidence(
  section: string,
  headingHit: CandidateKnowledgeLexicalHit,
  pinnedSourceChunks: readonly CandidateKnowledgeLexicalChunkInput[],
): CandidateKnowledgeLexicalHit | undefined {
  const heading = parseLeadingMarkdownHeading(headingHit.text);
  if (
    heading === undefined ||
    !isLeadingMarkdownHeadingOnly(headingHit.text) ||
    !matchesRequiredSectionHeading(section, headingHit.text)
  ) {
    return undefined;
  }

  const exact = pinnedSourceChunks.find((chunk) => chunk.chunkId === headingHit.chunkId);
  if (
    exact === undefined ||
    exact.text !== headingHit.text ||
    exact.ordinal !== headingHit.ordinal ||
    exact.lineStart !== headingHit.lineStart ||
    exact.lineEnd !== headingHit.lineEnd ||
    provenanceKey(exact.metadata.provenance) !== provenanceKey(headingHit.metadata.provenance)
  ) {
    throw new Error("Required-section heading did not match its pinned source chunk.");
  }

  const sameSource = pinnedSourceChunks
    .filter(
      (chunk) =>
        provenanceKey(chunk.metadata.provenance) === provenanceKey(exact.metadata.provenance),
    )
    .sort((left, right) => left.ordinal - right.ordinal);
  const headingIndex = sameSource.findIndex((chunk) => chunk.chunkId === exact.chunkId);
  if (headingIndex < 0) {
    throw new Error("Required-section heading source order could not be verified.");
  }

  const headingLines = exact.text.split(/\r?\n/u);
  if (exact.lineEnd !== exact.lineStart + headingLines.length - 1) {
    throw new Error("Required-section heading locator could not be verified.");
  }
  const headingLineStart = exact.lineStart + heading.lineIndex;
  const headingLine = headingLines[heading.lineIndex];
  if (headingLine === undefined || headingLine !== heading.line) {
    throw new Error("Required-section heading line could not be verified.");
  }

  const bodySlices: BodySlice[] = [];
  let stoppedAtSectionBoundary = false;
  for (const chunk of sameSource.slice(headingIndex + 1)) {
    const lines = chunk.text.split(/\r?\n/u);
    if (chunk.lineEnd !== chunk.lineStart + lines.length - 1) {
      throw new Error("Required-section body locator could not be verified.");
    }
    let firstBodyIndex = isCandidateEvidenceIdCommentLine(lines[0] ?? "") ? 1 : 0;
    let boundaryIndex = lines.length;
    for (let index = firstBodyIndex; index < lines.length; index += 1) {
      const level = markdownHeadingPattern.exec(lines[index] ?? "")?.[1]?.length;
      if (level !== undefined && level <= heading.level) {
        boundaryIndex = index;
        stoppedAtSectionBoundary = true;
        break;
      }
    }

    const bodyLines = lines.slice(firstBodyIndex, boundaryIndex);
    while (bodyLines[0]?.trim() === "") {
      bodyLines.shift();
      firstBodyIndex += 1;
    }
    while (bodyLines.at(-1)?.trim() === "") bodyLines.pop();
    const bodyText = bodyLines.join("\n");
    if (bodyText.trim() !== "") {
      const lineStart = chunk.lineStart + firstBodyIndex;
      bodySlices.push({
        chunkId: chunk.chunkId,
        lineStart,
        lineEnd: lineStart + bodyLines.length - 1,
        text: bodyText,
      });
    }
    if (stoppedAtSectionBoundary) break;
  }

  if (bodySlices.length === 0) return undefined;
  const text = [headingLine, ...bodySlices.map(({ text: body }) => body)].join("\n\n");
  if (text.length > maximumCandidateKnowledgeRetrievalChunkTextLength) {
    throw new Error("Required-section evidence exceeded its bounded record size.");
  }

  const composed = createCandidateKnowledgeLexicalHit({
    chunkId: lexicalDigest([
      "candidate-knowledge-required-section-body-v1",
      section.normalize("NFKC").toLocaleLowerCase("en-US"),
      exact.metadata.provenance.storeId,
      exact.metadata.provenance.knowledgeBaseId,
      exact.metadata.provenance.sourceId,
      exact.metadata.provenance.versionId,
      exact.chunkId,
      headingHit.text,
      headingLineStart,
      ...bodySlices.flatMap((slice) => [slice.chunkId, slice.lineStart, slice.lineEnd, slice.text]),
    ]),
    ordinal: headingHit.ordinal,
    lineStart: headingLineStart,
    lineEnd: bodySlices.at(-1)?.lineEnd ?? headingLineStart,
    text,
    metadata: headingHit.metadata,
    bm25Rank: headingHit.bm25Rank,
  });

  return matchesRequiredSectionEvidence(section, composed.text) ? composed : undefined;
}
