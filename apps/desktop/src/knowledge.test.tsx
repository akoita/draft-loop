import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeStoreResult } from "./bridge.js";
import {
  activeKnowledgeBases,
  KnowledgeBaseList,
  KnowledgeWorkspace,
  SavedKnowledgeStatus,
  safeKnowledgeBaseDisplayName,
  savedKnowledgeUnavailableMessage,
  selectCandidateKnowledgeBaseAndRefresh,
} from "./knowledge.js";

const store: KnowledgeStoreResult = {
  storeId: "store-1",
  knowledgeBases: [
    {
      id: "active-1",
      displayName: "Engineering",
      description: "",
      state: "active",
      isDefault: true,
    },
    { id: "archived-1", displayName: "Old", description: "", state: "archived", isDefault: false },
  ],
};

const noop = () => undefined;
const workspaceCapabilities = {
  createCandidateKnowledgeStore: async () => store,
  openCandidateKnowledgeStore: async () => store,
  selectCandidateKnowledgeBase: async () => ({ workspaceId: "workspace-1", entries: [] }),
};

function renderList(options: {
  intake: boolean;
  workspace: boolean;
  bases?: typeof store.knowledgeBases;
  selected?: readonly string[];
}) {
  return renderToStaticMarkup(
    <KnowledgeBaseList
      storeId="store-1"
      knowledgeBases={options.bases ?? activeKnowledgeBases(store)}
      disabled={false}
      intakeSupported={options.intake}
      workspaceSourcesSupported={options.workspace}
      selectedKnowledgeBaseIds={options.selected ?? []}
      onSelect={noop}
      onImport={noop}
    />,
  );
}

describe("desktop candidate knowledge workspace", () => {
  it("renders a header like the sibling stage panels and styled store controls", () => {
    const html = renderToStaticMarkup(
      <KnowledgeWorkspace
        workspaceId="workspace-1"
        capabilities={workspaceCapabilities}
        disabled={false}
        onPendingChange={noop}
        onSelectionSaved={async () => true}
      />,
    );

    expect(html).toContain('<p class="eyebrow">Career evidence</p>');
    expect(html).toContain('<h2 id="candidate-knowledge-heading">Knowledge store</h2>');
    expect(html).toContain("Reusable career evidence, kept separate from application material.");
    expect(html).toContain('class="knowledge-store-row"');
    expect(html).toContain('id="candidate-knowledge-name"');
    expect(html).toMatch(/class="button button-primary"[^>]*>Create knowledge store</);
    expect(html).toMatch(/class="button button-outline"[^>]*>Open knowledge store</);
    expect(html).not.toContain("form-row");
    expect(html).not.toContain("button-row");
  });

  it("renders each knowledge base as a card with a Default chip and styled actions", () => {
    const html = renderList({
      intake: true,
      workspace: true,
      bases: [
        ...activeKnowledgeBases(store),
        {
          id: "active-2",
          displayName: "Side projects",
          description: "",
          state: "active",
          isDefault: false,
        },
      ],
    });

    expect(html.match(/class="knowledge-base-card"/g)).toHaveLength(2);
    expect(html.match(/>Default</g)).toHaveLength(1);
    expect(html).toContain("<strong>Engineering</strong>");
    expect(html).toMatch(/class="button button-primary"[^>]*>Use this knowledge base</);
    expect(html).toMatch(/class="button button-outline"[^>]*>Add file</);
    expect(html).toMatch(/class="button button-outline"[^>]*>Add directory</);
    expect(html).toMatch(/class="button button-outline"[^>]*>Import legacy workspace evidence</);
  });

  it("marks the bases the workspace already uses and disables their select button", () => {
    const bases = [
      ...activeKnowledgeBases(store),
      {
        id: "active-2",
        displayName: "Side projects",
        description: "",
        state: "active" as const,
        isDefault: false,
      },
    ];
    const html = renderList({ intake: true, workspace: true, bases, selected: ["active-2"] });
    expect(html.match(/>In use</g)).toHaveLength(2);
    expect(html.match(/<span class="meta-chip">In use<\/span>/g)).toHaveLength(1);
    expect(html.match(/>Use this knowledge base</g)).toHaveLength(1);
    expect(html).toMatch(/class="button button-primary" disabled=""[^>]*>In use</);

    const none = renderList({ intake: true, workspace: true, bases });
    expect(none).not.toContain("In use");
    expect(none.match(/>Use this knowledge base</g)).toHaveLength(2);
  });

  it("explains an unavailable saved store and shows loading", () => {
    expect(renderToStaticMarkup(<SavedKnowledgeStatus loading={false} unavailable />)).toContain(
      savedKnowledgeUnavailableMessage,
    );
    expect(savedKnowledgeUnavailableMessage).toBe(
      "The saved knowledge store could not be opened from its saved location. Open it again to continue.",
    );
    expect(renderToStaticMarkup(<SavedKnowledgeStatus loading unavailable />)).toContain(
      "Loading saved knowledge…",
    );
    expect(renderToStaticMarkup(<SavedKnowledgeStatus loading={false} unavailable={false} />)).toBe(
      "",
    );
  });

  it("explains workspace import only when it is supported", () => {
    const supported = renderList({ intake: true, workspace: true });
    expect(supported).toContain("imports all supported files from this workspace");
    expect(supported).not.toContain("Legacy workspace evidence import is unavailable");

    const unsupported = renderList({ intake: false, workspace: false });
    expect(unsupported).not.toContain("imports all supported files from this workspace");
    expect(unsupported).toContain("Legacy workspace evidence import is unavailable");
    expect(unsupported).toContain("File and directory intake is unavailable");
    expect(unsupported).not.toContain("Add file");
    expect(unsupported).toContain("Use this knowledge base");
  });

  it("keeps the empty message as a hint", () => {
    const html = renderList({ intake: true, workspace: true, bases: [] });
    expect(html).toContain("No active knowledge bases are available.");
    expect(html).not.toContain("knowledge-base-card");
  });

  it("lists only active bases and avoids rendering path-like names", () => {
    expect(activeKnowledgeBases(store).map(({ id }) => id)).toEqual(["active-1"]);
    expect(safeKnowledgeBaseDisplayName("/home/candidate/profile.md")).toBe("Knowledge base");
    expect(safeKnowledgeBaseDisplayName("D:\\candidate\\profile.md")).toBe("Knowledge base");
    expect(safeKnowledgeBaseDisplayName("Engineering")).toBe("Engineering");
  });

  it("explains when the host does not provide the complete capability set", () => {
    const html = renderToStaticMarkup(
      <KnowledgeWorkspace
        workspaceId="workspace-1"
        capabilities={{}}
        disabled={false}
        onPendingChange={() => undefined}
        onSelectionSaved={async () => true}
      />,
    );

    expect(html).toContain("Knowledge-store selection is unavailable");
    expect(html).toContain("Career evidence");
  });

  it("accepts only the exact one-base result before refreshing the same workspace", async () => {
    const refresh = vi.fn(async () => true);
    const select = vi.fn(async () => ({
      workspaceId: "workspace-1",
      entries: [{ storeId: "store-1", knowledgeBaseId: "active-1" }],
    }));

    await expect(
      selectCandidateKnowledgeBaseAndRefresh({
        workspaceId: "workspace-1",
        storeId: "store-1",
        knowledgeBaseId: "active-1",
        isCurrent: () => true,
        select,
        refresh,
      }),
    ).resolves.toBe(true);
    expect(select).toHaveBeenCalledWith("workspace-1", {
      storeId: "store-1",
      knowledgeBaseId: "active-1",
    });
    expect(refresh).toHaveBeenCalledWith("workspace-1");
  });

  it("rejects mismatched selection results without reporting a refresh", async () => {
    const refresh = vi.fn(async () => true);

    await expect(
      selectCandidateKnowledgeBaseAndRefresh({
        workspaceId: "workspace-1",
        storeId: "store-1",
        knowledgeBaseId: "active-1",
        isCurrent: () => true,
        select: async () => ({
          workspaceId: "workspace-2",
          entries: [{ storeId: "store-1", knowledgeBaseId: "active-1" }],
        }),
        refresh,
      }),
    ).rejects.toThrow("Selection result did not match");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("ignores stale completions and native selection failures", async () => {
    const refresh = vi.fn(async () => true);
    const select = async () => ({
      workspaceId: "workspace-1",
      entries: [{ storeId: "store-1", knowledgeBaseId: "active-1" }],
    });

    await expect(
      selectCandidateKnowledgeBaseAndRefresh({
        workspaceId: "workspace-1",
        storeId: "store-1",
        knowledgeBaseId: "active-1",
        isCurrent: () => false,
        select,
        refresh,
      }),
    ).resolves.toBe(false);
    await expect(
      selectCandidateKnowledgeBaseAndRefresh({
        workspaceId: "workspace-1",
        storeId: "store-1",
        knowledgeBaseId: "active-1",
        isCurrent: () => true,
        select: async () => {
          throw new Error("native dialog canceled");
        },
        refresh,
      }),
    ).rejects.toThrow("native dialog canceled");
    expect(refresh).not.toHaveBeenCalled();
  });
});
