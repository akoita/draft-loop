import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createCli } from "./index.js";
import { applicationService } from "./workflow.js";

const roots: string[] = [];

async function workspaceInputs(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "draft-loop-cli-default-models-"));
  roots.push(root);
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
  return root;
}

async function init(root: string, ...extra: readonly string[]): Promise<void> {
  await createCli({ service: applicationService, io: { write: () => undefined } }).parseAsync([
    "node",
    "draft-loop",
    "init",
    root,
    "-j",
    "job.md",
    "-s",
    "evidence",
    ...extra,
  ]);
}

async function stored(root: string, file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, ".draft-loop", file), "utf8")) as Record<
    string,
    unknown
  >;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("draft-loop init model defaults", () => {
  it("writes the economy pair and its exact profile selection without model options", async () => {
    const root = await workspaceInputs();

    await init(root);

    expect(await stored(root, "workspace.json")).toMatchObject({
      authorCompany: "anthropic",
      authorModel: "claude-haiku-5-5",
      criticCompany: "openai",
      criticModel: "gpt-6-luna",
    });
    expect(await stored(root, "model-profile-selection.json")).toMatchObject({
      modelProfiles: {
        author: { id: "economy-anthropic-author", version: 2 },
        critic: { id: "economy-openai-critic", version: 1 },
      },
    });
  });

  it("keeps an explicit author model and records no economy selection", async () => {
    const root = await workspaceInputs();

    await init(root, "--author-model", "claude-sonnet-4-5");

    expect(await stored(root, "workspace.json")).toMatchObject({
      authorModel: "claude-sonnet-4-5",
      criticModel: "gpt-6-luna",
    });
    await expect(stored(root, "model-profile-selection.json")).rejects.toThrow();
  });

  it("shows the economy defaults in the init help", () => {
    const help = createCli()
      .commands.find((command) => command.name() === "init")
      ?.helpInformation();

    expect(help).toContain('(default: "claude-haiku-5-5")');
    expect(help).toContain('(default: "gpt-6-luna")');
    expect(help).not.toContain("claude-sonnet-4-5");
    expect(help).not.toContain("gpt-5.6-luna");
  });
});
