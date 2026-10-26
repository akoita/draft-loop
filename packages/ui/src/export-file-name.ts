import { type ExportFormat, exportFormatExtensions } from "./model.js";

/** What names a hosted export's file: when it was made, its id, its format and its application. */
export interface NamedExport {
  readonly id: string;
  readonly createdAt: string;
  readonly format: string;
  /** The application the run belongs to; the id names the file when it has none. */
  readonly applicationName?: string | null;
}

const longestStem = 60;

/**
 * The file name a hosted export downloads under (ADR 0011, D9), such as
 * `Company-Role-CV-2026-10-26.pdf`. The API's download and the review state that labels it share
 * this name, so the screen names the file the browser saved.
 */
export function exportFileName(exported: NamedExport): string {
  const day = exported.createdAt.slice(0, 10);
  const extension = exportFormatExtensions[exported.format as ExportFormat] ?? "bin";
  const stem = fileStem(exported.applicationName ?? null);
  return stem === null ? `cv-${day}-${exported.id}.${extension}` : `${stem}-CV-${day}.${extension}`;
}

/** The name in ASCII letters and digits joined by dashes, cut at a word, or `null` when none is left. */
function fileStem(name: string | null): string | null {
  if (name === null) return null;
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word !== "");
  let stem = "";
  for (const word of words) {
    const next = stem === "" ? word : `${stem}-${word}`;
    if (next.length > longestStem) break;
    stem = next;
  }
  return stem === "" ? null : stem;
}
