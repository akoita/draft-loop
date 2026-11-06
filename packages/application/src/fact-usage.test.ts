import { factUsageKey } from "@draft-loop/domain/fact-usage";
import type { WorkspaceSettingName, WorkspaceSettingsPort } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";
import { changeFactUsage, readFactUsage } from "./fact-usage.js";

function memorySettings(): WorkspaceSettingsPort & { docs: Map<string, string> } {
  const docs = new Map<string, string>();
  const id = (workspace: string, name: WorkspaceSettingName) => `${workspace}/${name}`;
  return {
    docs,
    read: async (workspace, name) => docs.get(id(workspace, name)),
    write: async (workspace, name, content) => void docs.set(id(workspace, name), content),
    remove: async (workspace, name) => docs.delete(id(workspace, name)),
  };
}

const key = factUsageKey({ category: "achievement", field: "salary", value: "high" });

describe("fact usage setting", () => {
  it("reads nothing set as empty settings", async () => {
    expect(await readFactUsage("/ws", memorySettings())).toEqual({
      schemaVersion: 1,
      sections: {},
      facts: {},
    });
  });

  it("stores levels by key and section, without fact text, and clears them", async () => {
    const settings = memorySettings();
    await changeFactUsage("/ws", { kind: "fact", key, level: "never-say" }, settings);
    await changeFactUsage(
      "/ws",
      { kind: "section", category: "skill", level: "interview-only" },
      settings,
    );
    const stored = settings.docs.get("/ws/fact-usage.json") ?? "";
    expect(stored).not.toContain("salary");
    expect(await readFactUsage("/ws", settings)).toEqual({
      schemaVersion: 1,
      sections: { skill: "interview-only" },
      facts: { [key]: "never-say" },
    });
    await changeFactUsage("/ws", { kind: "fact", key, level: null }, settings);
    expect((await readFactUsage("/ws", settings)).facts).toEqual({});
  });

  it("refuses a corrupt setting instead of reading it as unset", async () => {
    const settings = memorySettings();
    settings.docs.set(
      "/ws/fact-usage.json",
      '{"schemaVersion":1,"sections":{},"facts":{"x":"cv"}}',
    );
    await expect(readFactUsage("/ws", settings)).rejects.toThrow("invalid");
  });
});
