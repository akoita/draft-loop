import { createHash } from "node:crypto";

/**
 * The durable id of one export. Rendering is deterministic, so the same approved artifact
 * renders the same checksum on every export; the id also binds the export's time and
 * destination, so exporting again (for example after the earlier file was moved) appends a
 * new record instead of colliding with the immutable earlier one.
 */
export function exportRecordId(
  runId: string,
  outputChecksum: string,
  outputPath: string,
  createdAt: string,
): string {
  const attempt = createHash("sha256").update(`${createdAt}\n${outputPath}`, "utf8").digest("hex");
  return `export-${runId}-${outputChecksum.slice(0, 12)}-${attempt.slice(0, 12)}`;
}
