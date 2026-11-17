import type { DraftArtifact } from "@draft-loop/schemas";

/**
 * Three writing defects a reader notices at once and the critic let through on Economy drafts
 * (#2908). Each is a quality warning under a code the author's revision already handles.
 */
export interface CvWritingIssue {
  readonly code: "editorial-negative-aside" | "editorial-fragment" | "duplicate-content";
  readonly message: string;
  readonly sectionId: string;
  readonly blockId: string;
  readonly location?: {
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
  };
}

const roleSeparator = " | ";
const maxQuote = 60;

/** A status that undercuts the work, in English or French. */
const statusCaveat =
  /(?<![\p{L}\p{N}])(?:staging|pre-?production|prototype|proof of concept|not (?:yet )?(?:in |on )?production|never (?:shipped|launched|released)|unreleased|internal (?:only|use only)|préproduction|pré-production|pas (?:encore )?en production|jamais (?:livré|lancé|mis en production))(?![\p{L}\p{N}])/iu;

function locationOf(text: string, start: number, end: number) {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  return {
    start,
    end,
    line: text.slice(0, start).split("\n").length,
    column: start - lineStart + 1,
  };
}

function quote(text: string, start: number): string {
  return text.slice(start, start + maxQuote).trimEnd();
}

/** The paragraph directly under a role header ("Title | Employer | dates") is its context line. */
function contextLineIndexes(blocks: DraftArtifact["sections"][number]["blocks"]): number[] {
  const indexes: number[] = [];
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];
    if (
      index > 0 &&
      block.type !== "bullet" &&
      !block.text.includes(roleSeparator) &&
      previous !== undefined &&
      previous.type !== "bullet" &&
      previous.text.includes(roleSeparator)
    ) {
      indexes.push(index);
    }
  });
  return indexes;
}

/** "Built X; led Y; owned Z": three or more phrases joined by semicolons, not a sentence. */
function isPhraseList(text: string): boolean {
  const parts = text
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length >= 3 && parts.every((part) => part.split(/\s+/u).length <= 8);
}

const stopWords = new Set(
  "a an and as at by for from in into of on or the to with my our de des du et en la le les pour un une".split(
    " ",
  ),
);

function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? []).filter(
    (word) => word.length > 2 && !stopWords.has(word),
  );
}

/** Share of a line's content words found, in order-free bigrams, in another line. */
function containedShare(line: string, other: string): number {
  const bigrams = (words: string[]) =>
    words.slice(1).map((word, index) => `${words[index]} ${word}`);
  const lineBigrams = bigrams(contentWords(line));
  if (lineBigrams.length < 4) return 0;
  const otherBigrams = new Set(bigrams(contentWords(other)));
  return lineBigrams.filter((bigram) => otherBigrams.has(bigram)).length / lineBigrams.length;
}

/** From this share of shared word pairs, a Core areas line repeats an Experience bullet. */
export const coreAreaRepeatShare = 0.7;

export function findCvWritingIssues(artifact: Pick<DraftArtifact, "sections">): CvWritingIssue[] {
  const issues: CvWritingIssue[] = [];
  const experienceBlocks = artifact.sections
    .filter(({ kind }) => kind === "experience" || kind === "projects")
    .flatMap(({ blocks }) => blocks.filter(({ type }) => type === "bullet"));
  for (const section of artifact.sections) {
    if (section.kind === "experience" || section.kind === "projects") {
      for (const index of contextLineIndexes(section.blocks)) {
        const block = section.blocks[index];
        const match = block === undefined ? null : statusCaveat.exec(block.text);
        if (block === undefined || match === null) continue;
        issues.push({
          code: "editorial-negative-aside",
          message: `a role's context line adds a status caveat the job did not ask about: "${quote(block.text, match.index)}"`,
          sectionId: section.id,
          blockId: block.id,
          location: locationOf(block.text, match.index, match.index + match[0].length),
        });
      }
    }
    if (section.kind === "summary") {
      for (const block of section.blocks) {
        if (block.type === "bullet" || !isPhraseList(block.text)) continue;
        issues.push({
          code: "editorial-fragment",
          message: `the summary is a list of phrases joined by semicolons, not sentences: "${quote(block.text, 0)}"`,
          sectionId: section.id,
          blockId: block.id,
        });
      }
    }
    if (section.kind === "alignment") {
      for (const block of section.blocks) {
        const repeated = experienceBlocks.find(
          (other) => containedShare(block.text, other.text) >= coreAreaRepeatShare,
        );
        if (repeated === undefined) continue;
        issues.push({
          code: "duplicate-content",
          message: `a Core areas line repeats an Experience bullet almost word for word: "${quote(block.text, 0)}"`,
          sectionId: section.id,
          blockId: block.id,
        });
      }
    }
  }
  return issues;
}
