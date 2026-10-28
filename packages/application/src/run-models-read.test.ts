import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";
import { readRunModels } from "./run-models-read.js";

describe("run models reader", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  async function workspace(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-run-models-"));
    roots.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "Deliver synthetic platform work.\n", "utf8");
    await writeFile(join(root, "evidence", "resume.md"), "Delivered synthetic work.\n", "utf8");
    await createLocalApplicationDriver().initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      { write: () => undefined },
    );
    return root;
  }

  it("reads the author and critic models a run was configured with", async () => {
    const root = await workspace();
    const service = createApplicationService(createLocalApplicationDriver());
    const snapshot = await service.start({ root }, { write: () => undefined });
    const models = await service.readRunModels?.({ root, runId: snapshot.runId });
    expect(models).toBeDefined();
    expect(Object.keys(models ?? {}).sort()).toEqual(["author", "critic"]);
    expect(Object.keys(models?.author ?? {}).sort()).toEqual(["company", "modelId"]);
    expect(models?.author.modelId).not.toBe("");
    expect(models?.critic.modelId).not.toBe("");
    // Without a run id the workspace's latest run is read.
    await expect(readRunModels({ root })).resolves.toEqual(models);
  });

  it("reads the reasoning level each role ran at when the run used profiles", async () => {
    const root = await workspace();
    const service = createApplicationService(createLocalApplicationDriver());
    const snapshot = await service.start(
      {
        root,
        modelProfiles: {
          author: { id: "economy-anthropic-author", version: 2, effort: "high" },
          critic: { id: "economy-openai-critic", version: 1 },
        },
      },
      { write: () => undefined },
    );
    const models = await service.readRunModels?.({ root, runId: snapshot.runId });
    expect(models?.author.effort).toBe("high");
    expect(models?.critic.effort).toBe("low");
  });

  it("reads nothing for an unknown run or a workspace without history", async () => {
    const root = await workspace();
    await expect(readRunModels({ root, runId: "run-does-not-exist" })).resolves.toBeUndefined();
    await expect(readRunModels({ root })).resolves.toBeUndefined();
  });
});
