/**
 * The run comparison as a Markdown file the reviewer saves locally.
 *
 * The file holds the comparison table, the input differences and both drafts' text. It names
 * the runs by number and the models by their ids, and carries no other identifier, no critic
 * rationale and no finding text, so nothing beyond what the comparison shows leaves the review.
 */
import { maximumMarkdownFileSaveBytes } from "./bridge.js";
import type { ReviewArtifact } from "./model.js";
import type { RunComparisonFacts } from "./run-comparison-facts.js";

/** The most the host writes for one comparison, in UTF-8 bytes. */
export const maximumComparisonMarkdownBytes = maximumMarkdownFileSaveBytes;

/** Whether the file is small enough for the host to save. */
export function comparisonMarkdownFits(markdown: string): boolean {
  return new TextEncoder().encode(markdown).length <= maximumComparisonMarkdownBytes;
}

/** One cell's text, kept on one table row. */
function cell(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replace(/\s*\n\s*/gu, " ");
}

function row(cells: readonly string[]): string {
  return `| ${cells.map(cell).join(" | ")} |`;
}

function draftMarkdown(label: string, artifact: ReviewArtifact | null): string[] {
  const lines = [`## ${label} draft`, ""];
  if (artifact === null) {
    lines.push("The draft could not be read.", "");
    return lines;
  }
  lines.push(`Draft version ${artifact.version}.`, "");
  for (const section of artifact.sections) {
    lines.push(`### ${section.title}`, "");
    for (const block of section.blocks) {
      lines.push(block.type === "bullet" ? `- ${block.text}` : block.text, "");
    }
  }
  return lines;
}

/** The Markdown file for a comparison: the table, the input differences, then both drafts. */
export function runComparisonMarkdown(input: {
  readonly facts: RunComparisonFacts;
  readonly left: ReviewArtifact | null;
  readonly right: ReviewArtifact | null;
}): string {
  const { facts } = input;
  const lines = [
    `# Run comparison: ${facts.leftLabel} and ${facts.rightLabel}`,
    "",
    "Each value is what that run recorded.",
    "",
    row(["", facts.leftLabel, facts.rightLabel]),
    row(["---", "---", "---"]),
    ...facts.facts.map((fact) =>
      row([
        fact.note === undefined ? fact.label : `${fact.label} (${fact.note})`,
        fact.left,
        fact.right,
      ]),
    ),
    "",
    "## Input differences",
    "",
    ...facts.inputs.map((input) => `- ${input.message}.`),
    "",
    ...draftMarkdown(facts.leftLabel, input.left),
    ...draftMarkdown(facts.rightLabel, input.right),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

/** A file name for the comparison, e.g. "run-2-vs-run-3-comparison.md". */
export function runComparisonFileName(leftLabel: string, rightLabel: string): string {
  const slug = (label: string): string =>
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "") || "run";
  return `${slug(leftLabel)}-vs-${slug(rightLabel)}-comparison.md`;
}
