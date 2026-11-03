import { basename, join } from "node:path";

/** The part of Electron's `DownloadItem` the client uses. */
export interface SaveableDownload {
  getFilename(): string;
  setSaveDialogOptions(options: { title: string; defaultPath: string; buttonLabel: string }): void;
}

/**
 * The web saves an export through a download link (`apps/web/src/save-file.ts`). The client
 * leaves the save path unset, so Electron asks where to save it with the system Save dialog,
 * starting in the Downloads folder with the export's own name.
 */
export function askWhereToSave(item: SaveableDownload, downloadsDirectory: string): void {
  const name = basename(item.getFilename()) || "draftloop-export";
  item.setSaveDialogOptions({
    title: "Save export",
    defaultPath: join(downloadsDirectory, name),
    buttonLabel: "Save",
  });
}
