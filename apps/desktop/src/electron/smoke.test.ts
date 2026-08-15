import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createNativeHost } from "./host.js";
import { runPackagedSmoke } from "./smoke.js";

describe("packaged desktop smoke workflow", () => {
  it("persists a revision across a host restart and exports the approved draft", async () => {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-packaged-smoke-"));
    const workspaceRoot = join(parent, "packaged-workspace");
    const dialogs = {
      chooseDirectory: vi.fn(async (mode: "open" | "create") =>
        mode === "create" ? parent : workspaceRoot,
      ),
      chooseFiles: vi.fn(async () => []),
    };

    try {
      await runPackagedSmoke({
        host: createNativeHost({ dialogs }),
        phase: "prepare",
        workspaceRoot,
      });
      await runPackagedSmoke({
        host: createNativeHost({ dialogs }),
        phase: "resume",
        workspaceRoot,
      });
    } finally {
      await rm(parent, { recursive: true, force: true });
    }

    expect(dialogs.chooseDirectory).toHaveBeenCalledWith("open");
  }, 10_000);
});
