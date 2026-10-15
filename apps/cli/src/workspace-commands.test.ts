import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCli } from "./index.js";
import { createApplicationService, createLocalApplicationDriver } from "./workflow.js";

describe("workspace compact", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function setup() {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-workspace-cli-"));
    directories.push(root);
    const compactHistory = vi.fn(async () => ({
      beforeBytes: 3 * 1024 * 1024,
      afterBytes: 1024 * 1024,
      backupFileName: "history.sqlite.pre-compaction-20261016T083000Z",
      runsVerified: 4,
    }));
    const service = {
      ...createApplicationService(createLocalApplicationDriver()),
      compactHistory,
    };
    const lines: string[] = [];
    const cli = createCli({ service, io: { write: (line: string) => lines.push(line) } });
    cli.exitOverride();
    const run = (...args: string[]) => cli.parseAsync(["node", "draft-loop", ...args]);
    return { root, compactHistory, lines, run };
  }

  it("does nothing without --yes", async () => {
    const { root, compactHistory, run } = await setup();

    await expect(run("workspace", "compact", root)).rejects.toThrow(/--yes/u);
    expect(compactHistory).not.toHaveBeenCalled();
  });

  it("compacts with --yes and prints the sizes and the backup", async () => {
    const { root, compactHistory, lines, run } = await setup();

    await run("workspace", "compact", root, "--yes");

    expect(compactHistory).toHaveBeenCalledWith({ root });
    expect(lines.join("\n")).toContain("3.0 MB before, 1.0 MB after");
    expect(lines.join("\n")).toContain("history.sqlite.pre-compaction-20261016T083000Z");
    expect(lines.join("\n")).toContain("4 runs");
  });

  it("prints machine-readable JSON", async () => {
    const { root, lines, run } = await setup();

    await run("workspace", "compact", root, "--yes", "--json");

    expect(JSON.parse(lines.join("\n"))).toMatchObject({ beforeBytes: 3145728, runsVerified: 4 });
  });
});
