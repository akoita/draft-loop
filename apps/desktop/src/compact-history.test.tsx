import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createCapabilityPort, type NativeBridge, validateBridgeCommand } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import {
  CompactHistoryAction,
  CompactHistoryConfirmation,
  compactHistoryResultText,
  formatHistorySize,
} from "./compact-history.js";

const result = {
  workspaceId: "workspace-1",
  beforeBytes: 1_800_000_000,
  afterBytes: 220_000_000,
  backupFileName: "history.sqlite.pre-compaction-20261016T083000Z",
  runsVerified: 12,
};

function portReturning(value: unknown) {
  const bridge: NativeBridge = {
    capabilities: [...bridgeCapabilities],
    invoke: async () => ({ ok: true, value }) as never,
  };
  return createCapabilityPort(bridge);
}

const command = {
  type: "workspace.compact-history",
  input: { workspaceId: "workspace-1" },
} as const;

describe("workspace.compact-history bridge command", () => {
  it("is advertised and accepts only the workspace id", () => {
    expect(bridgeCapabilities).toContain("workspace.compact-history");
    expect(validateBridgeCommand(command)).toEqual(command);
    for (const input of [{}, { workspaceId: "../w" }, { workspaceId: "w", root: "/tmp/w" }]) {
      expect(() => validateBridgeCommand({ type: "workspace.compact-history", input })).toThrow();
    }
  });

  it("returns the sizes and the backup name through the real port", async () => {
    await expect(portReturning(result).execute(command)).resolves.toEqual({
      ok: true,
      value: result,
    });
  });

  it("rejects a result with a path, a negative size or an unknown field", async () => {
    for (const bad of [
      { ...result, backupFileName: "/home/someone/.draft-loop/history.sqlite.pre-compaction-x" },
      { ...result, backupFileName: "history.sqlite" },
      { ...result, afterBytes: -1 },
      { ...result, backupPath: "/tmp/backup" },
    ]) {
      await expect(portReturning(bad).execute(command)).resolves.toMatchObject({ ok: false });
    }
  });
});

describe("Compact run history", () => {
  it("formats sizes for a person", () => {
    expect(formatHistorySize(1_800_000_000)).toBe("1.7 GB");
    expect(formatHistorySize(220_000_000)).toBe("209.8 MB");
    expect(compactHistoryResultText(result)).toContain("1.7 GB before, 209.8 MB after");
    expect(compactHistoryResultText(result)).toContain(result.backupFileName);
  });

  it("asks first, stating that a backup is kept and what compacting does", () => {
    const html = renderToStaticMarkup(
      <CompactHistoryConfirmation
        working={false}
        errorMessage={null}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain("A full backup of the current history is kept");
    expect(html).toContain("rewrites the run history");
    expect(html).toContain("Cancel");
  });

  it("shows why it stopped, and disables both buttons while working", () => {
    const html = renderToStaticMarkup(
      <CompactHistoryConfirmation
        working
        errorMessage="A run is still working."
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />,
    );
    expect(html).toContain("A run is still working.");
    expect(html).toContain("Compacting…");
    expect(html.match(/disabled=""/gu)).toHaveLength(2);
  });

  it("offers the action as a button and no dialog until it is pressed", () => {
    const html = renderToStaticMarkup(
      <CompactHistoryAction
        workspaceId="workspace-1"
        compactHistory={async () => result}
        disabled
        disabledReason="A run is working."
      />,
    );
    expect(html).toContain("Compact run history");
    expect(html).toContain('title="A run is working."');
    expect(html).not.toContain('role="dialog"');
  });
});
