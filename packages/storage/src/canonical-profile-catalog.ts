export const maximumCanonicalCandidateProfileCatalogNameCount = 256;
export const canonicalCandidateProfileCatalogLimitErrorMessage =
  "The canonical candidate profile catalog exceeds the allowed size.";
const corruptCatalogErrorMessage = "The stored canonical candidate profile catalog is invalid.";

interface CatalogStatement {
  readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
}

interface CatalogDatabase {
  readonly prepare: (sql: string) => CatalogStatement;
}

function failCatalog(): never {
  throw new Error(corruptCatalogErrorMessage);
}

/** Enumerate bounded workspace names, then load each through the canonical history validator. */
export function listCanonicalCandidateProfileCatalog<Record>(
  database: CatalogDatabase,
  workspaceId: string,
  loadHistory: (profileId: string) => readonly Record[],
): readonly Record[] {
  const rows = database
    .prepare(
      "SELECT DISTINCT profile_id FROM canonical_candidate_profile_versions WHERE workspace_id = ? ORDER BY profile_id COLLATE BINARY LIMIT ?",
    )
    .all(workspaceId, maximumCanonicalCandidateProfileCatalogNameCount + 1);
  if (!Array.isArray(rows) || rows.length > maximumCanonicalCandidateProfileCatalogNameCount) {
    throw new Error(canonicalCandidateProfileCatalogLimitErrorMessage);
  }
  const profileIds = rows.map((row) => {
    if (
      !isRecord(row) ||
      typeof row.profile_id !== "string" ||
      row.profile_id.trim() !== row.profile_id ||
      row.profile_id.length === 0
    ) {
      return failCatalog();
    }
    return row.profile_id;
  });
  if (new Set(profileIds).size !== profileIds.length) return failCatalog();
  profileIds.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.freeze(profileIds.flatMap(loadHistory));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
