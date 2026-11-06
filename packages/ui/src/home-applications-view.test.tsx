import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApplicationSummaryView } from "./application-contract.js";
import { HomeView, type HomeViewProps } from "./home.js";
import { isApplicationListView } from "./home-applications-view.js";
import { defaultApplicationListQuery } from "./home-list-model.js";

const now = new Date("2026-11-06T12:00:00.000Z");

function application(index: number, overrides: Partial<ApplicationSummaryView> = {}) {
  const day = String(10 + index).padStart(2, "0");
  return {
    id: `app-${index}`,
    name: `Employer ${index} · Engineer`,
    jobSourceKind: "pasted-text",
    status: "drafting",
    isDefault: false,
    createdAt: `2026-10-${day}T09:00:00.000Z`,
    updatedAt: `2026-10-${day}T09:00:00.000Z`,
    runCount: index,
    briefCount: 1,
    exportCount: 0,
    latestRunId: null,
    archivedAt: null,
    modelProfiles: null,
    nameChosen: true,
    suggestedName: null,
    ...overrides,
  } satisfies ApplicationSummaryView;
}

const seven = [
  application(1, { name: "Northwind Bank · Platform Engineer", status: "in-review" }),
  application(2, { name: "Orbis Pay · Staff Engineer", status: "exported" }),
  application(3, { name: "Kestrel Labs · Backend Lead" }),
  application(4),
  application(5),
  application(6, { status: "approved" }),
  application(7, { archivedAt: "2026-10-20T09:00:00.000Z" }),
];

function render(
  applications: readonly ApplicationSummaryView[],
  overrides: Partial<HomeViewProps> = {},
): string {
  return renderToStaticMarkup(
    <HomeView
      workspaceTitle={<h1>Job search 2026</h1>}
      workspaceNavigation={<button type="button">Close workspace</button>}
      profile={{ kind: "reviewed", version: 2 }}
      evidence={{ kind: "none" }}
      legacyEvidenceSourceCount={0}
      applications={{ status: "ready", applications }}
      now={now}
      onArchiveApplication={() => undefined}
      onDeleteApplication={() => undefined}
      onOpenApplication={() => undefined}
      onManageProfile={() => undefined}
      onManageEvidence={() => undefined}
      {...overrides}
    />,
  );
}

function namesInOrder(html: string): string[] {
  return [...html.matchAll(/aria-label="Open ([^"]+)"/gu)].map((match) => match[1] ?? "");
}

describe("applications toolbar", () => {
  it("stays hidden up to six applications", () => {
    const html = render(seven.slice(0, 6));
    expect(html).not.toContain("Search applications");
    expect(html).toContain('class="application-list"');
  });

  it("shows search, sort, view and status chips with counts above six", () => {
    const html = render(seven);
    expect(html).toContain('aria-label="Search applications"');
    expect(html).toContain("Name (A to Z)");
    expect(html).toContain('aria-pressed="true">Cards</button>');
    // Counts cover the active applications; the archived one is not in them.
    expect(html).toContain('All<span class="numeric">6</span>');
    expect(html).toContain('Drafting<span class="numeric">3</span>');
    expect(html).toContain('In review<span class="numeric">1</span>');
  });

  it("applies the search, status filter and sort it starts with", () => {
    const html = render(seven, {
      initialApplicationQuery: { search: "engineer", status: "all", sort: "name" },
    });
    expect(namesInOrder(html)).toEqual([
      "Employer 4 · Engineer",
      "Employer 5 · Engineer",
      "Employer 6 · Engineer",
      "Northwind Bank · Platform Engineer",
      "Orbis Pay · Staff Engineer",
    ]);
    expect(html).not.toContain("Kestrel Labs");
    expect(
      namesInOrder(
        render(seven, {
          initialApplicationQuery: { ...defaultApplicationListQuery, status: "approved" },
        }),
      ),
    ).toEqual(["Employer 6 · Engineer"]);
  });

  it("says when nothing matches and offers to clear", () => {
    const html = render(seven, {
      initialApplicationQuery: { ...defaultApplicationListQuery, search: "zzz" },
    });
    expect(html).toContain("No application matches this search or filter.");
    expect(html).toContain("Clear search and filter");
  });
});

describe("applications List view", () => {
  it("draws one row per application with its status, activity, runs and actions", () => {
    const html = render(seven, { initialApplicationView: "list", initialShowArchived: true });
    expect(html).toContain('<table class="applications-table" aria-label="Applications">');
    expect(html).toContain('<table class="applications-table" aria-label="Archived applications">');
    expect(html.match(/<tr class="applications-row"/gu)?.length).toBe(6);
    expect(html).toContain("In review");
    expect(html).toContain("days ago");
    expect(html).toContain('aria-label="More actions for Orbis Pay · Staff Engineer"');
    expect(html).toContain('aria-label="Archive Orbis Pay · Staff Engineer"');
    expect(html).toContain('aria-label="Restore Employer 7 · Engineer"');
    expect(html).not.toContain('class="application-list"');
  });

  it("gives every table the same fixed columns, so folder sections line up", () => {
    const html = render(seven, { initialApplicationView: "list", initialShowArchived: true });
    const colgroup =
      '<colgroup><col class="applications-col-name"/><col class="applications-col-status"/>' +
      '<col class="applications-col-activity"/><col class="applications-col-runs"/>' +
      '<col class="applications-col-actions"/></colgroup>';
    expect(html.split(colgroup).length - 1).toBe(2);
  });

  it("falls back to Cards when the list is short", () => {
    const html = render(seven.slice(0, 3), { initialApplicationView: "list" });
    expect(html).not.toContain("applications-table");
    expect(html).toContain('class="application-list"');
  });

  it("recognises a stored view", () => {
    expect(isApplicationListView("list")).toBe(true);
    expect(isApplicationListView("tiles")).toBe(false);
  });
});
