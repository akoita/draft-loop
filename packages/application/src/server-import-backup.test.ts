import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { readBackupForServerImport } from "./server-import-backup.js";

describe("readBackupForServerImport", () => {
  let parent: string;

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "draft-loop-server-import-backup-"));
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  async function fictionalBackup(): Promise<string> {
    const service = createCandidateKnowledgeStoreService();
    const storeRoot = join(parent, "store");
    const store = await service.initializeStore({ storeRoot });
    const knowledgeBaseId = store.knowledgeBases[0]?.id ?? "";
    for (const [name, text] of [
      ["cv.md", "# Alex Example\n\nBuilt a fictional ledger service at Example Ltd.\n"],
      ["notes.txt", "Fictional talk notes for the import test.\n"],
    ] as const) {
      const sourcePath = join(parent, name);
      await writeFile(sourcePath, text);
      await service.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });
    }
    const archived = await service.createKnowledgeBase({ storeRoot, displayName: "Old evidence" });
    const archivedId =
      archived.knowledgeBases.find(({ displayName }) => displayName === "Old evidence")?.id ?? "";
    await service.archiveKnowledgeBase({ storeRoot, knowledgeBaseId: archivedId });
    const destination = join(parent, "backup");
    await service.exportCandidateKnowledgeStore({ storeRoot, destination, approved: true });
    return destination;
  }

  it("plans the active bases' latest sources and reads their verified bytes", async () => {
    const backup = await fictionalBackup();

    const plan = await readBackupForServerImport(backup);

    expect(plan.archivedKnowledgeBases).toBe(1);
    expect(plan.knowledgeBases).toHaveLength(1);
    const [base] = plan.knowledgeBases;
    expect(base?.displayName).toBe("Career evidence");
    expect(base?.sources.map(({ displayName, mediaType }) => ({ displayName, mediaType }))).toEqual(
      expect.arrayContaining([
        { displayName: "cv.md", mediaType: "text/markdown" },
        { displayName: "notes.txt", mediaType: "text/plain" },
      ]),
    );
    const cv = base?.sources.find(({ displayName }) => displayName === "cv.md");
    if (cv === undefined) throw new Error("missing source");
    expect(new TextDecoder().decode(await plan.read(cv))).toContain("fictional ledger service");
  });

  it("refuses a file that changed after the backup was verified", async () => {
    const backup = await fictionalBackup();
    const plan = await readBackupForServerImport(backup);
    const source = plan.knowledgeBases[0]?.sources[0];
    if (source === undefined) throw new Error("missing source");
    for (const name of await readdir(join(backup, "objects"))) {
      await writeFile(join(backup, "objects", name), "tampered");
    }

    await expect(plan.read(source)).rejects.toThrow(/could not be verified/u);
  });

  it("refuses a folder that is not a verified backup", async () => {
    await expect(readBackupForServerImport(join(parent, "missing"))).rejects.toThrow(
      /could not be verified/u,
    );
  });
});
