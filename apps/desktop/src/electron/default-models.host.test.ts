import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createNativeHost } from "./host.js";

const parents: string[] = [];

async function create(input: Record<string, unknown>): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "draft-loop-desktop-default-models-"));
  parents.push(parent);
  const host = createNativeHost({
    dialogs: { chooseDirectory: async () => parent, chooseFiles: async () => [] },
  });
  const created = await host.invoke({
    type: "workspace.create",
    input: { name: "Default models", mode: "demo", ...input },
  } as never);
  expect(created).toMatchObject({ ok: true });
  return join(parent, "default-models");
}

async function stored(root: string, file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(root, ".draft-loop", file), "utf8")) as Record<
    string,
    unknown
  >;
}

afterEach(async () => {
  await Promise.all(parents.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("desktop workspace.create model defaults", () => {
  it("creates the economy pair and its exact profile selection without model options", async () => {
    const root = await create({});

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

  it("keeps explicit models and records no economy selection", async () => {
    const root = await create({
      authorModel: "claude-sonnet-4-5",
      criticModel: "gpt-5.6-luna",
    });

    expect(await stored(root, "workspace.json")).toMatchObject({
      authorModel: "claude-sonnet-4-5",
      criticModel: "gpt-5.6-luna",
    });
    await expect(stored(root, "model-profile-selection.json")).rejects.toThrow();
  });
});
