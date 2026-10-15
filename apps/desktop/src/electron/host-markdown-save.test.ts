import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { createNativeHost } from "./host.js";

const chooseDirectory = async (): Promise<string | undefined> => undefined;
const chooseFiles = async (): Promise<readonly string[]> => [];

describe("saving renderer Markdown from the host", () => {
  it("writes the content only to the file the person picked", async () => {
    const folder = await mkdtemp(join(tmpdir(), "draft-loop-markdown-save-"));
    try {
      const target = join(folder, "my comparison.md");
      const chooseMarkdownSavePath = vi.fn(async () => target);
      const host = createNativeHost({
        dialogs: { chooseDirectory, chooseFiles, chooseMarkdownSavePath },
      });

      const result = await host.invoke({
        type: "file.save-markdown",
        input: { suggestedName: "run-1-vs-run-2-comparison.md", content: "# Run comparison\n" },
      });

      expect(result).toEqual({ ok: true, value: { saved: true, fileName: "my comparison.md" } });
      expect(chooseMarkdownSavePath).toHaveBeenCalledWith("run-1-vs-run-2-comparison.md");
      await expect(readFile(target, "utf8")).resolves.toBe("# Run comparison\n");
      expect(JSON.stringify(result)).not.toContain(folder);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("writes nothing when the dialog is cancelled", async () => {
    const folder = await mkdtemp(join(tmpdir(), "draft-loop-markdown-cancel-"));
    try {
      const host = createNativeHost({
        dialogs: { chooseDirectory, chooseFiles, chooseMarkdownSavePath: async () => undefined },
      });

      const result = await host.invoke({
        type: "file.save-markdown",
        input: { suggestedName: "comparison.md", content: "text" },
      });

      expect(result).toEqual({ ok: true, value: { saved: false, fileName: null } });
      await expect(readdir(folder)).resolves.toEqual([]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("rejects a suggested path before any dialog opens", async () => {
    const chooseMarkdownSavePath = vi.fn(async () => "/tmp/never.md");
    const host = createNativeHost({
      dialogs: { chooseDirectory, chooseFiles, chooseMarkdownSavePath },
    });

    const result = await host.invoke({
      type: "file.save-markdown",
      input: { suggestedName: "../outside.md", content: "text" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(chooseMarkdownSavePath).not.toHaveBeenCalled();
  });
});
