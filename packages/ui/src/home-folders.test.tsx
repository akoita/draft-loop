import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApplicationSummaryView } from "./application-contract.js";
import { normalizeApplicationSummary } from "./application-contract.js";
import type { ApplicationFolderView } from "./application-folder-contract.js";
import {
  normalizeApplicationFolderListResult,
  validateApplicationMoveInput,
} from "./application-folder-contract.js";
import { HomeView, type HomeViewProps } from "./home.js";
import {
  defaultFolderPreferences,
  folderDeleteConfirmation,
  folderPreferencesKey,
  folderSections,
  moveTargets,
  readFolderPreferences,
  writeFolderPreferences,
} from "./home-folder-model.js";
import type { HomeFolderActions } from "./home-folders.js";

const now = new Date("2026-11-06T12:00:00.000Z");
const fintech = "fld_fintech0001";
const banks = "fld_banks000001";

function folder(id: string, name: string, applicationCount: number): ApplicationFolderView {
  return {
    id,
    name,
    createdAt: "2026-11-01T09:00:00.000Z",
    updatedAt: "2026-11-01T09:00:00.000Z",
    applicationCount,
  };
}

const folders = [folder(fintech, "Fintech", 2), folder(banks, "Banks", 0)];

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

const applications = [
  application(1, { name: "Northwind Bank · Platform Engineer", folderId: fintech }),
  application(2, { name: "Orbis Pay · Staff Engineer", folderId: fintech }),
  application(3, { name: "Kestrel Labs · Backend Lead" }),
  application(4, { archivedAt: "2026-10-20T09:00:00.000Z", folderId: fintech }),
];

const actions: HomeFolderActions = {
  folders,
  onCreate: async () => undefined,
  onRename: async () => undefined,
  onDelete: async () => undefined,
  onMove: () => undefined,
};

function render(overrides: Partial<HomeViewProps> = {}, withFolders = true): string {
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
      onOpenApplication={() => undefined}
      onManageProfile={() => undefined}
      onManageEvidence={() => undefined}
      {...(withFolders ? { folders: actions } : {})}
      initialFolderPreferences={defaultFolderPreferences}
      {...overrides}
    />,
  );
}

function sectionNames(html: string): string[] {
  return [
    ...html.matchAll(
      /aria-expanded="(?:true|false)" aria-controls="application-folder-body-[^"]+"><span aria-hidden="true">.<\/span> ([^<]+)<span class="numeric">(\d+)<\/span>/gu,
    ),
  ].map((match) => `${match[1]} ${match[2]}`);
}

describe("folders on Home", () => {
  it("shows a section per folder in creation order, then No folder, with archived apart", () => {
    const html = render({ initialShowArchived: true });
    expect(sectionNames(html)).toEqual(["Fintech 2", "Banks 0", "No folder 1"]);
    expect(html).toContain('aria-label="Fintech"');
    expect(html).toContain("Empty. Use Move to");
    expect(html).toContain('aria-label="Archived applications"');
    expect(html).toContain(">New folder</button>");
    expect(html).toContain('aria-pressed="true">By folder</button>');
    expect(html).toContain('aria-label="Rename folder Fintech"');
    expect(html).toContain('aria-label="Delete folder Banks"');
  });

  it("offers Move to every other folder and out of the current one", () => {
    const html = render();
    expect(html).toContain('aria-label="More actions for Northwind Bank · Platform Engineer"');
    expect(html).toContain('aria-label="Move to Banks: Northwind Bank · Platform Engineer"');
    expect(html).toContain('aria-label="Remove from folder: Northwind Bank · Platform Engineer"');
    expect(html).not.toContain('aria-label="Move to Fintech: Northwind Bank · Platform Engineer"');
    expect(html).toContain('aria-label="Move to Fintech: Kestrel Labs · Backend Lead"');
    expect(html).not.toContain('aria-label="Remove from folder: Kestrel Labs · Backend Lead"');
    // The List view carries the same entries in its row menu.
    const seven = [...applications, ...[5, 6, 7, 8].map((index) => application(index))];
    const list = render({
      applications: { status: "ready", applications: seven },
      initialApplicationView: "list",
    });
    expect(list).toContain('<table class="applications-table" aria-label="Fintech">');
    expect(list).toContain('aria-label="Move to Banks: Orbis Pay · Staff Engineer"');
  });

  it("folds a section it remembers as folded, and lists all together on request", () => {
    const folded = render({ initialFolderPreferences: { grouping: "folders", folded: [fintech] } });
    expect(folded).toContain(
      'aria-expanded="false" aria-controls="application-folder-body-fld_fintech0001"',
    );
    expect(folded).not.toContain("Northwind Bank");
    const together = render({ initialFolderPreferences: { grouping: "together", folded: [] } });
    expect(sectionNames(together)).toEqual([]);
    expect(together).toContain('aria-label="Applications"');
    expect(together).toContain('aria-pressed="true">All together</button>');
  });

  it("shows no folder control on a host without folders", () => {
    const html = render({}, false);
    expect(html).not.toContain("New folder");
    expect(html).not.toContain("Move to");
    expect(html).not.toContain("application-folder-head");
    expect(html).toContain('aria-label="Applications"');
  });
});

describe("folder sections model", () => {
  it("reads an unknown folder as no folder and drops empty sections while narrowed", () => {
    const stray = application(9, { folderId: "fld_deleted0001" });
    const sections = folderSections(
      [applications[0] as ApplicationSummaryView, stray],
      folders,
      true,
    );
    expect(sections.map((section) => [section.key, section.applications.length])).toEqual([
      [fintech, 1],
      ["none", 1],
    ]);
    expect(moveTargets(stray, folders).map((target) => target.label)).toEqual([
      "Move to Fintech",
      "Move to Banks",
    ]);
  });

  it("says how many applications a deleted folder moves, and that none is deleted", () => {
    expect(folderDeleteConfirmation(folders[0] as ApplicationFolderView)).toBe(
      "Delete the folder “Fintech”? Its 2 applications move to No folder. No application is deleted.",
    );
    expect(folderDeleteConfirmation(folders[1] as ApplicationFolderView)).toContain("It is empty.");
  });

  it("remembers grouping and folded sections, reading defaults from a bad store", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value);
      },
    };
    writeFolderPreferences(storage, { grouping: "together", folded: [banks] });
    expect(readFolderPreferences(storage)).toEqual({ grouping: "together", folded: [banks] });
    items.set(folderPreferencesKey, '{"grouping":"tiles","folded":"x"}');
    expect(readFolderPreferences(storage)).toEqual(defaultFolderPreferences);
  });
});

describe("folder contract", () => {
  it("accepts a folder id on a summary and refuses a malformed one", () => {
    const base = { ...application(1) };
    expect(normalizeApplicationSummary({ ...base, folderId: fintech })?.folderId).toBe(fintech);
    expect(normalizeApplicationSummary({ ...base, folderId: "../etc" })).toBeUndefined();
    expect(normalizeApplicationSummary(base)?.folderId).toBeUndefined();
  });

  it("validates moves and folder lists exactly", () => {
    expect(
      validateApplicationMoveInput({
        workspaceId: "owner",
        applicationId: "app-1",
        folderId: null,
      }),
    ).toEqual({ workspaceId: "owner", applicationId: "app-1", folderId: null });
    expect(
      validateApplicationMoveInput({ workspaceId: "owner", applicationId: "app-1", folderId: "x" }),
    ).toBeUndefined();
    expect(normalizeApplicationFolderListResult({ workspaceId: "owner", folders })).toEqual({
      workspaceId: "owner",
      folders,
    });
    expect(
      normalizeApplicationFolderListResult({
        workspaceId: "owner",
        folders: [{ ...folders[0], extra: true }],
      }),
    ).toBeUndefined();
  });
});
