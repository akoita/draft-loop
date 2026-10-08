import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { economyDefaultModelPair } from "./default-model-selection.js";
import { createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";
import { getModelProfilePreset } from "./model-profile-catalog.js";
import { readWorkspaceModelProfileSelection } from "./workspace-model-profile-selection.js";
import { withSavedModelProfiles } from "./workspace-model-profile-selection-service.js";

const roots: string[] = [];
const io = { write: () => undefined };

async function newWorkspaceRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-default-selection-"));
  roots.push(root);
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
  return root;
}

function service() {
  return withSavedModelProfiles(createApplicationService(createLocalApplicationDriver()));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("economy defaults for new workspaces", () => {
  it("keeps the built-in defaults equal to the economy preset", async () => {
    const root = await newWorkspaceRoot();
    const driver = createLocalApplicationDriver();
    const workspace = await driver.initialize(
      { root, jobDescription: "job.md", sources: "evidence" },
      io,
    );
    expect(economyDefaultModelPair()).toEqual({
      author: { company: "anthropic", model: "claude-haiku-5-5" },
      critic: { company: "openai", model: "gpt-6-luna" },
    });
    expect({ author: workspace.author, critic: workspace.critic }).toEqual(
      economyDefaultModelPair(),
    );
  });

  it("applies the exact economy profiles when no model is chosen", async () => {
    const root = await newWorkspaceRoot();
    const preset = getModelProfilePreset("economy");

    const workspace = await service().initialize(
      { root, jobDescription: "job.md", sources: "evidence" },
      io,
    );

    expect(workspace.author).toEqual({ company: "anthropic", model: "claude-haiku-5-5" });
    expect(workspace.critic).toEqual({ company: "openai", model: "gpt-6-luna" });
    const selection = await readWorkspaceModelProfileSelection(root);
    expect(selection?.modelProfiles).toEqual({ author: preset.author, critic: preset.critic });
    expect(selection?.modelProfiles).toEqual({
      author: { id: "economy-anthropic-author", version: 2 },
      critic: { id: "economy-openai-critic", version: 1 },
    });
  });

  it("lets an explicit model win and records no selection", async () => {
    const root = await newWorkspaceRoot();

    const workspace = await service().initialize(
      {
        root,
        jobDescription: "job.md",
        sources: "evidence",
        authorModel: "claude-sonnet-4-5",
        criticModel: "gpt-5.6-luna",
      },
      io,
    );

    expect(workspace.author.model).toBe("claude-sonnet-4-5");
    expect(workspace.critic.model).toBe("gpt-5.6-luna");
    expect(await readWorkspaceModelProfileSelection(root)).toBeUndefined();
    await expect(stat(join(root, ".draft-loop", "model-profile-selection.json"))).rejects.toThrow();
  });

  it("leaves the stored models of an existing workspace unchanged on open", async () => {
    const root = await newWorkspaceRoot();
    await createLocalApplicationDriver().initialize(
      {
        root,
        jobDescription: "job.md",
        sources: "evidence",
        authorModel: "claude-sonnet-4-5",
        criticModel: "gpt-5.6-luna",
      },
      io,
    );
    const configPath = join(root, ".draft-loop", "workspace.json");
    const before = await readFile(configPath, "utf8");

    const opened = await service().readWorkspace(root);

    expect(opened.author.model).toBe("claude-sonnet-4-5");
    expect(opened.critic.model).toBe("gpt-5.6-luna");
    expect(await readFile(configPath, "utf8")).toBe(before);
    expect(await readWorkspaceModelProfileSelection(root)).toBeUndefined();
  });
});
