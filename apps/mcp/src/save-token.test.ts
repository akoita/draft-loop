import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { saveTokenFromInput } from "./agent-token.js";

describe("draftloop-mcp save-token", () => {
  it("keeps a pasted agent token readable by this user only", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "draftloop-save-")), "draftloop", "agent-token");
    // A fictional token of the issued shape.
    const token = `dlagent_${"f".repeat(43)}`;
    expect(await saveTokenFromInput(`  ${token}\n`, path)).toBe(
      `saved: the agent token, to ${path}`,
    );
    expect(await readFile(path, "utf8")).toBe(`${token}\n`);
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("refuses anything else, such as the owner token", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "draftloop-save-")), "agent-token");
    await expect(saveTokenFromInput("owner-token-0123456789abcdef0123", path)).rejects.toThrow(
      "not a DraftLoop agent token",
    );
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });
});
