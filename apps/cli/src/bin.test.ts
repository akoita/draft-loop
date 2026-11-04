import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const bin = resolve(import.meta.dirname, "../bin/draft-loop.mjs");

describe("draft-loop bin", () => {
  let folder: string | undefined;
  afterEach(async () => {
    if (folder !== undefined) await rm(folder, { recursive: true, force: true });
    folder = undefined;
  });

  it("runs the work journal commands from any folder, as the self-hosted guide says", async () => {
    folder = await mkdtemp(join(tmpdir(), "draft-loop-bin-"));
    const { stdout } = await run(process.execPath, [bin, "work-journal", "--help"], {
      cwd: folder,
    });
    expect(stdout).toContain("list");
    expect(stdout).toContain("approve");
  }, 60_000);
});
