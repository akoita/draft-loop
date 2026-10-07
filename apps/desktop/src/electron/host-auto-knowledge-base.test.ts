import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DesktopReviewState } from "../model.js";
import { createNativeHost } from "./host.js";

let parent: string;
let storeRoot: string;
let root: string;
let sourcePath: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-auto-kb-"));
  storeRoot = join(parent, "app-data", "candidate-knowledge");
  root = join(parent, "workspace");
  sourcePath = join(parent, "resume.md");
  await writeFile(sourcePath, "Built TypeScript services.\n", "utf8");
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

function createHost() {
  return createNativeHost({
    defaultKnowledgeStoreRoot: storeRoot,
    dialogs: {
      chooseDirectory: async (mode) => (mode === "open" ? root : parent),
      chooseFiles: async () => [],
      chooseKnowledgeSourceFile: async () => sourcePath,
    },
  });
}

type Host = ReturnType<typeof createHost>;

async function createWorkspace(host: Host): Promise<string> {
  const created = await host.invoke({
    type: "workspace.create",
    input: { name: "workspace", mode: "real" },
  });
  if (!created.ok) throw new Error("Expected workspace creation to succeed.");
  await writeFile(join(root, "job.md"), "- TypeScript systems engineer\n", "utf8");
  return (created.value as { workspace: { id: string } }).workspace.id;
}

async function setupOf(host: Host, workspaceId: string) {
  const loaded = await host.invoke({ type: "review.load", input: { workspaceId } });
  if (!loaded.ok) throw new Error("Expected the review to load.");
  return (loaded.value as DesktopReviewState).setup;
}

async function ensureDefault(host: Host, workspaceId: string) {
  const ensured = await host.invoke({ type: "knowledge.ensure-default", input: { workspaceId } });
  if (!ensured.ok) throw new Error(`Expected ensure: ${JSON.stringify(ensured)}`);
  return ensured.value as {
    storeId: string;
    knowledgeBaseId: string;
    displayName: string;
    created: boolean;
  };
}

async function current(host: Host, workspaceId: string) {
  const result = await host.invoke({ type: "knowledge.current", input: { workspaceId } });
  if (!result.ok) throw new Error("Expected the current knowledge to load.");
  return result.value as { store: { storeId: string } | null; selectedKnowledgeBaseIds: string[] };
}

describe("automatic knowledge base on the first career-evidence action", () => {
  it("creates the default store and base without a dialog, then reuses them", async () => {
    let directoryDialogs = 0;
    const host = createNativeHost({
      defaultKnowledgeStoreRoot: storeRoot,
      dialogs: {
        chooseDirectory: async () => {
          directoryDialogs += 1;
          return parent;
        },
        chooseFiles: async () => [],
      },
    });
    const created = await host.invoke({
      type: "workspace.create",
      input: { name: "workspace", mode: "real" },
    });
    if (!created.ok) throw new Error("Expected workspace creation to succeed.");
    const workspaceId = (created.value as { workspace: { id: string } }).workspace.id;
    const dialogsAfterWorkspace = directoryDialogs;

    const first = await ensureDefault(host, workspaceId);
    expect(first).toMatchObject({ displayName: "Career evidence", created: true });
    expect(await readdir(storeRoot)).not.toHaveLength(0);
    expect(directoryDialogs).toBe(dialogsAfterWorkspace);
    // The renderer is never told where the store lives.
    expect(JSON.stringify(first)).not.toContain(parent);

    await expect(ensureDefault(host, workspaceId)).resolves.toEqual({ ...first, created: false });
    // Creating the base does not select it: selection waits for a first source.
    await expect(current(host, workspaceId)).resolves.toMatchObject({
      store: null,
      selectedKnowledgeBaseIds: [],
    });
  });

  it("imports the first file and selects the base, so setup counts it", async () => {
    const host = createHost();
    const workspaceId = await createWorkspace(host);
    const before = await setupOf(host, workspaceId);
    expect(before.evidenceSourceCount).toBe(0);
    expect(before.ready).toBe(false);

    const base = await ensureDefault(host, workspaceId);
    await expect(
      host.invoke({
        type: "knowledge.select",
        input: {
          workspaceId,
          entries: [{ storeId: base.storeId, knowledgeBaseId: base.knowledgeBaseId }],
        },
      }),
    ).resolves.toMatchObject({ ok: false });

    await expect(
      host.invoke({
        type: "knowledge.import-file",
        input: {
          storeId: base.storeId,
          knowledgeBaseId: base.knowledgeBaseId,
          selection: "native-dialog",
        },
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      host.invoke({
        type: "knowledge.select",
        input: {
          workspaceId,
          entries: [{ storeId: base.storeId, knowledgeBaseId: base.knowledgeBaseId }],
        },
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(await current(host, workspaceId)).toMatchObject({
      store: { storeId: base.storeId },
      selectedKnowledgeBaseIds: [base.knowledgeBaseId],
    });
    const after = await setupOf(host, workspaceId);
    expect(after.evidenceSourceCount).toBe(1);
    expect(after.ready).toBe(true);
  });

  it("refuses to ensure a base for a workspace that is not open", async () => {
    const host = createHost();
    await expect(
      host.invoke({ type: "knowledge.ensure-default", input: { workspaceId: "missing" } }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("one-time import of legacy workspace evidence", () => {
  async function workspaceWithLegacyEvidence(host: Host) {
    const workspaceId = await createWorkspace(host);
    await writeFile(join(root, "evidence", "legacy-a.md"), "Legacy evidence A.\n", "utf8");
    await writeFile(join(root, "evidence", "legacy-b.md"), "Legacy evidence B.\n", "utf8");
    return workspaceId;
  }

  it("copies the legacy files into the default base, selects it, and leaves the files", async () => {
    const host = createHost();
    const workspaceId = await workspaceWithLegacyEvidence(host);
    expect((await setupOf(host, workspaceId)).evidenceSourceCount).toBe(2);

    const base = await ensureDefault(host, workspaceId);
    const imported = await host.invoke({
      type: "knowledge.import-workspace-sources",
      input: {
        workspaceId,
        storeId: base.storeId,
        knowledgeBaseId: base.knowledgeBaseId,
        approved: true,
      },
    });
    expect(imported).toMatchObject({
      ok: true,
      value: { status: "complete", discoveredFileCount: 2, sourceCount: 2 },
    });
    await expect(
      host.invoke({
        type: "knowledge.select",
        input: {
          workspaceId,
          entries: [{ storeId: base.storeId, knowledgeBaseId: base.knowledgeBaseId }],
        },
      }),
    ).resolves.toMatchObject({ ok: true });

    const setup = await setupOf(host, workspaceId);
    expect(setup.evidenceSourceCount).toBe(2);
    expect(await readdir(join(root, "evidence"))).toEqual(
      expect.arrayContaining(["legacy-a.md", "legacy-b.md"]),
    );
  });

  it("remembers a decline for the workspace and keeps legacy evidence selected by default", async () => {
    const host = createHost();
    const workspaceId = await workspaceWithLegacyEvidence(host);
    await expect(
      host.invoke({ type: "workspace.evidence-migration.get", input: { workspaceId } }),
    ).resolves.toMatchObject({ ok: true, value: { workspaceId, declined: false } });

    await expect(
      host.invoke({ type: "workspace.evidence-migration.decline", input: { workspaceId } }),
    ).resolves.toMatchObject({ ok: true, value: { workspaceId, declined: true } });
    const saved = JSON.parse(
      await readFile(join(root, ".draft-loop", "legacy-evidence-migration.json"), "utf8"),
    ) as unknown;
    expect(saved).toMatchObject({ schemaVersion: 1, decision: "declined" });

    // A new host (a restart) still sees the decision, and the legacy files still count.
    const restarted = createHost();
    const reopened = await restarted.invoke({
      type: "workspace.open",
      input: { selection: "native-dialog" },
    });
    expect(reopened.ok).toBe(true);
    const reopenedId = (reopened as { value: { workspace: { id: string } } }).value.workspace.id;
    await expect(
      restarted.invoke({
        type: "workspace.evidence-migration.get",
        input: { workspaceId: reopenedId },
      }),
    ).resolves.toMatchObject({ ok: true, value: { declined: true } });
    expect((await setupOf(restarted, reopenedId)).evidenceSourceCount).toBe(2);
    await expect(current(restarted, reopenedId)).resolves.toMatchObject({ store: null });
  });
});

describe("workspaces that already have a selection", () => {
  it("keep their selection and legacy-free count when the default base is ensured", async () => {
    const host = createHost();
    const workspaceId = await createWorkspace(host);
    const otherStore = await host.invoke({
      type: "knowledge.create",
      input: { name: "my-store", displayName: "My evidence", selection: "native-dialog" },
    });
    if (!otherStore.ok) throw new Error("Expected store creation to succeed.");
    const storeId = (otherStore.value as { storeId: string }).storeId;
    const knowledgeBaseId = (otherStore.value as { knowledgeBases: readonly { id: string }[] })
      .knowledgeBases[0]?.id;
    if (knowledgeBaseId === undefined) throw new Error("Expected a default knowledge base.");
    await host.invoke({
      type: "knowledge.import-file",
      input: { storeId, knowledgeBaseId, selection: "native-dialog" },
    });
    await host.invoke({
      type: "knowledge.select",
      input: { workspaceId, entries: [{ storeId, knowledgeBaseId }] },
    });

    const ensured = await ensureDefault(host, workspaceId);
    expect(ensured.storeId).not.toBe(storeId);
    await expect(current(host, workspaceId)).resolves.toMatchObject({
      store: { storeId },
      selectedKnowledgeBaseIds: [knowledgeBaseId],
    });
    expect((await setupOf(host, workspaceId)).evidenceSourceCount).toBe(1);
  });
});

describe("the legacy path stays readable for old workspaces", () => {
  it("does not touch a workspace that never used the new commands", async () => {
    const host = createHost();
    const workspaceId = await createWorkspace(host);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "evidence", "old.md"), "Old evidence.\n", "utf8");
    expect((await setupOf(host, workspaceId)).evidenceSourceCount).toBe(1);
    await expect(readdir(join(root, ".draft-loop"))).resolves.not.toContain(
      "legacy-evidence-migration.json",
    );
  });
});
