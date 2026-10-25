import { type ExportFormat, exportFormatExtensions } from "./model.js";

/** What names a hosted export's file: when it was made, its id and its format. */
export interface NamedExport {
  readonly id: string;
  readonly createdAt: string;
  readonly format: string;
}

/**
 * The file name a hosted export downloads under (ADR 0011, D9). The API's download and the review
 * state that labels it share this name, so the screen names the file the browser saved.
 */
export function exportFileName(exported: NamedExport): string {
  const day = exported.createdAt.slice(0, 10);
  const extension = exportFormatExtensions[exported.format as ExportFormat] ?? "bin";
  return `cv-${day}-${exported.id}.${extension}`;
}
