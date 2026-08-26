import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProviderAuthModePreferenceStore,
  resolveProviderAuthModeStartup,
} from "./provider-auth-mode.js";

async function temporaryFilename(): Promise<{ directory: string; filename: string }> {
  const directory = await mkdtemp(join(tmpdir(), "draft-loop-provider-auth-"));
  return { directory, filename: join(directory, "nested", "provider-auth-mode.json") };
}

describe("provider authentication mode preference", () => {
  it("persists bounded, validated per-provider mode preferences", async () => {
    const { directory, filename } = await temporaryFilename();
    try {
      const store = createProviderAuthModePreferenceStore(filename);
      expect(await store.get("anthropic")).toBeUndefined();
      expect(await store.get("openai")).toBeUndefined();

      await store.set("openai", "user-session");
      expect(await store.get("openai")).toBe("user-session");
      expect(await store.get("anthropic")).toBe("api-key");
      expect(JSON.parse(await readFile(filename, "utf8"))).toEqual({
        schemaVersion: 1,
        modes: { anthropic: "api-key", openai: "user-session" },
      });

      await store.set("anthropic", "user-session");
      expect(await store.get("openai")).toBe("user-session");
      expect(await store.get("anthropic")).toBe("user-session");

      await expect(store.set("openai", "oauth" as never)).rejects.toThrow(
        "Unsupported provider authentication mode",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("ignores malformed or oversized preference files and never throws from reads", async () => {
    const { directory, filename } = await temporaryFilename();
    try {
      const store = createProviderAuthModePreferenceStore(filename);
      await mkdir(join(directory, "nested"), { recursive: true });
      const cases: readonly unknown[] = [
        "not-json",
        {},
        { schemaVersion: 1, mode: "api-key", extra: true },
        { schemaVersion: 1, mode: "api-key" },
        { schemaVersion: 2, mode: "api-key" },
        { schemaVersion: 1, modes: { anthropic: "oauth", openai: "api-key" } },
        "x".repeat(4 * 1024 + 1),
      ];
      for (const value of cases) {
        await writeFile(filename, typeof value === "string" ? value : JSON.stringify(value));
        expect(await store.get("anthropic")).toBeUndefined();
        expect(await store.get("openai")).toBeUndefined();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves provider-specific and shared environment overrides before the saved mode", () => {
    expect(
      resolveProviderAuthModeStartup(
        { shared: undefined, anthropic: undefined, openai: undefined },
        { anthropic: "user-session", openai: "api-key" },
      ),
    ).toEqual({
      configuration: { anthropic: "user-session", openai: "api-key" },
      environmentOverrides: { anthropic: false, openai: false },
    });

    expect(
      resolveProviderAuthModeStartup(
        { shared: "user-session", anthropic: "api-key", openai: undefined },
        { anthropic: "user-session", openai: "api-key" },
      ),
    ).toEqual({
      configuration: { anthropic: "api-key", openai: "user-session" },
      environmentOverrides: { anthropic: true, openai: true },
    });

    expect(
      resolveProviderAuthModeStartup(
        { shared: "api-key", anthropic: undefined, openai: "user-session" },
        { anthropic: "user-session", openai: "api-key" },
      ),
    ).toEqual({
      configuration: { anthropic: "api-key", openai: "user-session" },
      environmentOverrides: { anthropic: true, openai: true },
    });

    expect(
      resolveProviderAuthModeStartup(
        { shared: undefined, anthropic: "api-key", openai: undefined },
        { anthropic: "user-session", openai: "user-session" },
      ),
    ).toEqual({
      configuration: { anthropic: "api-key", openai: "user-session" },
      environmentOverrides: { anthropic: true, openai: false },
    });
  });
});
