import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { expect, it } from "vitest";
import { createLocalApplicationDriver } from "./local.js";

it("uses complete units for new contexts and keeps an existing context pinned on resume", async () => {
  const root = await mkdtemp(join(tmpdir(), "requirement-context-"));
  const silent = { write: () => undefined };
  const driver = createLocalApplicationDriver();
  try {
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "evidence", "source.md"), "Built reliable Python services.");
    await writeFile(
      join(root, "job.md"),
      "# Engineer\n\n- Build reliable\n  Python services.\n- Write useful tests.",
    );
    await driver.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    const first = await driver.begin({ root }, silent);
    const readContext = async (id: string) => {
      const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
      try {
        return await storage.getContextSnapshot(id);
      } finally {
        await storage.close();
      }
    };
    const original = await readContext(first.contextSnapshotId);
    expect(original).toMatchObject({
      payload: {
        requirements: [
          { id: "requirement-1", text: "Build reliable Python services.", priority: "medium" },
          { id: "requirement-2", text: "Write useful tests.", priority: "medium" },
        ],
      },
    });
    await writeFile(join(root, "job.md"), "- Changed requirements for a future run.");
    const resumed = await driver.resume(
      { root, runId: first.runId, allowProviderData: false },
      silent,
    );
    expect(resumed.contextSnapshotId).toBe(first.contextSnapshotId);
    expect(await readContext(first.contextSnapshotId)).toEqual(original);
    const later = await driver.begin({ root }, silent);
    expect(await readContext(later.contextSnapshotId)).toMatchObject({
      payload: {
        requirements: [
          {
            id: "requirement-1",
            text: "Changed requirements for a future run.",
            priority: "medium",
          },
        ],
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
