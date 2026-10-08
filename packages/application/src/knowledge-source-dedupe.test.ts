import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { importKnowledgeFileWithoutDuplicates } from "./knowledge-source-dedupe.js";

const knowledgeBaseId = "ckb-1";

describe("adding a file to a knowledge base", () => {
  let parent: string;
  let storeRoot: string;
  let counter: number;

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "draft-loop-file-dedupe-"));
    storeRoot = join(parent, "candidate-knowledge");
    counter = 0;
  });

  afterEach(async () => {
    await rm(parent, { force: true, recursive: true });
  });

  async function createService() {
    const ids = ["store-1", knowledgeBaseId];
    const service = createCandidateKnowledgeStoreService({
      generateId: () => ids.shift() ?? `id-${++counter}`,
      now: () => "2026-10-08T09:00:00.000Z",
    });
    await service.initializeStore({ storeRoot });
    return service;
  }

  async function writeSource(relativePath: string, content: string): Promise<string> {
    const path = join(parent, relativePath);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content, "utf8");
    return path;
  }

  const add = (
    service: Awaited<ReturnType<typeof createService>>,
    sourcePath: string,
    displayName?: string,
  ) =>
    importKnowledgeFileWithoutDuplicates(service, {
      storeRoot,
      knowledgeBaseId,
      sourcePath,
      ...(displayName === undefined ? {} : { displayName }),
    });

  const manifests = (service: Awaited<ReturnType<typeof createService>>) =>
    service.listKnowledgeSourceManifests({ storeRoot, knowledgeBaseId });

  it("adds a file that is not in the knowledge base yet as a new source", async () => {
    const service = await createService();
    const path = await writeSource("cv.md", "# CV\nBuilt payment services.\n");

    const first = await add(service, path);

    expect(first.outcome).toBe("added");
    expect(first.result.created).toBe(true);
    expect(await manifests(service)).toHaveLength(1);
  });

  it("recognises identical content from another workspace and creates no source", async () => {
    const service = await createService();
    const original = await writeSource("workspace-a/cv.md", "# CV\nBuilt payment services.\n");
    const copy = await writeSource("workspace-b/evidence/cv.md", "# CV\nBuilt payment services.\n");
    const added = await add(service, original);

    const again = await add(service, copy);
    const sameFile = await add(service, original);

    expect(again.outcome).toBe("already-present");
    expect(again.result.created).toBe(false);
    expect(again.result.source.id).toBe(added.result.source.id);
    expect(again.result.versions).toEqual(added.result.versions);
    expect(sameFile.outcome).toBe("already-present");
    expect(await manifests(service)).toHaveLength(1);
    expect(
      await service.listKnowledgeSourceDuplicateGroups({ storeRoot, knowledgeBaseId }),
    ).toEqual([]);
  });

  it("appends a changed file from the same origin as a new version, not a second source", async () => {
    const service = await createService();
    const path = await writeSource("cv.md", "# CV\nBuilt payment services.\n");
    const added = await add(service, path);

    await writeFile(path, "# CV\nBuilt payment services and led a team of five.\n", "utf8");
    const updated = await add(service, path);

    expect(updated.outcome).toBe("new-version");
    expect(updated.result.created).toBe(true);
    expect(updated.result.source.id).toBe(added.result.source.id);
    expect(updated.result.versions.map((version) => version.version)).toEqual([1, 2]);
    const all = await manifests(service);
    expect(all).toHaveLength(1);
    expect(all[0]?.versions).toHaveLength(2);

    const unchanged = await add(service, path);
    expect(unchanged.outcome).toBe("already-present");
    expect((await manifests(service))[0]?.versions).toHaveLength(2);
  });

  it("adds a changed file from a different origin as a new source", async () => {
    const service = await createService();
    await add(service, await writeSource("a/cv.md", "# CV\nBuilt payment services.\n"));

    const other = await add(service, await writeSource("b/cv.md", "# CV\nDifferent content.\n"));

    expect(other.outcome).toBe("added");
    expect(await manifests(service)).toHaveLength(2);
  });

  it("does not count a retired source: its content is added again as a new source", async () => {
    const service = await createService();
    const path = await writeSource("cv.md", "# CV\nBuilt payment services.\n");
    const first = await add(service, path);
    await service.retireKnowledgeSource({
      storeRoot,
      knowledgeBaseId,
      sourceId: first.result.source.id,
    });

    const again = await add(service, path);

    expect(again.outcome).toBe("added");
    expect(again.result.source.id).not.toBe(first.result.source.id);
    expect(await manifests(service)).toHaveLength(2);
  });

  it("does not append to a retired source that shares the origin of a changed file", async () => {
    const service = await createService();
    const path = await writeSource("cv.md", "# CV\nBuilt payment services.\n");
    const first = await add(service, path);
    await service.retireKnowledgeSource({
      storeRoot,
      knowledgeBaseId,
      sourceId: first.result.source.id,
    });

    await writeFile(path, "# CV\nBuilt payment services and led a team.\n", "utf8");
    const changed = await add(service, path);

    expect(changed.outcome).toBe("added");
    expect(changed.result.source.id).not.toBe(first.result.source.id);
  });

  it("leaves an unreadable file to the regular import to reject", async () => {
    const service = await createService();

    await expect(add(service, join(parent, "missing.md"))).rejects.toThrow();
    expect(await manifests(service)).toHaveLength(0);
  });
});
