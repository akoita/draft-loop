import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RecentWorkspacesViewProps } from "./recent-workspaces-ui.js";
import { WorkspaceStartLayout } from "./workspace-start.js";

const form = {
  draft: { name: "draft-loop-workspace", maxRounds: 3 },
  busy: false,
  onDraftChange: () => undefined,
  onCreate: () => undefined,
  onCreateDemo: () => undefined,
  onOpen: () => undefined,
};

const recent = (overrides: Partial<RecentWorkspacesViewProps> = {}): RecentWorkspacesViewProps => ({
  workspaces: [
    {
      id: "123e4567-e89b-12d3-a456-426614174000",
      name: "total-energy",
      lastOpenedAt: "2026-10-10T20:32:35.000Z",
    },
    {
      id: "223e4567-e89b-12d3-a456-426614174000",
      name: "draft-loop-workspace",
      lastOpenedAt: "2026-10-10T14:09:26.000Z",
    },
  ],
  busy: false,
  loadState: "ready",
  errorMessage: null,
  statusMessage: null,
  openingId: null,
  onOpen: () => undefined,
  onClear: () => undefined,
  ...overrides,
});

const order = (html: string, ...labels: string[]) => labels.map((label) => html.indexOf(label));

describe("workspace start page", () => {
  it("leads with the most recent workspace and keeps creation in a closed section", () => {
    const html = renderToStaticMarkup(
      <WorkspaceStartLayout busy={false} form={form} recent={recent()} />,
    );
    const [recentList, openButton, createSection, nameField] = order(
      html,
      "Recent workspaces",
      "Open workspace",
      "Create a new workspace",
      'aria-label="Workspace name"',
    );
    expect(recentList).toBeGreaterThanOrEqual(0);
    expect(recentList).toBeLessThan(openButton ?? -1);
    expect(openButton).toBeLessThan(createSection ?? -1);
    expect(createSection).toBeLessThan(nameField ?? -1);
    expect(html).toContain('<details class="workspace-create-section">');
    expect(html).not.toContain('<details class="workspace-create-section" open');
    expect(html.match(/recent-workspace-open-primary/gu)).toHaveLength(1);
    expect(html.indexOf("recent-workspace-open-primary")).toBeLessThan(
      html.indexOf("draft-loop-workspace</span>"),
    );
    expect(html).toContain("Last used");
    expect(html.match(/Open workspace/gu)).toHaveLength(1);
    expect(html.match(/Try demo workspace/gu)).toHaveLength(1);
  });

  it("keeps the reopen-first layout while the list is loading", () => {
    const html = renderToStaticMarkup(
      <WorkspaceStartLayout
        busy={false}
        form={form}
        recent={recent({ workspaces: [], loadState: "loading" })}
      />,
    );
    expect(html).toContain("Loading recent workspaces");
    expect(html).toContain("Create a new workspace");
  });

  it("makes creation the primary path when there is no usable history", () => {
    for (const state of [
      recent({ workspaces: [] }),
      recent({ workspaces: [], errorMessage: "Recent workspaces could not be loaded." }),
      null,
    ]) {
      const html = renderToStaticMarkup(
        <WorkspaceStartLayout busy={false} form={form} recent={state} />,
      );
      expect(html).not.toContain("Create a new workspace");
      expect(html).not.toContain("recent-workspace-open-primary");
      expect(html).toContain('aria-label="Create or open a review workspace"');
      const [nameField, createButton] = order(
        html,
        'aria-label="Workspace name"',
        "Create workspace",
      );
      expect(nameField).toBeGreaterThanOrEqual(0);
      expect(nameField).toBeLessThan(createButton ?? -1);
      if (state !== null) {
        expect(html.indexOf("Create workspace")).toBeLessThan(html.indexOf("Recent workspaces"));
      }
    }
  });
});
