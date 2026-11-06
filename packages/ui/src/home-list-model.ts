/**
 * Search, status filter and sort for the applications list on Home. Pure, so every order and
 * match is testable without a DOM; the list itself comes from the host unchanged.
 */
import { applicationStatuses } from "@draft-loop/domain/application";
import type { ApplicationStatus, ApplicationSummaryView } from "./application-contract.js";
import { applicationStatusLabel, applicationsByActivity } from "./home-model.js";

export const applicationSortOrders = ["activity", "name", "created", "status"] as const;
export type ApplicationSortOrder = (typeof applicationSortOrders)[number];

export const applicationSortLabels: Readonly<Record<ApplicationSortOrder, string>> = {
  activity: "Last activity",
  name: "Name (A to Z)",
  created: "Date created",
  status: "Status",
};

export type ApplicationStatusFilter = "all" | ApplicationStatus;

export const applicationStatusFilters: readonly ApplicationStatusFilter[] = [
  "all",
  ...applicationStatuses,
];

export function applicationStatusFilterLabel(filter: ApplicationStatusFilter): string {
  return filter === "all" ? "All" : applicationStatusLabel(filter);
}

export interface ApplicationListQuery {
  readonly search: string;
  readonly status: ApplicationStatusFilter;
  readonly sort: ApplicationSortOrder;
}

export const defaultApplicationListQuery: ApplicationListQuery = {
  search: "",
  status: "all",
  sort: "activity",
};

/** Home shows the toolbar only once the list is long enough to need it. */
export const applicationToolbarThreshold = 6;

export function showApplicationToolbar(applicationCount: number): boolean {
  return applicationCount > applicationToolbarThreshold;
}

export function isApplicationSortOrder(value: unknown): value is ApplicationSortOrder {
  return typeof value === "string" && (applicationSortOrders as readonly string[]).includes(value);
}

export function isApplicationStatusFilter(value: unknown): value is ApplicationStatusFilter {
  return (
    typeof value === "string" && (applicationStatusFilters as readonly string[]).includes(value)
  );
}

/** Lower case without accents, so "societe" finds "Société". */
function folded(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

/** Every word of the search appears somewhere in the name, in any order. */
export function matchesApplicationSearch(
  application: Pick<ApplicationSummaryView, "name">,
  search: string,
): boolean {
  const words = folded(search)
    .split(/\s+/u)
    .filter((word) => word !== "");
  if (words.length === 0) return true;
  const name = folded(application.name);
  return words.every((word) => name.includes(word));
}

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Sorts a copy of the list. Ties keep the most recent activity first, so every order is stable
 * and matches what the person saw before choosing it.
 */
export function sortApplications(
  applications: readonly ApplicationSummaryView[],
  sort: ApplicationSortOrder,
): readonly ApplicationSummaryView[] {
  const byActivity = applicationsByActivity(applications);
  if (sort === "activity") return byActivity;
  const rank = new Map(byActivity.map((application, index) => [application.id, index]));
  const tie = (left: ApplicationSummaryView, right: ApplicationSummaryView) =>
    (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0);
  const compare = (left: ApplicationSummaryView, right: ApplicationSummaryView): number => {
    switch (sort) {
      case "name":
        return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      case "created":
        return time(right.createdAt) - time(left.createdAt);
      case "status":
        return applicationStatuses.indexOf(left.status) - applicationStatuses.indexOf(right.status);
    }
  };
  return [...byActivity].sort((left, right) => compare(left, right) || tie(left, right));
}

/** The applications the query keeps, in its order. */
export function queryApplications(
  applications: readonly ApplicationSummaryView[],
  query: ApplicationListQuery,
): readonly ApplicationSummaryView[] {
  return sortApplications(
    applications.filter(
      (application) =>
        (query.status === "all" || application.status === query.status) &&
        matchesApplicationSearch(application, query.search),
    ),
    query.sort,
  );
}

/** How many applications each status chip would show under the current search. */
export function applicationStatusCounts(
  applications: readonly ApplicationSummaryView[],
  search: string,
): Readonly<Record<ApplicationStatusFilter, number>> {
  const counts: Record<ApplicationStatusFilter, number> = {
    all: 0,
    drafting: 0,
    "in-review": 0,
    approved: 0,
    exported: 0,
  };
  for (const application of applications) {
    if (!matchesApplicationSearch(application, search)) continue;
    counts.all += 1;
    counts[application.status] += 1;
  }
  return counts;
}

/** True when a search or a status chip narrows the list. */
export function applicationQueryNarrows(query: ApplicationListQuery): boolean {
  return query.search.trim() !== "" || query.status !== "all";
}
