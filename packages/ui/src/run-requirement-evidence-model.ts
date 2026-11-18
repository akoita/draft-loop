/**
 * What "Evidence for each requirement" shows (#3011): for each job requirement, the sources that
 * may support it, best first. A candidate the run's grader found unsupportive is left out of the
 * simple list, since the writer and critic set it aside too; Advanced options still lists it.
 */
import type {
  RequirementEvidenceCandidateView,
  RunRequirementEvidenceView,
} from "./run-requirement-evidence-contract.js";

export interface RequirementEvidenceSourceLine {
  /** The source's name, or null when the run recorded none. */
  readonly source: string | null;
  /** "3-7", "3", or null when the run recorded no lines. */
  readonly lines: string | null;
}

export interface RequirementEvidenceRow {
  readonly requirementId: string;
  /** The requirement's text, or null when the run recorded none. */
  readonly text: string | null;
  /** Distinct sources for the simple view, best first. */
  readonly sources: readonly RequirementEvidenceSourceLine[];
  /** Every candidate, best first, for Advanced options. */
  readonly candidates: readonly RequirementEvidenceCandidateView[];
}

export interface RequirementEvidenceDisplay {
  readonly rows: readonly RequirementEvidenceRow[];
  /** Requirements with at least one source in the simple view. */
  readonly supportedCount: number;
  readonly semantic: boolean;
  readonly graded: boolean;
}

export function candidateLines(candidate: RequirementEvidenceCandidateView): string | null {
  const { lineStart, lineEnd } = candidate;
  if (lineStart === undefined) return null;
  return lineEnd === undefined || lineEnd === lineStart
    ? String(lineStart)
    : `${lineStart}-${lineEnd}`;
}

function sourceLines(
  candidates: readonly RequirementEvidenceCandidateView[],
): RequirementEvidenceSourceLine[] {
  const seen = new Set<string>();
  const lines: RequirementEvidenceSourceLine[] = [];
  for (const candidate of candidates) {
    if (candidate.grade === "does-not-support") continue;
    const entry = { source: candidate.source ?? null, lines: candidateLines(candidate) };
    const key = `${entry.source ?? ""}\u0000${entry.lines ?? candidate.chunkId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(entry);
  }
  return lines;
}

export function requirementEvidenceDisplay(
  view: RunRequirementEvidenceView,
): RequirementEvidenceDisplay {
  const rows = view.requirements.map((requirement) => ({
    requirementId: requirement.requirementId,
    text: requirement.text ?? null,
    sources: sourceLines(requirement.candidates),
    candidates: requirement.candidates,
  }));
  return {
    rows,
    supportedCount: rows.filter((row) => row.sources.length > 0).length,
    semantic: view.mode === "semantic",
    graded: view.grading === "graded",
  };
}
