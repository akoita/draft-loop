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
