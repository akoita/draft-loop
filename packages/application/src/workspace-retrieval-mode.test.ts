import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import {
  defaultRetrievalMode,
  parseRetrievalMode,
  readWorkspaceRetrievalMode,
  retrievalModeInvalidMessage,
  writeWorkspaceRetrievalMode,
} from "./workspace-retrieval-mode.js";

describe("workspace retrieval mode", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  async function workspace(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-mode-"));
    directories.push(root);
    await mkdir(join(root, ".draft-loop"), { recursive: true });
    return root;
  }

  const modePath = (root: string) => join(root, ".draft-loop", "retrieval-mode.json");
  const timestamp = "2030-01-01T00:00:00.000Z";

  it("defaults to lexical retrieval with the 311m tier when no setting was saved", async () => {
    expect(defaultRetrievalMode).toBe("lexical");
    expect(await readWorkspaceRetrievalMode(await workspace())).toEqual({
      mode: "lexical",
      modelTier: "311m",
    });
  });

  it("round-trips a saved mode and tier with the documented file shape", async () => {
    const root = await workspace();
    const saved = await writeWorkspaceRetrievalMode(
      root,
      { mode: "hybrid", modelTier: "97m" },
      () => new Date("2030-01-02T03:04:05.000Z"),
    );
    expect(saved).toEqual({
      mode: "hybrid",
      modelTier: "97m",
      updatedAt: "2030-01-02T03:04:05.000Z",
    });
    expect(JSON.parse(await readFile(modePath(root), "utf8"))).toEqual({
      schemaVersion: 1,
      mode: "hybrid",
      modelTier: "97m",
      updatedAt: "2030-01-02T03:04:05.000Z",
    });
    expect(await readWorkspaceRetrievalMode(root)).toEqual(saved);
    const semantic = await writeWorkspaceRetrievalMode(root, { mode: "semantic" });
    expect(semantic.modelTier).toBe("311m");
    expect((await readWorkspaceRetrievalMode(root)).mode).toBe("semantic");
  });

  it.each([
    ["not JSON", "{"],
    [
      "an unknown mode",
      JSON.stringify({ schemaVersion: 1, mode: "dense", modelTier: "311m", updatedAt: timestamp }),
    ],
    [
      "an unknown tier",
      JSON.stringify({ schemaVersion: 1, mode: "hybrid", modelTier: "1b", updatedAt: timestamp }),
    ],
    [
      "a wrong schema version",
      JSON.stringify({ schemaVersion: 2, mode: "hybrid", modelTier: "311m", updatedAt: timestamp }),
    ],
    ["a missing tier", JSON.stringify({ schemaVersion: 1, mode: "hybrid", updatedAt: timestamp })],
    [
      "a missing timestamp",
      JSON.stringify({ schemaVersion: 1, mode: "hybrid", modelTier: "311m" }),
    ],
    [
      "an extra key",
      JSON.stringify({
        schemaVersion: 1,
        mode: "hybrid",
        modelTier: "311m",
        updatedAt: timestamp,
        extra: 1,
      }),
    ],
  ])("fails closed on %s with a fixed content-free error", async (_label, content) => {
    const root = await workspace();
    await writeFile(modePath(root), content, "utf8");
    const failure = readWorkspaceRetrievalMode(root);
    await expect(failure).rejects.toBeInstanceOf(CliUserError);
    await expect(failure).rejects.toThrow(retrievalModeInvalidMessage);
  });

  it("fails closed when the setting cannot be read at all", async () => {
    const root = await workspace();
    await mkdir(modePath(root));
    await expect(readWorkspaceRetrievalMode(root)).rejects.toThrow(retrievalModeInvalidMessage);
  });

  it("parses only the three modes", () => {
    expect(parseRetrievalMode("lexical")).toBe("lexical");
    expect(parseRetrievalMode("semantic")).toBe("semantic");
    expect(parseRetrievalMode("hybrid")).toBe("hybrid");
    expect(() => parseRetrievalMode("dense")).toThrow(CliUserError);
  });
});
