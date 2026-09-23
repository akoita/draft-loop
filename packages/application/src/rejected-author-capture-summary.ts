import { z } from "zod";

import { proposalIssueCode, proposalIssues } from "./author-diagnostic-counts.js";
import { type BuildAuthorArtifactOptions, buildAuthorArtifact } from "./author-output.js";
import { rejectedAuthorReplayCaptureSchema } from "./rejected-author-replay.js";

const captureListSchema = z.array(rejectedAuthorReplayCaptureSchema);
const issueCodePattern = /^[A-Za-z0-9_-]{1,64}$/u;
const sectionKindPattern = /^[a-z][a-z0-9_-]{0,31}$/u;

/** Section kind used when an issue path has no `sections.N` prefix. */
export const noSectionKind = "none";

/** Section kind used when a proposal section kind is missing or unsafe to report. */
export const otherSectionKind = "other";

export class RejectedAuthorCaptureSummaryInputError extends Error {
  public constructor() {
    super("Rejected author capture summary input is invalid.");
    this.name = "RejectedAuthorCaptureSummaryInputError";
  }
}

export interface RejectedAuthorCaptureCodeCount {
  readonly code: string;
  readonly count: number;
}

export interface RejectedAuthorCaptureSectionCodeCount {
  readonly sectionKind: string;
  readonly code: string;
  readonly count: number;
}

export interface RejectedAuthorCaptureEntrySummary {
  readonly index: number;
  readonly accepted: boolean;
  /** Number of counted issues: every issue with a safe code, uncapped. */
  readonly issueTotal: number;
  readonly codeCounts: readonly RejectedAuthorCaptureCodeCount[];
  readonly sectionCodeCounts: readonly RejectedAuthorCaptureSectionCodeCount[];
}

export interface RejectedAuthorCaptureSummary {
  readonly total: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly captures: readonly RejectedAuthorCaptureEntrySummary[];
  readonly codeCounts: readonly RejectedAuthorCaptureCodeCount[];
  readonly sectionCodeCounts: readonly RejectedAuthorCaptureSectionCodeCount[];
}

interface CountedIssue {
  readonly sectionKind: string;
  readonly code: string;
}

function compareKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function increment(counts: Map<string, number>, key: string, amount = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + amount);
}

function sortedCodeCounts(
  counts: ReadonlyMap<string, number>,
): readonly RejectedAuthorCaptureCodeCount[] {
  return [...counts]
    .sort(([leftCode, leftCount], [rightCode, rightCount]) =>
      leftCount !== rightCount ? rightCount - leftCount : compareKeys(leftCode, rightCode),
    )
    .map(([code, count]) => ({ code, count }));
}

// Section kinds and codes are both restricted to characters without a NUL, so
// the pair can share one map key and be split back without ambiguity.
const pairSeparator = "\u0000";

function sortedSectionCodeCounts(
  counts: ReadonlyMap<string, number>,
): readonly RejectedAuthorCaptureSectionCodeCount[] {
  return [...counts]
    .map(([key, count]) => {
      const [sectionKind = otherSectionKind, code = ""] = key.split(pairSeparator);
      return { sectionKind, code, count };
    })
    .sort((left, right) =>
      left.count !== right.count
        ? right.count - left.count
        : compareKeys(left.sectionKind, right.sectionKind) || compareKeys(left.code, right.code),
    );
}

function sectionKinds(proposal: unknown): readonly unknown[] {
  if (typeof proposal !== "object" || proposal === null) return [];
  const sections = (proposal as { readonly sections?: unknown }).sections;
  if (!Array.isArray(sections)) return [];
  return sections.map((section: unknown) =>
    typeof section === "object" && section !== null
      ? (section as { readonly kind?: unknown }).kind
      : undefined,
  );
}

/** Map an issue path to the reportable kind of the section it points into. */
function issueSectionKind(issue: unknown, kinds: readonly unknown[]): string {
  const path =
    typeof issue === "object" && issue !== null
      ? (issue as { readonly path?: unknown }).path
      : undefined;
  if (!Array.isArray(path) || path[0] !== "sections") return noSectionKind;
  const index = path[1];
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return noSectionKind;
  const kind = kinds[index];
  return typeof kind === "string" && sectionKindPattern.test(kind) ? kind : otherSectionKind;
}

function countedIssues(error: unknown, proposal: unknown): readonly CountedIssue[] {
  const kinds = sectionKinds(proposal);
  return proposalIssues(error).flatMap((issue) => {
    const code = proposalIssueCode(issue);
    if (code === undefined || !issueCodePattern.test(code)) return [];
    return [{ sectionKind: issueSectionKind(issue, kinds), code }];
  });
}

/**
 * Summarize private rejected-author captures as content-free counts.
 *
 * Each capture is revalidated locally with `buildAuthorArtifact`. Every issue
 * of a rejection is counted by its safe code and by the kind of the section it
 * points into. Paths, text, titles, identifiers, timestamps, and provider
 * identity never reach the result, and invalid input fails with a fixed message.
 */
export function summarizeRejectedAuthorCaptures(captures: unknown): RejectedAuthorCaptureSummary {
  const parsed = captureListSchema.safeParse(captures);
  if (!parsed.success) throw new RejectedAuthorCaptureSummaryInputError();

  let accepted = 0;
  const codeCounts = new Map<string, number>();
  const sectionCodeCounts = new Map<string, number>();
  const entries = parsed.data.map((capture, index): RejectedAuthorCaptureEntrySummary => {
    const validationInputs = capture.validationInputs as BuildAuthorArtifactOptions;
    let issues: readonly CountedIssue[];
    try {
      buildAuthorArtifact(validationInputs);
      accepted += 1;
      return { index, accepted: true, issueTotal: 0, codeCounts: [], sectionCodeCounts: [] };
    } catch (error) {
      issues = countedIssues(error, validationInputs.proposal);
    }

    const captureCodes = new Map<string, number>();
    const captureSectionCodes = new Map<string, number>();
    for (const issue of issues) {
      increment(captureCodes, issue.code);
      increment(captureSectionCodes, `${issue.sectionKind}${pairSeparator}${issue.code}`);
    }
    for (const [code, count] of captureCodes) increment(codeCounts, code, count);
    for (const [key, count] of captureSectionCodes) increment(sectionCodeCounts, key, count);
    return {
      index,
      accepted: false,
      issueTotal: issues.length,
      codeCounts: sortedCodeCounts(captureCodes),
      sectionCodeCounts: sortedSectionCodeCounts(captureSectionCodes),
    };
  });

  return {
    total: entries.length,
    accepted,
    rejected: entries.length - accepted,
    captures: entries,
    codeCounts: sortedCodeCounts(codeCounts),
    sectionCodeCounts: sortedSectionCodeCounts(sectionCodeCounts),
  };
}
