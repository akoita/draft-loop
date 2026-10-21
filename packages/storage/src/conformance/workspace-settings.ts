import { describe, expect, it } from "vitest";
import type { WorkspaceSettingsPort } from "../ports/workspace-settings.js";
import type { StorageContract } from "./history-records.js";

/** A settings store under test and two workspace references valid in it. */
export interface WorkspaceSettingsUnderTest {
  readonly settings: WorkspaceSettingsPort;
  readonly workspaces: readonly [string, string];
}

export interface OpenedWorkspaceSettings {
  readonly storage: WorkspaceSettingsUnderTest;
  readonly close: () => Promise<void>;
}

export type WorkspaceSettingsFactory = () => Promise<OpenedWorkspaceSettings>;

/** Every workspace settings contract, in a stable order. */
export const workspaceSettingsContracts: readonly StorageContract<WorkspaceSettingsUnderTest>[] = [
  {
    name: "workspace settings: a document never written reads as undefined",
    check: async ({ settings, workspaces: [workspace] }) => {
      expect(await settings.read(workspace, "workspace.json")).toBeUndefined();
      expect(await settings.remove(workspace, "workspace.json")).toBe(false);
    },
  },
  {
    name: "workspace settings: reads back exactly what was written",
    check: async ({ settings, workspaces: [workspace] }) => {
      const policy = "# Policy\n\nTone: direct — “plain” words, ünïcödé ✓\r\n";
      await settings.write(workspace, "writing-policy.md", policy);
      await settings.write(workspace, "evidence-mode.json", "");
      expect(await settings.read(workspace, "writing-policy.md")).toBe(policy);
      expect(await settings.read(workspace, "evidence-mode.json")).toBe("");
    },
  },
  {
    name: "workspace settings: write replaces the whole document",
    check: async ({ settings, workspaces: [workspace] }) => {
      await settings.write(workspace, "workspace.json", '{"first":true,"padding":"xxxxxxxx"}\n');
      await settings.write(workspace, "workspace.json", '{"second":true}\n');
      expect(await settings.read(workspace, "workspace.json")).toBe('{"second":true}\n');
    },
  },
  {
    name: "workspace settings: remove deletes the document once",
    check: async ({ settings, workspaces: [workspace] }) => {
      await settings.write(workspace, "model-profile-selection.json", "{}\n");
      await settings.write(workspace, "retrieval-mode.json", "{}\n");
      expect(await settings.remove(workspace, "model-profile-selection.json")).toBe(true);
      expect(await settings.read(workspace, "model-profile-selection.json")).toBeUndefined();
      expect(await settings.remove(workspace, "model-profile-selection.json")).toBe(false);
      expect(await settings.read(workspace, "retrieval-mode.json")).toBe("{}\n");
    },
  },
  {
    name: "workspace settings: workspaces and names are kept apart",
    check: async ({ settings, workspaces: [first, second] }) => {
      await settings.write(first, "sensitive-knowledge-consent.json", "first\n");
      await settings.write(second, "sensitive-knowledge-consent.json", "second\n");
      await settings.write(first, "legacy-evidence-migration.json", "other\n");
      expect(await settings.read(first, "sensitive-knowledge-consent.json")).toBe("first\n");
      expect(await settings.read(second, "sensitive-knowledge-consent.json")).toBe("second\n");
      expect(await settings.read(second, "legacy-evidence-migration.json")).toBeUndefined();
      await settings.remove(first, "sensitive-knowledge-consent.json");
      expect(await settings.read(second, "sensitive-knowledge-consent.json")).toBe("second\n");
    },
  },
];

/** Runs every workspace settings contract against a fresh, empty store each. */
export function describeWorkspaceSettingsConformance(
  implementation: string,
  open: WorkspaceSettingsFactory,
): void {
  describe(`${implementation} storage conformance: workspace settings`, () => {
    for (const contract of workspaceSettingsContracts) {
      it(contract.name, async () => {
        const { storage, close } = await open();
        try {
          await contract.check(storage);
        } finally {
          await close();
        }
      });
    }
  });
}
