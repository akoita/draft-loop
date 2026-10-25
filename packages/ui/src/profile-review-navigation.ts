import type {
  CanonicalCandidateProfileFactCategory,
  CanonicalCandidateProfileIssueStatus,
} from "@draft-loop/domain";
import type {
  CanonicalCandidateProfileFactResult,
  CanonicalCandidateProfileIssueResult,
  CanonicalCandidateProfileRecordResult,
} from "./bridge.js";
import { canReviewCanonicalCandidateProfile } from "./profile-outcome.js";
import { humanizeProfileFieldLabel } from "./profile-presentation.js";

/** Pure helpers that keep a large canonical profile quick to review: folding, filtering, hints. */

/** Profiles with more facts than this start with every category collapsed. */
export const profileFactCollapseThreshold = 40;

export type ProfileFactGroups = readonly (readonly [
  CanonicalCandidateProfileFactCategory,
  readonly CanonicalCandidateProfileFactResult[],
])[];

export interface ProfileFactCategoryView {
  readonly category: CanonicalCandidateProfileFactCategory;
  /** Only the facts that match the current filter. */
  readonly facts: readonly CanonicalCandidateProfileFactResult[];
  readonly totalCount: number;
  readonly open: boolean;
}

export interface ProfileFactProjection {
  readonly categories: readonly ProfileFactCategoryView[];
  readonly matchCount: number;
  readonly totalCount: number;
  readonly filtering: boolean;
}

export function profileFactCategoriesStartOpen(factCount: number): boolean {
  return factCount <= profileFactCollapseThreshold;
}

export function factCountLabel(count: number): string {
  return count === 1 ? "1 fact" : `${count} facts`;
}

export function issueCountLabel(count: number): string {
  return count === 1 ? "1 issue" : `${count} issues`;
}

/** Match the readable label or the value, ignoring case and surrounding whitespace in the query. */
export function profileFactMatchesFilter(
  fact: CanonicalCandidateProfileFactResult,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (needle === "") return true;
  return (
    humanizeProfileFieldLabel(fact.field).toLocaleLowerCase().includes(needle) ||
    fact.value.toLocaleLowerCase().includes(needle)
  );
}

export function projectProfileFactCategories(
  groups: ProfileFactGroups,
  query: string,
  baseOpen: boolean,
  overrides: ReadonlyMap<CanonicalCandidateProfileFactCategory, boolean>,
): ProfileFactProjection {
  const filtering = query.trim() !== "";
  const categories: ProfileFactCategoryView[] = [];
  let matchCount = 0;
  let totalCount = 0;
  for (const [category, facts] of groups) {
    totalCount += facts.length;
    const matching = filtering
      ? facts.filter((fact) => profileFactMatchesFilter(fact, query))
      : facts;
    matchCount += matching.length;
    if (filtering && matching.length === 0) continue;
    categories.push({
      category,
      facts: matching,
      totalCount: facts.length,
      open: overrides.get(category) ?? (filtering ? true : baseOpen),
    });
  }
  return { categories, matchCount, totalCount, filtering };
}

export function profileIssueGroupStartsOpen(status: CanonicalCandidateProfileIssueStatus): boolean {
  return status === "open";
}

function openIssueCount(issues: readonly CanonicalCandidateProfileIssueResult[]): number {
  return issues.filter((issue) => issue.status === "open").length;
}

/** Explain why "Mark latest draft reviewed" is disabled, or null when it is enabled or busy. */
export function profileReviewBlockedReason({
  record,
  draftFacts,
  draftIssues,
  editable,
  busy,
}: {
  readonly record: CanonicalCandidateProfileRecordResult;
  readonly draftFacts: readonly CanonicalCandidateProfileFactResult[];
  readonly draftIssues: readonly CanonicalCandidateProfileIssueResult[];
  readonly editable: boolean;
  readonly busy: boolean;
}): string | null {
  if (busy) return null;
  if (editable && canReviewCanonicalCandidateProfile(record, draftFacts, draftIssues)) return null;
  if (record.status === "reviewed") return "This version is already reviewed.";
  if (!editable) return "Only the latest draft can be marked reviewed.";
  if (record.facts.length === 0 || draftFacts.length === 0) return "There are no facts to review.";
  const draftOpen = openIssueCount(draftIssues);
  if (draftOpen > 0) {
    return draftOpen === 1
      ? "1 issue is still open. Acknowledge or resolve it, then save."
      : `${draftOpen} issues are still open. Acknowledge or resolve them, then save.`;
  }
  if (openIssueCount(record.issues) > 0) {
    return "Save your issue decisions before marking the draft reviewed.";
  }
  return null;
}
