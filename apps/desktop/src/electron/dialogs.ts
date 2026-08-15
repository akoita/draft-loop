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
