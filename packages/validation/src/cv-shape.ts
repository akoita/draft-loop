/**
 * Two shape checks on a finished CV that the 0.6.2 walk's export failed (#1862): it opened at
 * "Summary" with no name or contact header, and its Skills section mixed a bare list with
 * `Label: items` lines. Both are warnings: the draft can still be approved, but the reader is told
 * before it is sent.
 */

import type { DraftArtifact } from "@draft-loop/schemas";

export const MISSING_CV_HEADER_CODE = "missing-cv-header";
export const UNLABELLED_SKILLS_LINE_CODE = "unlabelled-skills-line";

/** Sections only a letter or an application answer has; such a draft is not a CV. */
const letterSectionKinds = new Set(["salutation", "hook", "closing", "question", "answer"]);

/** "Backend: Python, PostgreSQL": a short label without commas, a colon, then the items. */
const labelledLine = /^[^:,\n]{1,40}:\s*\S/u;

export interface CvShapeIssue {
  readonly code: typeof MISSING_CV_HEADER_CODE | typeof UNLABELLED_SKILLS_LINE_CODE;
  readonly message: string;
  readonly sectionId?: string;
  readonly blockId?: string;
}

/**
 * The CV's missing header and its unlabelled Skills lines; none for a letter or an answer, and no
 * header check for a partial draft without an experience section.
 */
export function findCvShapeIssues(
  artifact: Pick<DraftArtifact, "sections">,
): readonly CvShapeIssue[] {
  if (artifact.sections.some(({ kind }) => letterSectionKinds.has(kind))) return [];
  const issues: CvShapeIssue[] = [];
  // A complete CV has an experience section; a partial draft such as a summary alone is not judged.
  const complete = artifact.sections.some(({ kind }) => kind === "experience");
  const header = artifact.sections.find(({ kind }) => kind === "header");
  if (complete && (header === undefined || header.blocks.length === 0)) {
    issues.push({
      code: MISSING_CV_HEADER_CODE,
      message:
        "the CV has no name or contact header; the evidence may not state them, so add the candidate's name and contact line before sending it",
    });
  }
  for (const section of artifact.sections) {
    if (section.kind !== "skills") continue;
    const lines = section.blocks.filter(({ text }) => text.trim() !== "");
    const labelled = lines.filter(({ text }) => labelledLine.test(text.trim()));
    if (labelled.length === 0 || labelled.length === lines.length) continue;
    for (const block of lines) {
      if (labelledLine.test(block.text.trim())) continue;
      issues.push({
        code: UNLABELLED_SKILLS_LINE_CODE,
        message:
          "a Skills line has no label while the others do; write it as `Label: items` or merge it into a labelled line",
        sectionId: section.id,
        blockId: block.id,
      });
    }
  }
  return issues;
}
