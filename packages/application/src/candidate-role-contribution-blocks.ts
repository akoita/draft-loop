import type {
  CandidateKnowledgeLexicalChunkInput,
  CandidateKnowledgeLexicalHit,
} from "@draft-loop/domain";

const markdownHeadingPattern = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/u;
const datedMarkdownHeadingPattern =
  /^\s*#{1,6}\s+[^\n]*(?:19|20)\d{2}[^\n]*(?:\bto\b|[–—-])[^\n]*(?:(?:19|20)\d{2}|present|current|now)\b/iu;
const standaloneContributionLabelPattern =
  /^\s{0,3}(?:\*\*)?(?:his work|contributions|achievements|responsibilities)\s*:(?:\*\*)?\s*$/iu;
const contributionHeadingLabels = new Set([
  "cv-usable facts",
  "contributions",
  "achievements",
  "responsibilities",
]);
const listItemIndentPattern = /^( *)(?:[-*+]|\d+[.)])\s+\S/u;
const indentedContinuationPattern = /^\s{2,}\S/u;

export interface CandidateRoleContributionSourceSegment {
  readonly chunkId: string;
  readonly ordinal: number;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface CandidateRoleContributionSourceLine {
  readonly lineNumber: number;
  text: string;
  readonly segments: CandidateRoleContributionSourceSegment[];
}

export interface CandidateRoleContributionSourceRange {
  readonly chunkId: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

export interface CandidateRoleContributionBlock {
  readonly text: string;
  readonly lineStart: number;
  readonly lineEnd: number;
  readonly sourceRanges: readonly CandidateRoleContributionSourceRange[];
  readonly sourceOrder: number;
}

export interface CandidateRoleContributionSelection {
  /** True when a recognized, nonempty preferred region was found. */
  readonly foundRegion: boolean;
  readonly blocks: readonly CandidateRoleContributionBlock[];
}

interface ContributionAnchor {
  readonly index: number;
  readonly markdownLevel: number | undefined;
}

function provenanceKey(chunk: CandidateKnowledgeLexicalChunkInput): string {
  const { storeId, knowledgeBaseId, sourceId, versionId } = chunk.metadata.provenance;
  return JSON.stringify([storeId, knowledgeBaseId, sourceId, versionId]);
}

export function flattenCandidateRoleContributionSourceLines(
  chunks: readonly CandidateKnowledgeLexicalChunkInput[],
): CandidateRoleContributionSourceLine[] | undefined {
  const lines: CandidateRoleContributionSourceLine[] = [];
  const expectedProvenance = chunks[0] === undefined ? undefined : provenanceKey(chunks[0]);
  for (const chunk of [...chunks].sort((left, right) => left.ordinal - right.ordinal)) {
    if (
      expectedProvenance === undefined ||
      provenanceKey(chunk) !== expectedProvenance ||
      chunk.text.trim() === ""
    ) {
      return undefined;
    }
    const parts = chunk.text.split("\n");
    if (chunk.lineEnd !== chunk.lineStart + parts.length - 1) return undefined;
    let offset = 0;
    for (const [index, part] of parts.entries()) {
      const lineNumber = chunk.lineStart + index;
      const segment: CandidateRoleContributionSourceSegment = {
        chunkId: chunk.chunkId,
        ordinal: chunk.ordinal,
        startOffset: offset,
        endOffset: offset + part.length,
      };
      const previous = lines.at(-1);
      if (previous?.lineNumber === lineNumber) {
        previous.text += part;
        previous.segments.push(segment);
      } else {
        if (previous !== undefined && lineNumber < previous.lineNumber) return undefined;
        lines.push({ lineNumber, text: part, segments: [segment] });
      }
      offset += part.length + 1;
    }
  }
  return lines;
}

function headingLevel(line: string): number | undefined {
  return markdownHeadingPattern.exec(line)?.[1]?.length;
}

export function isDatedCandidateRoleHeading(line: string): boolean {
  return datedMarkdownHeadingPattern.test(line);
}

function normalizedAnchorTitle(line: string): string | undefined {
  const markdown = markdownHeadingPattern.exec(line);
  const title = markdown?.[2] ?? (standaloneContributionLabelPattern.test(line) ? line : undefined);
  if (title === undefined) return undefined;
  return title
    .replace(/^\s*\*\*/u, "")
    .replace(/\*\*\s*$/u, "")
    .replace(/:\s*$/u, "")
    .trim()
    .normalize("NFKC")
    .toLocaleLowerCase("en-US");
}

function isContributionAnchor(line: string): boolean {
  const title = normalizedAnchorTitle(line);
  return title !== undefined && (title === "his work" || contributionHeadingLabels.has(title));
}

function findAnchors(
  lines: readonly CandidateRoleContributionSourceLine[],
  start: number,
): ContributionAnchor[] {
  const anchors: ContributionAnchor[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line !== undefined && isContributionAnchor(line.text)) {
      const markdown = markdownHeadingPattern.exec(line.text);
      anchors.push({ index, markdownLevel: markdown?.[1]?.length });
    }
  }
  return anchors;
}

export function createCandidateRoleContributionBlock(
  lines: readonly CandidateRoleContributionSourceLine[],
  sourceOrder: number,
): CandidateRoleContributionBlock {
  const contentLines = [...lines];
  while (contentLines.at(-1)?.text.trim() === "") contentLines.pop();
  const text = contentLines
    .map((line, index) => {
      if (index === 0) return line.text;
      const previous = contentLines[index - 1];
      if (previous === undefined) return line.text;
      return `${"\n".repeat(Math.max(1, line.lineNumber - previous.lineNumber))}${line.text}`;
    })
    .join("");
  const ranges = new Map<string, { ordinal: number; startOffset: number; endOffset: number }>();
  for (const line of contentLines) {
    for (const segment of line.segments) {
      const range = ranges.get(segment.chunkId);
      if (range === undefined) {
        ranges.set(segment.chunkId, {
          ordinal: segment.ordinal,
          startOffset: segment.startOffset,
          endOffset: segment.endOffset,
        });
      } else {
        range.startOffset = Math.min(range.startOffset, segment.startOffset);
        range.endOffset = Math.max(range.endOffset, segment.endOffset);
      }
    }
  }
  return {
    text,
    lineStart: contentLines[0]?.lineNumber ?? 0,
    lineEnd: contentLines.at(-1)?.lineNumber ?? 0,
    sourceRanges: [...ranges.entries()]
      .sort((left, right) => left[1].ordinal - right[1].ordinal)
      .map(([chunkId, range]) => ({
        chunkId,
        startOffset: range.startOffset,
        endOffset: range.endOffset,
      })),
    sourceOrder,
  };
}

function isNestedListContinuation(line: string): boolean {
  return indentedContinuationPattern.test(line);
}

function listItemIndent(line: string): number | undefined {
  const match = listItemIndentPattern.exec(line);
  return match === null ? undefined : (match[1]?.length ?? 0);
}

export function parseCandidateRoleContributionBlocks(
  lines: readonly CandidateRoleContributionSourceLine[],
  firstSourceOrder: number,
): CandidateRoleContributionBlock[] {
  const blocks: CandidateRoleContributionBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const first = lines[index];
    if (first === undefined) break;
    const item: CandidateRoleContributionSourceLine[] = [first];
    let cursor = index + 1;
    const firstListIndent = listItemIndent(first.text);
    if (firstListIndent !== undefined) {
      while (cursor < lines.length) {
        const next = lines[cursor];
        const previous = lines[cursor - 1];
        if (next === undefined || previous === undefined) break;
        const nextListIndent = listItemIndent(next.text);
        if (nextListIndent !== undefined && nextListIndent <= firstListIndent) break;
        const hasBlankGap = next.lineNumber > previous.lineNumber + 1;
        if (hasBlankGap && !isNestedListContinuation(next.text)) break;
        item.push(next);
        cursor += 1;
      }
    } else {
      while (cursor < lines.length) {
        const next = lines[cursor];
        const previous = lines[cursor - 1];
        if (
          next === undefined ||
          previous === undefined ||
          listItemIndent(next.text) !== undefined ||
          next.lineNumber > previous.lineNumber + 1
        ) {
          break;
        }
        item.push(next);
        cursor += 1;
      }
    }
    blocks.push(createCandidateRoleContributionBlock(item, firstSourceOrder + blocks.length));
    index = cursor;
  }
  return blocks;
}

function lexicalOverlap(query: string, text: string): number {
  const queryTerms = new Set(query.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []);
  if (queryTerms.size === 0) return 0;
  const blockTerms = new Set(text.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []);
  let overlap = 0;
  for (const term of queryTerms) if (blockTerms.has(term)) overlap += 1;
  return overlap;
}

/** Select whole job-relevant blocks only from a role's explicit contribution region. */
export function selectCandidateRoleContributionBlocks(
  roleHeading: CandidateKnowledgeLexicalHit,
  roleScopeChunks: readonly CandidateKnowledgeLexicalChunkInput[],
  jobQuery: string,
  maximumRecordCharacters: number,
): CandidateRoleContributionSelection {
  const lines = flattenCandidateRoleContributionSourceLines(roleScopeChunks);
  if (lines === undefined) return { foundRegion: false, blocks: [] };
  const roleLineIndex = lines.findIndex(
    (line) => line.lineNumber === roleHeading.lineStart && headingLevel(line.text) !== undefined,
  );
  const roleLine = lines[roleLineIndex];
  if (roleLineIndex < 0 || roleLine === undefined) return { foundRegion: false, blocks: [] };
  const anchors = findAnchors(lines, roleLineIndex + 1);
  let selectedRegion: CandidateRoleContributionBlock[] = [];
  for (const [anchorPosition, anchor] of anchors.entries()) {
    let end = lines.length;
    for (let index = anchor.index + 1; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined) continue;
      const level = headingLevel(line.text);
      if (
        isDatedCandidateRoleHeading(line.text) ||
        isContributionAnchor(line.text) ||
        (level !== undefined &&
          (anchor.markdownLevel === undefined || level <= anchor.markdownLevel))
      ) {
        end = index;
        break;
      }
    }
    const regionLines = lines.slice(anchor.index + 1, end);
    const regionBlocks = parseCandidateRoleContributionBlocks(
      regionLines,
      anchorPosition * 10_000,
    ).filter((block) => block.text.trim() !== "");
    if (regionBlocks.length > 0) {
      selectedRegion = regionBlocks;
      break;
    }
    const boundaryLine = lines[end];
    if (boundaryLine === undefined || !isContributionAnchor(boundaryLine.text)) break;
  }
  if (selectedRegion.length === 0) return { foundRegion: false, blocks: [] };

  const ranked = selectedRegion
    .map((block) => ({ block, score: lexicalOverlap(jobQuery, block.text) }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) => right.score - left.score || left.block.sourceOrder - right.block.sourceOrder,
    );
  const selected: CandidateRoleContributionBlock[] = [];
  let usedCharacters = 0;
  const headingText = roleLine.text;
  for (const { block } of ranked) {
    const nextCharacters = usedCharacters + 2 + block.text.length;
    if (headingText.length + nextCharacters > maximumRecordCharacters) continue;
    selected.push(block);
    usedCharacters = nextCharacters;
  }
  return {
    foundRegion: true,
    blocks: selected.sort((left, right) => left.sourceOrder - right.sourceOrder),
  };
}
