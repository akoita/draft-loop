import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createNativeHost } from "./host.js";

let parent: string;
let storeRoot: string;
let sourcePath: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-shared-kb-"));
  storeRoot = join(parent, "app-data", "candidate-knowledge");
  sourcePath = join(parent, "resume.md");
  await writeFile(sourcePath, "Built TypeScript services.\n", "utf8");
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

function createHost(openRoot?: string) {
  return createNativeHost({
    defaultKnowledgeStoreRoot: storeRoot,
    dialogs: {
      chooseDirectory: async (mode) =>
        mode === "open" && openRoot !== undefined ? openRoot : parent,
      chooseFiles: async () => [],
      chooseKnowledgeSourceFile: async () => sourcePath,
    },
  });
}

type Host = ReturnType<typeof createHost>;

async function createWorkspace(host: Host, name: string): Promise<string> {
  const created = await host.invoke({ type: "workspace.create", input: { name, mode: "real" } });
  if (!created.ok) throw new Error("Expected workspace creation to succeed.");
  return (created.value as { workspace: { id: string } }).workspace.id;
}

/** Card 02's first-add path: ensure the default base, import a source, then select the base. */
async function addFirstEvidence(host: Host, workspaceId: string) {
  const ensured = await host.invoke({ type: "knowledge.ensure-default", input: { workspaceId } });
  if (!ensured.ok) throw new Error("Expected the default base to be ensured.");
  const base = ensured.value as { storeId: string; knowledgeBaseId: string; created: boolean };
  const imported = await host.invoke({
    type: "knowledge.import-file",
    input: {
      storeId: base.storeId,
      knowledgeBaseId: base.knowledgeBaseId,
      selection: "native-dialog",
    },
  });
  if (!imported.ok) throw new Error("Expected the import to succeed.");
  const selected = await host.invoke({
    type: "knowledge.select",
    input: {
      workspaceId,
      entries: [{ storeId: base.storeId, knowledgeBaseId: base.knowledgeBaseId }],
    },
  });
  if (!selected.ok) throw new Error("Expected the selection to be saved.");
  return base;
}

async function panelStateOf(host: Host, workspaceId: string) {
  const current = await host.invoke({ type: "knowledge.current", input: { workspaceId } });
  if (!current.ok) throw new Error("Expected the current knowledge to load.");
  const value = current.value as {
    store: { storeId: string; knowledgeBases: { id: string }[] } | null;
    selectedKnowledgeBaseIds: string[];
    unavailable?: true;
  };
  if (value.store === null) return { current: value, sources: undefined };
  const sources = await host.invoke({
    type: "knowledge.sources",
    input: {
      storeId: value.store.storeId,
      knowledgeBaseId: value.selectedKnowledgeBaseIds[0] ?? "",
    },
  });
  return { current: value, sources };
}

describe("the Manage career evidence panel on a workspace bound to the shared store", () => {
  it("reports the shared base as current, with its sources, when another workspace made it", async () => {
    const hostA = createHost();
    const workspaceA = await createWorkspace(hostA, "workspace-a");
    const base = await addFirstEvidence(hostA, workspaceA);
    expect(base.created).toBe(true);

    // Workspace B is bound to the existing shared base through card 02's path.
    const hostB = createHost();
    const workspaceB = await createWorkspace(hostB, "workspace-b");
    const bound = await addFirstEvidence(hostB, workspaceB);
    expect(bound).toMatchObject({ storeId: base.storeId, created: false });

    const { current, sources } = await panelStateOf(hostB, workspaceB);
    expect(current.unavailable).toBeUndefined();
    expect(current.store?.storeId).toBe(base.storeId);
    expect(current.selectedKnowledgeBaseIds).toEqual([base.knowledgeBaseId]);
    expect(sources).toMatchObject({ ok: true });
  });

  it("reports the shared base for a workspace reopened by a host that never opened the store", async () => {
    const hostA = createHost();
    const workspaceA = await createWorkspace(hostA, "workspace-a");
    const base = await addFirstEvidence(hostA, workspaceA);

    const restarted = createHost(join(parent, "workspace-a"));
    const reopened = await restarted.invoke({
      type: "workspace.open",
      input: { selection: "native-dialog" },
    });
    expect(reopened.ok).toBe(true);
    const reopenedId = (reopened as { value: { workspace: { id: string } } }).value.workspace.id;

    const { current, sources } = await panelStateOf(restarted, reopenedId);
    expect(current.store?.storeId).toBe(base.storeId);
    expect(current.selectedKnowledgeBaseIds).toEqual([base.knowledgeBaseId]);
    expect(sources).toMatchObject({ ok: true });
  });

  it("answers the panel and card reads the same way when they arrive together", async () => {
    const hostA = createHost();
    const workspaceA = await createWorkspace(hostA, "workspace-a");
    const base = await addFirstEvidence(hostA, workspaceA);

    // Card 02 and the panel both read the current knowledge as soon as the selection changes.
    const reads = await Promise.all(
      Array.from({ length: 4 }, () =>
        hostA.invoke({ type: "knowledge.current", input: { workspaceId: workspaceA } }),
      ),
    );
    for (const read of reads) {
      expect(read).toMatchObject({
        ok: true,
        value: {
          store: { storeId: base.storeId },
          selectedKnowledgeBaseIds: [base.knowledgeBaseId],
        },
      });
    }
  });
});
