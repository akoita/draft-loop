import type { BrowserWindow, SaveDialogOptions, SaveDialogReturnValue } from "electron";

import type { ExportFormat } from "../model.js";

export interface ExportDialog {
  showSaveDialog(parent: BrowserWindow, options: SaveDialogOptions): Promise<SaveDialogReturnValue>;
}

const exportDialogDetails: Readonly<
  Record<
    ExportFormat,
    { readonly filter: string; readonly extension: string; readonly title: string }
  >
> = {
  markdown: { filter: "Markdown", extension: "md", title: "Export approved Markdown" },
  docx: { filter: "Word document", extension: "docx", title: "Export approved DOCX" },
  pdf: { filter: "PDF document", extension: "pdf", title: "Export approved PDF" },
};

/** Asks where to save the approved export in the chosen format; cancelling returns undefined. */
export async function chooseExportPath(
  parent: BrowserWindow | undefined,
  defaultPath: string,
  exportDialog: ExportDialog,
  format: ExportFormat = "markdown",
): Promise<string | undefined> {
  if (parent === undefined || parent.isDestroyed()) {
    throw new Error("Export requires a live parent window.");
  }

  if (parent.isMinimized()) parent.restore();
  parent.show();
  parent.focus();

  const details = exportDialogDetails[format];
  const result = await exportDialog.showSaveDialog(parent, {
    defaultPath,
    filters: [{ name: details.filter, extensions: [details.extension] }],
    title: details.title,
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
