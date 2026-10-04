import type { KnowledgeSelectionSnapshot } from "./knowledge-base.js";

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJson((value as Record<string, unknown>)[key])]),
  );
}

/**
 * Compare two knowledge selection snapshots by content. A snapshot persisted with a profile or
 * run may come back with its object keys in canonical (sorted) order, so key order is ignored;
 * array order, values, and schema version must still match exactly.
 */
export function selectionSnapshotsMatch(
  historical: KnowledgeSelectionSnapshot,
  current: KnowledgeSelectionSnapshot,
): boolean {
  return (
    historical.schemaVersion === current.schemaVersion &&
    JSON.stringify(canonicalJson(historical.entries)) ===
      JSON.stringify(canonicalJson(current.entries))
  );
}
