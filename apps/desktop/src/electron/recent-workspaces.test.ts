import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createRecentWorkspaceStore } from "./recent-workspaces.js";

const time = (day: number) => `2026-10-${String(day).padStart(2, "0")}T12:00:00.000Z`;

describe("recent workspace store", () => {
  it("orders newest first, deduplicates paths, and keeps at most ten entries", async () => {
    const store = createRecentWorkspaceStore();
    for (let index = 0; index < 11; index += 1) {
      await store.remember(`Workspace ${index}`, `/tmp/workspace-${index}`, time(index + 1));
    }
    const before = await store.list();
    expect(before).toHaveLength(10);
    expect(before.map(({ name }) => name)).toEqual(
      Array.from({ length: 10 }, (_, index) => `Workspace ${10 - index}`),
    );

    const refreshed = await store.remember("Renamed workspace", "/tmp/./workspace-10", time(22));
    const after = await store.list();
    expect(after).toHaveLength(10);
    expect(after[0]).toEqual(refreshed);
    expect(refreshed.id).toBe(before[0]?.id);
    expect(after.filter(({ name }) => name === "Renamed workspace")).toHaveLength(1);
  });

  it("adds only the parent folder name to entries whose display names collide", async () => {
    const store = createRecentWorkspaceStore();
    await store.remember("draft-loop-workspace", "/home/me/hc5/draft-loop-workspace", time(1));
    await store.remember("draft-loop-workspace", "/home/me/hc6/draft-loop-workspace", time(2));
    await store.remember("Mergify — Staff Engineer", "/home/me/hc5/mergify", time(3));
    const listed = await store.list();
    expect(listed.map(({ name, location }) => [name, location])).toEqual([
      ["Mergify — Staff Engineer", undefined],
      ["draft-loop-workspace", "hc6"],
      ["draft-loop-workspace", "hc5"],
    ]);
    expect(JSON.stringify(listed)).not.toContain("/home/me");
    expect("location" in (listed[0] ?? {})).toBe(false);
  });

  it("renames the entry for a path in place and rejects invalid names", async () => {
    const store = createRecentWorkspaceStore();
    const first = await store.remember("one", "/tmp/rename-one", time(1));
    await store.remember("two", "/tmp/rename-two", time(2));
    await store.rename("/tmp/./rename-one", "Mergify — Staff Engineer");
    expect(await store.list()).toEqual([
      expect.objectContaining({ name: "two" }),
      { id: first.id, name: "Mergify — Staff Engineer", lastOpenedAt: first.lastOpenedAt },
    ]);
    await store.rename("/tmp/not-remembered", "Ignored");
    expect(await store.list()).toHaveLength(2);
    await expect(store.rename("/tmp/rename-one", "a/b")).rejects.toThrow();
    await expect(store.rename("/tmp/rename-one", "  padded ")).rejects.toThrow();
  });

  it("removes one entry by id, persists it, and ignores unknown ids", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-recent-workspaces-"));
    try {
      const filename = join(directory, "recent-workspaces.json");
      const store = createRecentWorkspaceStore({ filename });
      const kept = await store.remember("kept", join(directory, "kept"), time(1));
      const removed = await store.remember("removed", join(directory, "removed"), time(2));
      await store.remove(removed.id);
      await store.remove("123e4567-e89b-12d3-a456-426614174999");
      expect(await store.list()).toEqual([kept]);
      expect(await store.resolvePath(removed.id)).toBeUndefined();
      expect(await createRecentWorkspaceStore({ filename }).list()).toEqual([kept]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("compares canonical paths case-insensitively on Windows", async () => {
    const store = createRecentWorkspaceStore({ platform: "win32" });
    const first = await store.remember("Workspace", "/tmp/LocalWorkspace", time(1));
    const second = await store.remember("Workspace renamed", "/tmp/localworkspace", time(2));
    expect(second.id).toBe(first.id);
    expect(await store.list()).toEqual([second]);
  });

  it("keeps display names bounded and removes path or control characters", async () => {
    const store = createRecentWorkspaceStore();
    const entry = await store.remember("workspace\nwith\tcontrols", "/tmp/Workspace", time(2));
    expect(entry.name).toBe("workspace with controls");
    expect(entry.name).not.toContain("/");
    expect(JSON.stringify(entry)).not.toContain("/tmp/Workspace");

    const dotName = await store.remember("..", "/tmp/.", time(3));
    expect(dotName.name).toBe("Workspace");
  });

  it("persists opaque mappings across store instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-recent-workspaces-"));
    try {
      const filename = join(directory, "recent-workspaces.json");
      const root = join(directory, "saved-workspace");
      const first = createRecentWorkspaceStore({ filename });
      const saved = await first.remember("Saved workspace", root, time(3));
      const restarted = createRecentWorkspaceStore({ filename });

      expect(await restarted.list()).toEqual([saved]);
      expect(await restarted.resolvePath(saved.id)).toBe(resolve(root));
      expect(JSON.stringify(await restarted.list())).not.toContain(root);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("treats corrupt persisted data as an empty list and can recover", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-recent-corrupt-"));
    try {
      const filename = join(directory, "recent-workspaces.json");
      await writeFile(filename, "{not-json", "utf8");
      const store = createRecentWorkspaceStore({ filename });
      expect(await store.list()).toEqual([]);
      const entry = await store.remember("Recovered", join(directory, "recovered"), time(4));
      expect(await store.list()).toEqual([entry]);
      expect(JSON.parse(await readFile(filename, "utf8"))).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("ignores persisted dot-only display names", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-recent-dot-name-"));
    try {
      const filename = join(directory, "recent-workspaces.json");
      await writeFile(
        filename,
        JSON.stringify([
          {
            id: "123e4567-e89b-12d3-a456-426614174000",
            name: "..",
            path: join(directory, "workspace"),
            lastOpenedAt: time(5),
          },
        ]),
        "utf8",
      );
      expect(await createRecentWorkspaceStore({ filename }).list()).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
