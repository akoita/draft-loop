import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCli } from "./index.js";
import {
  type ApplicationService,
  CliUserError,
  createApplicationService,
  createLocalApplicationDriver,
  createWorkspaceEvidenceModeService,
  type WorkspaceEvidenceModeService,
} from "./workflow.js";

function setup() {
  const lines: string[] = [];
  const service = {
    get: vi.fn(async () => ({ mode: "retrieval" as const })),
    set: vi.fn(async ({ mode }) => ({ mode, updatedAt: "2030-01-01T00:00:00.000Z" })),
  } satisfies WorkspaceEvidenceModeService;
  const cli = createCli({
    service: {} as ApplicationService,
    evidenceModeService: service,
    io: { write: (line: string) => lines.push(line) },
  });
  cli.exitOverride();
  const run = (...args: string[]) => cli.parseAsync(["node", "draft-loop", "evidence", ...args]);
  return { service, lines, run };
}

describe("evidence mode CLI", () => {
  it("shows the current mode, defaulting to retrieval", async () => {
    const { service, lines, run } = setup();
    await run("mode", "ws");
    expect(service.get).toHaveBeenCalledWith({ root: resolve("ws") });
    expect(service.set).not.toHaveBeenCalled();
    expect(lines).toEqual([
      "evidence mode: retrieval",
      "  sends: the composed top retrieved excerpts",
      "  default: no setting saved",
    ]);
  });

  it("sets full-source and retrieval", async () => {
    const { service, lines, run } = setup();
    await run("mode", "ws", "full-source");
    expect(service.set).toHaveBeenLastCalledWith({ root: resolve("ws"), mode: "full-source" });
    expect(lines).toEqual([
      "evidence mode: full-source (saved)",
      "  sends: every eligible chunk of the selected sources when it fits the budget, else retrieval",
    ]);
    await run("mode", "ws", "retrieval");
    expect(service.set).toHaveBeenLastCalledWith({ root: resolve("ws"), mode: "retrieval" });
  });

  it("prints JSON for both show and set", async () => {
    const { lines, run } = setup();
    await run("mode", "ws", "--json");
    expect(JSON.parse(lines[0] ?? "")).toEqual({ mode: "retrieval" });
    await run("mode", "ws", "full-source", "--json");
    expect(JSON.parse(lines[1] ?? "")).toEqual({
      mode: "full-source",
      updatedAt: "2030-01-01T00:00:00.000Z",
    });
  });

  it("rejects an unknown mode before touching the workspace", async () => {
    const { service, run } = setup();
    await expect(run("mode", "ws", "everything")).rejects.toBeInstanceOf(CliUserError);
    expect(service.get).not.toHaveBeenCalled();
    expect(service.set).not.toHaveBeenCalled();
  });

  describe("with a real workspace", () => {
    const roots: string[] = [];
    afterEach(async () => {
      await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    async function workspaceRoot(): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), "draft-loop-evidence-mode-cli-"));
      roots.push(root);
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Synthetic job.\n", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Synthetic evidence.\n", "utf8");
      await createApplicationService(createLocalApplicationDriver()).initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        { write: () => undefined },
      );
      return root;
    }

    function realCli(lines: string[]) {
      const cli = createCli({
        service: {} as ApplicationService,
        evidenceModeService: createWorkspaceEvidenceModeService(
          () => new Date("2030-02-03T04:05:06.000Z"),
        ),
        io: { write: (line: string) => lines.push(line) },
      });
      cli.exitOverride();
      return (...args: string[]) => cli.parseAsync(["node", "draft-loop", "evidence", ...args]);
    }

    it("persists the mode beside workspace.json and reads it back", async () => {
      const root = await workspaceRoot();
      const lines: string[] = [];
      const run = realCli(lines);
      await run("mode", root, "full-source");
      const saved = JSON.parse(
        await readFile(join(root, ".draft-loop", "evidence-mode.json"), "utf8"),
      );
      expect(saved).toEqual({
        schemaVersion: 1,
        mode: "full-source",
        updatedAt: "2030-02-03T04:05:06.000Z",
      });
      lines.length = 0;
      await run("mode", root, "--json");
      expect(JSON.parse(lines[0] ?? "")).toEqual({
        mode: "full-source",
        updatedAt: "2030-02-03T04:05:06.000Z",
      });
    });

    it("refuses a directory that is not a workspace and a corrupt setting", async () => {
      const root = await workspaceRoot();
      const run = realCli([]);
      await expect(run("mode", join(root, "missing"), "full-source")).rejects.toBeInstanceOf(
        CliUserError,
      );
      await writeFile(join(root, ".draft-loop", "evidence-mode.json"), "{", "utf8");
      await expect(run("mode", root)).rejects.toBeInstanceOf(CliUserError);
    });
  });
});
