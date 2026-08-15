import type { BrowserWindow, SaveDialogOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import { chooseMarkdownExportPath, type ExportDialog } from "./dialogs.js";

interface WindowDouble {
  readonly isDestroyed: ReturnType<typeof vi.fn<() => boolean>>;
  readonly isMinimized: ReturnType<typeof vi.fn<() => boolean>>;
  readonly restore: ReturnType<typeof vi.fn<() => void>>;
  readonly show: ReturnType<typeof vi.fn<() => void>>;
  readonly focus: ReturnType<typeof vi.fn<() => void>>;
}

function windowDouble(overrides: Partial<WindowDouble> = {}): WindowDouble & BrowserWindow {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    ...overrides,
  } as unknown as WindowDouble & BrowserWindow;
}

function dialogDouble(result: {
  readonly canceled: boolean;
  readonly filePath: string;
}): ExportDialog & { readonly showSaveDialog: ReturnType<typeof vi.fn> } {
  return {
    showSaveDialog: vi.fn(async (_parent: BrowserWindow, _options: SaveDialogOptions) => result),
  };
}

describe("Markdown export dialog", () => {
  it("uses the supplied live BrowserWindow as the dialog parent", async () => {
    const parent = windowDouble();
    const exportDialog = dialogDouble({ canceled: false, filePath: "/tmp/export.md" });

    await chooseMarkdownExportPath(parent, "/tmp/default.md", exportDialog);

    expect(exportDialog.showSaveDialog).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({ defaultPath: "/tmp/default.md" }),
    );
  });

  it("restores a minimized window before showing and focusing it", async () => {
    const parent = windowDouble({ isMinimized: vi.fn(() => true) });
    const exportDialog = dialogDouble({ canceled: false, filePath: "/tmp/export.md" });

    await chooseMarkdownExportPath(parent, "/tmp/default.md", exportDialog);

    expect(parent.restore).toHaveBeenCalledOnce();
    expect(parent.show).toHaveBeenCalledOnce();
    expect(parent.focus).toHaveBeenCalledOnce();
  });

  it("returns the selected Markdown path and preserves the Save As options", async () => {
    const parent = windowDouble();
    const exportDialog = dialogDouble({ canceled: false, filePath: "/tmp/selected.md" });

    await expect(chooseMarkdownExportPath(parent, "/tmp/default.md", exportDialog)).resolves.toBe(
      "/tmp/selected.md",
    );
    expect(exportDialog.showSaveDialog).toHaveBeenCalledWith(parent, {
      defaultPath: "/tmp/default.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
      title: "Export approved Markdown",
    });
  });

  it("returns undefined when the Save As dialog is cancelled", async () => {
    const parent = windowDouble();
    const exportDialog = dialogDouble({ canceled: true, filePath: "" });

    await expect(
      chooseMarkdownExportPath(parent, "/tmp/default.md", exportDialog),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["missing", undefined],
    ["destroyed", windowDouble({ isDestroyed: vi.fn(() => true) })],
  ] as const)("rejects when the parent window is %s", async (_state, parent) => {
    const exportDialog = dialogDouble({ canceled: false, filePath: "/tmp/export.md" });

    await expect(chooseMarkdownExportPath(parent, "/tmp/default.md", exportDialog)).rejects.toThrow(
      "Markdown export requires a live parent window.",
    );
    expect(exportDialog.showSaveDialog).not.toHaveBeenCalled();
  });
});
