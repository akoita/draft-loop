import { describe, expect, it } from "vitest";
import type { ApplicationSummaryView } from "./application-contract.js";
import {
  applicationQueryNarrows,
  applicationStatusCounts,
  applicationStatusFilterLabel,
  defaultApplicationListQuery,
  isApplicationSortOrder,
  isApplicationStatusFilter,
  matchesApplicationSearch,
  queryApplications,
  showApplicationToolbar,
  sortApplications,
} from "./home-list-model.js";

function application(overrides: Partial<ApplicationSummaryView> = {}): ApplicationSummaryView {
  return {
    id: "app-1",
    name: "Northwind Bank · Platform Engineer",
    jobSourceKind: "pasted-text",
    status: "drafting",
    isDefault: false,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-08T10:00:00.000Z",
    runCount: 0,
    briefCount: 0,
    exportCount: 0,
    latestRunId: null,
    archivedAt: null,
    modelProfiles: null,
    nameChosen: true,
    suggestedName: null,
    ...overrides,
  };
}

const northwind = application({
  id: "northwind",
  name: "Northwind Bank · Platform Engineer",
  status: "in-review",
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-09T10:00:00.000Z",
});
const orbis = application({
  id: "orbis",
  name: "orbis Pay · Staff Engineer",
  status: "exported",
  createdAt: "2026-10-05T10:00:00.000Z",
  updatedAt: "2026-10-07T10:00:00.000Z",
});
const kestrel = application({
  id: "kestrel",
  name: "Kestrel Labs · Backend Lead",
  status: "drafting",
  createdAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
});
const societe = application({
  id: "societe",
  name: "Société Verdant · Architecte",
  status: "in-review",
  createdAt: "2026-10-03T10:00:00.000Z",
  updatedAt: "2026-10-06T10:00:00.000Z",
});
const all = [orbis, kestrel, northwind, societe];
const ids = (list: readonly ApplicationSummaryView[]) => list.map((item) => item.id);

describe("application search", () => {
  it("matches every word in any order, ignoring case and accents", () => {
    expect(matchesApplicationSearch(northwind, "engineer NORTHWIND")).toBe(true);
    expect(matchesApplicationSearch(societe, "societe")).toBe(true);
    expect(matchesApplicationSearch(northwind, "northwind lead")).toBe(false);
  });

  it("keeps everything for an empty or blank search", () => {
    expect(matchesApplicationSearch(northwind, "")).toBe(true);
    expect(matchesApplicationSearch(northwind, "   ")).toBe(true);
  });
});

describe("application sort", () => {
  it("orders by last activity by default", () => {
    expect(ids(sortApplications(all, "activity"))).toEqual([
      "northwind",
      "kestrel",
      "orbis",
      "societe",
    ]);
  });

  it("orders names A to Z without regard to case", () => {
    expect(ids(sortApplications(all, "name"))).toEqual([
      "kestrel",
      "northwind",
      "orbis",
      "societe",
    ]);
  });

  it("orders newest created first, ties by last activity", () => {
    expect(ids(sortApplications(all, "created"))).toEqual([
      "orbis",
      "kestrel",
      "societe",
      "northwind",
    ]);
  });

  it("orders by workflow status, ties by last activity", () => {
    expect(ids(sortApplications(all, "status"))).toEqual([
      "kestrel",
      "northwind",
      "societe",
      "orbis",
    ]);
  });

  it("leaves the input list as it was", () => {
    const input = [...all];
    sortApplications(input, "name");
    expect(input).toEqual(all);
  });
});

describe("application query", () => {
  it("filters by status and search, then sorts", () => {
    expect(ids(queryApplications(all, { search: "", status: "in-review", sort: "name" }))).toEqual([
      "northwind",
      "societe",
    ]);
    expect(
      ids(queryApplications(all, { ...defaultApplicationListQuery, search: "engineer" })),
    ).toEqual(["northwind", "orbis"]);
  });

  it("counts each status chip under the current search", () => {
    expect(applicationStatusCounts(all, "")).toEqual({
      all: 4,
      drafting: 1,
      "in-review": 2,
      approved: 0,
      exported: 1,
    });
    expect(applicationStatusCounts(all, "engineer")).toEqual({
      all: 2,
      drafting: 0,
      "in-review": 1,
      approved: 0,
      exported: 1,
    });
  });

  it("says when a query narrows the list", () => {
    expect(applicationQueryNarrows(defaultApplicationListQuery)).toBe(false);
    expect(applicationQueryNarrows({ ...defaultApplicationListQuery, search: "  " })).toBe(false);
    expect(applicationQueryNarrows({ ...defaultApplicationListQuery, search: "bank" })).toBe(true);
    expect(applicationQueryNarrows({ ...defaultApplicationListQuery, status: "approved" })).toBe(
      true,
    );
  });
});

describe("application toolbar", () => {
  it("appears only above six applications", () => {
    expect(showApplicationToolbar(6)).toBe(false);
    expect(showApplicationToolbar(7)).toBe(true);
  });

  it("recognises stored sort and filter values", () => {
    expect(isApplicationSortOrder("name")).toBe(true);
    expect(isApplicationSortOrder("size")).toBe(false);
    expect(isApplicationStatusFilter("exported")).toBe(true);
    expect(isApplicationStatusFilter(3)).toBe(false);
    expect(applicationStatusFilterLabel("all")).toBe("All");
    expect(applicationStatusFilterLabel("in-review")).toBe("In review");
  });
});
