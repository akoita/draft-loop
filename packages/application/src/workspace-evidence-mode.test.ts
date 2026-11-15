import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { openRunCandidateRetrieval } from "./run-evidence-retrieval.js";
import {
  evidenceModeInvalidMessage,
  parseEvidenceMode,
  parseMaxEvidenceTokens,
  readWorkspaceEvidenceMode,
  writeWorkspaceEvidenceMode,
} from "./workspace-evidence-mode.js";

describe("workspace evidence mode", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  async function workspace(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-evidence-mode-"));
    directories.push(root);
    await mkdir(join(root, ".draft-loop"), { recursive: true });
    return root;
  }

  const modePath = (root: string) => join(root, ".draft-loop", "evidence-mode.json");

  it("defaults to full source when no setting was saved", async () => {
    expect(await readWorkspaceEvidenceMode(await workspace())).toEqual({ mode: "full-source" });
  });

  it("round-trips a saved mode with the documented file shape", async () => {
    const root = await workspace();
    const saved = await writeWorkspaceEvidenceMode(
      root,
      "full-source",
      () => new Date("2030-01-02T03:04:05.000Z"),
    );
    expect(saved).toEqual({ mode: "full-source", updatedAt: "2030-01-02T03:04:05.000Z" });
    expect(JSON.parse(await readFile(modePath(root), "utf8"))).toEqual({
      schemaVersion: 1,
      mode: "full-source",
      updatedAt: "2030-01-02T03:04:05.000Z",
    });
    expect(await readWorkspaceEvidenceMode(root)).toEqual(saved);
    await writeWorkspaceEvidenceMode(root, "retrieval");
    expect((await readWorkspaceEvidenceMode(root)).mode).toBe("retrieval");
  });

  it("saves an optional cost cap and clears it when a mode is saved without one", async () => {
    const root = await workspace();
    const at = () => new Date("2030-01-02T03:04:05.000Z");
    const saved = await writeWorkspaceEvidenceMode(root, "full-source", at, 50_000);
    expect(saved).toEqual({
      mode: "full-source",
      maxEvidenceTokens: 50_000,
      updatedAt: "2030-01-02T03:04:05.000Z",
    });
    expect(JSON.parse(await readFile(modePath(root), "utf8"))).toEqual({
      schemaVersion: 1,
      mode: "full-source",
      maxEvidenceTokens: 50_000,
      updatedAt: "2030-01-02T03:04:05.000Z",
    });
    expect(await readWorkspaceEvidenceMode(root)).toEqual(saved);
    await writeWorkspaceEvidenceMode(root, "full-source", at);
    expect(await readWorkspaceEvidenceMode(root)).toEqual({
      mode: "full-source",
      updatedAt: "2030-01-02T03:04:05.000Z",
    });
  });

  it.each([0, 999, 1_000_001, 1.5])("refuses a cost cap of %s", async (tokens) => {
    const root = await workspace();
    await expect(
      writeWorkspaceEvidenceMode(root, "full-source", undefined, tokens),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it("parses the CLI cap and refuses anything but a whole number in range", () => {
    expect(parseMaxEvidenceTokens("50000")).toBe(50_000);
    for (const value of ["", "5e4", "-1000", "12.5", "999", "1000001", "many"]) {
      expect(() => parseMaxEvidenceTokens(value)).toThrow(CliUserError);
    }
  });

  it.each([
    [
      "a cap out of range",
      JSON.stringify({
        schemaVersion: 1,
        mode: "full-source",
        maxEvidenceTokens: 10,
        updatedAt: "2030-01-02T03:04:05.000Z",
      }),
    ],
    ["not JSON", "{"],
    [
      "an unknown mode",
      JSON.stringify({
        schemaVersion: 1,
        mode: "everything",
        updatedAt: "2030-01-01T00:00:00.000Z",
      }),
    ],
    [
      "a wrong schema version",
      JSON.stringify({
        schemaVersion: 2,
        mode: "full-source",
        updatedAt: "2030-01-01T00:00:00.000Z",
      }),
    ],
    ["a missing timestamp", JSON.stringify({ schemaVersion: 1, mode: "full-source" })],
    [
      "an extra key",
      JSON.stringify({
        schemaVersion: 1,
        mode: "full-source",
        updatedAt: "2030-01-01T00:00:00.000Z",
        extra: 1,
      }),
    ],
  ])("fails closed on %s", async (_label, content) => {
    const root = await workspace();
    await writeFile(modePath(root), content, "utf8");
    const failure = readWorkspaceEvidenceMode(root);
    await expect(failure).rejects.toBeInstanceOf(CliUserError);
    await expect(failure).rejects.toThrow(evidenceModeInvalidMessage);
  });

  it("fails closed when the setting cannot be read at all", async () => {
    const root = await workspace();
    await mkdir(modePath(root));
    await expect(readWorkspaceEvidenceMode(root)).rejects.toBeInstanceOf(CliUserError);
  });

  it("parses only the two modes", () => {
    expect(parseEvidenceMode("full-source")).toBe("full-source");
    expect(parseEvidenceMode("retrieval")).toBe("retrieval");
    expect(() => parseEvidenceMode("all")).toThrow(CliUserError);
  });

  it("reads the setting every time a run opens its retrieval, and fails closed on a corrupt one", async () => {
    const root = await workspace();
    const storage = { appendCandidateKnowledgeRetrievalTrace: async () => undefined as never };
    const config = { id: "workspace", requiredSections: [] };
    const context = {} as never;
    // Without a candidate knowledge selection there is no retrieval to configure.
    expect(await openRunCandidateRetrieval(storage, root, config, context)).toBeUndefined();
    await writeWorkspaceEvidenceMode(root, "full-source");
    expect(await openRunCandidateRetrieval(storage, root, config, context)).toBeUndefined();
    await writeFile(modePath(root), "corrupt", "utf8");
    await expect(openRunCandidateRetrieval(storage, root, config, context)).rejects.toBeInstanceOf(
      CliUserError,
    );
  });
});
