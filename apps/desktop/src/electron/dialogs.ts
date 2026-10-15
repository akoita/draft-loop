import type { BrowserWindow, SaveDialogOptions, SaveDialogReturnValue } from "electron";

export interface ExportDialog {
  showSaveDialog(parent: BrowserWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue>;
}

export async function chooseMarkdownExportPath(
  parent: BrowserWindow | undefined,
  defaultPath: string,
  exportDialog: ExportDialog,
): Promise<string | undefined> {
  if (parent === undefined || parent.isDestroyed()) {
    throw new Error("Markdown export requires a live parent window.");
  }

  if (parent.isMinimized()) parent.restore();
  parent.show();
  parent.focus();

  const result = await exportDialog.showSaveDialog(parent, {
    defaultPath,
    filters: [{ name: "Markdown", extensions: ["md"] }],
    title: "Export approved Markdown",
  });
  return result.canceled ? undefined : result.filePath;
}

/**
 * Asks where to save Markdown the renderer prepared, such as a run comparison. The dialog starts
 * on the suggested file name; cancelling returns undefined and nothing is written.
 */
export async function chooseMarkdownSavePath(
  parent: BrowserWindow | undefined,
  suggestedName: string,
  saveDialog: ExportDialog,
): Promise<string | undefined> {
  if (parent === undefined || parent.isDestroyed()) {
    throw new Error("Saving Markdown requires a live parent window.");
  }

  if (parent.isMinimized()) parent.restore();
  parent.show();
  parent.focus();

  const result = await saveDialog.showSaveDialog(parent, {
    defaultPath: suggestedName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
    title: "Save Markdown",
  });
  return result.canceled ? undefined : result.filePath;
}
