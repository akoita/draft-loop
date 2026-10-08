import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { DesktopReviewState } from "../model.js";
import { createNativeHost } from "./host.js";
import { createRecentWorkspaceStore, type RecentWorkspaceStore } from "./recent-workspaces.js";

let base: string;
let parent: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "draft-loop-workspace-name-"));
  parent = join(base, "hc5");
  await mkdir(parent);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function createHost(recentWorkspaces: RecentWorkspaceStore, chosen: () => string = () => parent) {
  return createNativeHost({
    recentWorkspaces,
    dialogs: {
      chooseDirectory: async () => chosen(),
      chooseFiles: async () => [],
    },
  });
}

type Host = ReturnType<typeof createHost>;

async function value<Value>(host: Host, command: Parameters<Host["invoke"]>[0]): Promise<Value> {
  const result = await host.invoke(command);
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return result.value as Value;
}

async function create(host: Host, name: string) {
  return value<{ workspace: { id: string; name: string } }>(host, {
    type: "workspace.create",
    input: { name, mode: "real" },
  });
}

async function recentList(host: Host) {
  return value<{ workspaces: { id: string; name: string; location?: string }[] }>(host, {
    type: "workspace.recent-list",
    input: {},
  });
}

describe("workspace display names in the native host", () => {
  it("creates a slug folder and keeps the typed display name", async () => {
    const host = createHost(createRecentWorkspaceStore());
    const created = await create(host, "Mergify — Staff Engineer");
    expect(created.workspace.name).toBe("Mergify — Staff Engineer");
    expect(await readdir(parent)).toEqual(["mergify-staff-engineer"]);

    const preferences = JSON.parse(
      await readFile(
        join(parent, "mergify-staff-engineer", ".draft-loop", "review-overrides.json"),
        "utf8",
      ),
    ) as { workspaceName?: string };
    expect(preferences.workspaceName).toBe("Mergify — Staff Engineer");

    const review = await value<DesktopReviewState>(host, { type: "review.load", input: {} });
    expect(review.workspaceName).toBe("Mergify — Staff Engineer");
    expect((await recentList(host)).workspaces).toMatchObject([
      { name: "Mergify — Staff Engineer" },
    ]);
  });

  it("falls back to the folder name when no name is stored", async () => {
    const recent = createRecentWorkspaceStore();
    const host = createHost(recent);
    await create(host, "workspace");
    const preferencesPath = join(parent, "workspace", ".draft-loop", "review-overrides.json");
    const stored = JSON.parse(await readFile(preferencesPath, "utf8")) as Record<string, unknown>;
    delete stored.workspaceName;
    await writeFile(preferencesPath, JSON.stringify(stored), "utf8");

    const rootHost = createHost(recent, () => join(parent, "workspace"));
    const opened = await value<{ workspace: { name: string } }>(rootHost, {
      type: "workspace.open",
      input: { selection: "native-dialog" },
    });
    expect(opened.workspace.name).toBe("workspace");
    expect((await recentList(rootHost)).workspaces[0]?.name).toBe("workspace");
  });

  it("persists a rename, keeps other preferences, and updates the recent entry", async () => {
    const recent = createRecentWorkspaceStore();
    const host = createHost(recent);
    const created = await create(host, "workspace");
    const root = join(parent, "workspace");
    const preferencesPath = join(root, ".draft-loop", "review-overrides.json");
    const stored = JSON.parse(await readFile(preferencesPath, "utf8")) as Record<string, unknown>;
    await writeFile(
      preferencesPath,
      JSON.stringify({ ...stored, decisions: { "finding-1": "accepted" } }),
      "utf8",
    );

    const renamed = await value<{ name: string }>(host, {
      type: "workspace.rename",
      input: { workspaceId: created.workspace.id, name: "  Mergify — Staff Engineer " },
    });
    expect(renamed).toEqual({ name: "Mergify — Staff Engineer" });

    const after = JSON.parse(await readFile(preferencesPath, "utf8")) as {
      workspaceName?: string;
      decisions?: Record<string, string>;
    };
    expect(after.workspaceName).toBe("Mergify — Staff Engineer");
    expect(after.decisions).toEqual({ "finding-1": "accepted" });

    const listed = (await recentList(host)).workspaces;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("Mergify — Staff Engineer");

    // Reopening in a fresh host reads the stored name back, by dialog and by recent id.
    const reopened = createHost(recent, () => root);
    const opened = await value<{ workspace: { name: string } }>(reopened, {
      type: "workspace.open",
      input: { selection: "native-dialog" },
    });
    expect(opened.workspace.name).toBe("Mergify — Staff Engineer");
    const fresh = createHost(recent);
    const byRecent = await value<{ workspace: { name: string } }>(fresh, {
      type: "workspace.recent-open",
      input: { id: listed[0]?.id ?? "" },
    });
    expect(byRecent.workspace.name).toBe("Mergify — Staff Engineer");
    expect(
      (await value<DesktopReviewState>(fresh, { type: "review.load", input: {} })).workspaceName,
    ).toBe("Mergify — Staff Engineer");
  });

  it("rejects an invalid rename or create name without changing anything", async () => {
    const recent = createRecentWorkspaceStore();
    const host = createHost(recent);
    const created = await create(host, "Original");
    for (const name of ["   ", "a/b", "a\\b", "x".repeat(81)]) {
      const result = await host.invoke({
        type: "workspace.rename",
        input: { workspaceId: created.workspace.id, name },
      });
      expect(result.ok).toBe(false);
    }
    expect((await recentList(host)).workspaces[0]?.name).toBe("Original");
    const unknown = await host.invoke({
      type: "workspace.rename",
      input: { workspaceId: "workspace-unknown", name: "Fine" },
    });
    expect(unknown).toMatchObject({ ok: false, error: { code: "not-found" } });
    const bad = await host.invoke({
      type: "workspace.create",
      input: { name: "../escape", mode: "real" },
    });
    expect(bad.ok).toBe(false);
    expect(await readdir(base)).toEqual(["hc5"]);
  });

  it("adds the parent folder name only to recent entries with colliding names", async () => {
    const recent = createRecentWorkspaceStore();
    const other = join(base, "hc6");
    await mkdir(other);
    let chosen = parent;
    const host = createHost(recent, () => chosen);
    await create(host, "draft-loop-workspace");
    chosen = other;
    await create(host, "draft-loop-workspace");
    chosen = parent;
    await create(host, "Mergify — Staff Engineer");

    const listed = (await recentList(host)).workspaces;
    expect(listed.map(({ name, location }) => [name, location])).toEqual([
      ["Mergify — Staff Engineer", undefined],
      ["draft-loop-workspace", "hc6"],
      ["draft-loop-workspace", "hc5"],
    ]);
    expect(JSON.stringify(listed)).not.toContain(base);
  });
});
