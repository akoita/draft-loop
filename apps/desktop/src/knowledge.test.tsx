import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { KnowledgeStoreResult } from "./bridge.js";
import {
  activeKnowledgeBases,
  KnowledgeWorkspace,
  safeKnowledgeBaseDisplayName,
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

describe("desktop candidate knowledge workspace", () => {
  it("lists only active bases and avoids rendering path-like names", () => {
    expect(activeKnowledgeBases(store).map(({ id }) => id)).toEqual(["active-1"]);
    expect(safeKnowledgeBaseDisplayName("/home/candidate/profile.md")).toBe(
      "Candidate knowledge base",
    );
    expect(safeKnowledgeBaseDisplayName("D:\\candidate\\profile.md")).toBe(
      "Candidate knowledge base",
    );
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
    expect(html).toContain("Candidate knowledge");
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
