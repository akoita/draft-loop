import type { AuthorArtifactProposal } from "@draft-loop/schemas";

import { dateRangeTexts, hasUnsupportedDateRange } from "./uncovered-text-grounding.js";

type ProposalSection = AuthorArtifactProposal["sections"][number];
type ProposalBlock = ProposalSection["blocks"][number];

function stripMarkdownIdentityFormatting(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s*/u, "")
    .replace(
      /\*\*(.*?)\*\*|__(.*?)__|\*(.*?)\*|_(.*?)_/gu,
      (_match, bold, boldUnderscore, italic, italicUnderscore) =>
        bold ?? boldUnderscore ?? italic ?? italicUnderscore ?? "",
    );
}

function normalizeIdentity(value: string): string {
  return stripMarkdownIdentityFormatting(value)
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
}

function containsWholeEmployerIdentity(line: string, employer: string): boolean {
  const escapedEmployer = employer.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/\s+/gu, "\\s+");
  const employerPattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapedEmployer}(?![\\p{L}\\p{N}])`,
    "u",
  );
  return employerPattern.test(normalizeIdentity(line));
}

/**
 * Return true when a structured experience header states a date range that no
 * single cited source line associates with the employer in the first field.
 * This checks literal identity and date co-occurrence only; it does not infer
 * aliases or employer ownership from broader career context.
 */
export function hasUnsupportedEmployerHeaderRange(
  section: Pick<ProposalSection, "kind">,
  block: Pick<ProposalBlock, "type" | "text">,
  citedEvidenceChunks: readonly string[],
): boolean {
  if (section.kind !== "experience" || block.type !== "paragraph") return false;

  const fields = block.text.split("|");
  if (fields.length < 2) return false;

  const employer = normalizeIdentity(fields[0] ?? "");
  const statedRanges = dateRangeTexts(fields.slice(1).join("|"));
  if (employer.length === 0 || statedRanges.length === 0) return false;

  const sourceLines = citedEvidenceChunks.flatMap((chunk) => chunk.split(/\r\n|\n|\r/u));
  return statedRanges.some(
    (range) =>
      !sourceLines.some(
        (line) =>
          containsWholeEmployerIdentity(line, employer) && !hasUnsupportedDateRange(range, [line]),
      ),
  );
}
