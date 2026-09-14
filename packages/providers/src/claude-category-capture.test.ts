import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  captureUnknownClaudeCategories,
  maximumLocalClaudeSubtypeBytes,
  maximumLocalClaudeTerminalReasonBytes,
} from "./claude-category-capture.js";

const knownSubtypes = new Set(["error_max_turns", "success"]);
const knownTerminalReasons = new Set(["completed", "model_error"]);

async function withCaptureParent<T>(action: (parent: string) => Promise<T>): Promise<T> {
  const parent = await mkdtemp(join(tmpdir(), "draft-loop-claude-capture-test-"));
  try {
    return await action(parent);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

describe("captureUnknownClaudeCategories", () => {
  it("writes only exact unknown categories into a private new JSON file", async () => {
    await withCaptureParent(async (captureParent) => {
      const outcome = await captureUnknownClaudeCategories({
        captureParent,
        subtype: "future_subtype",
        terminalReason: "future_terminal_reason",
        knownSubtypes,
        knownTerminalReasons,
      });

      const [directoryName] = await readdir(captureParent);
      if (directoryName === undefined) throw new Error("Expected a capture directory.");
      const directory = join(captureParent, directoryName);
      const file = join(directory, "categories.json");
      const contents = await readFile(file, "utf8");

      expect(outcome).toBe("saved");
      expect(directoryName).toMatch(/^claude-category-[0-9a-f-]{36}$/u);
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(contents)).toEqual({
        subtype: "future_subtype",
        terminal_reason: "future_terminal_reason",
      });
      expect(contents).not.toContain("path");
      expect(contents).not.toContain("session");
    });
  });

  it("excludes known, missing, non-string, and malformed values without writing", async () => {
    await withCaptureParent(async (captureParent) => {
      await expect(
        captureUnknownClaudeCategories({
          captureParent,
          subtype: "error_max_turns",
          terminalReason: { marker: "private-malformed-category" },
          knownSubtypes,
          knownTerminalReasons,
        }),
      ).resolves.toBe("not-needed");
      await expect(readdir(captureParent)).resolves.toEqual([]);

      await expect(
        captureUnknownClaudeCategories({
          captureParent,
          subtype: undefined,
          terminalReason: "provider prose marker",
          knownSubtypes,
          knownTerminalReasons,
        }),
      ).resolves.toBe("not-needed");
      await expect(readdir(captureParent)).resolves.toEqual([]);
    });
  });

  it("fails closed on per-field byte-limit overflow without a partial capture", async () => {
    await withCaptureParent(async (captureParent) => {
      const oversizedSubtype = `future_${"x".repeat(maximumLocalClaudeSubtypeBytes)}`;
      const oversizedTerminalReason = `future_${"x".repeat(maximumLocalClaudeTerminalReasonBytes)}`;

      await expect(
        captureUnknownClaudeCategories({
          captureParent,
          subtype: "future_valid_subtype",
          terminalReason: oversizedTerminalReason,
          knownSubtypes,
          knownTerminalReasons,
        }),
      ).resolves.toBe("failed");
      await expect(
        captureUnknownClaudeCategories({
          captureParent,
          subtype: oversizedSubtype,
          terminalReason: undefined,
          knownSubtypes,
          knownTerminalReasons,
        }),
      ).resolves.toBe("failed");
      await expect(readdir(captureParent)).resolves.toEqual([]);
      expect(oversizedSubtype.length).toBeGreaterThan(maximumLocalClaudeSubtypeBytes);
      expect(oversizedTerminalReason.length).toBeGreaterThan(maximumLocalClaudeTerminalReasonBytes);
    });
  });

  it("fails without creating a fallback for an unavailable explicit parent", async () => {
    await withCaptureParent(async (parent) => {
      const unavailableParent = join(parent, "missing-parent");

      await expect(
        captureUnknownClaudeCategories({
          captureParent: unavailableParent,
          subtype: "future_subtype",
          terminalReason: undefined,
          knownSubtypes,
          knownTerminalReasons,
        }),
      ).resolves.toBe("failed");
      await expect(readdir(parent)).resolves.toEqual([]);
    });
  });
});
