import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";

const maximumCatalogProfileNameCount = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Group workspace rows, then validate each full history through the existing persistence rule. */
export function normalizeCanonicalCandidateProfileCatalog(
  records: unknown,
  expectedWorkspaceId: string,
  normalizeHistory: (
    history: readonly CanonicalCandidateProfileVersionRecord[],
    profileId: string,
  ) => readonly CanonicalCandidateProfileVersionRecord[],
  invalid: () => never,
): readonly CanonicalCandidateProfileVersionRecord[] {
  if (!Array.isArray(records)) return invalid();

  const grouped = new Map<string, CanonicalCandidateProfileVersionRecord[]>();
  for (const value of records) {
    if (
      !isRecord(value) ||
      value.workspaceId !== expectedWorkspaceId ||
      !isRecord(value.profile) ||
      typeof value.profile.id !== "string" ||
      value.profile.id.length === 0 ||
      value.profile.id.trim() !== value.profile.id ||
      !Number.isSafeInteger(value.profile.version) ||
      (value.profile.version as number) < 1
    ) {
      return invalid();
    }
    const profileId = value.profile.id;
    const group = grouped.get(profileId);
    const record = value as unknown as CanonicalCandidateProfileVersionRecord;
    if (group === undefined) grouped.set(profileId, [record]);
    else group.push(record);
    if (grouped.size > maximumCatalogProfileNameCount) return invalid();
  }

  const result: CanonicalCandidateProfileVersionRecord[] = [];
  for (const profileId of [...grouped.keys()].sort()) {
    const history = grouped.get(profileId);
    if (history === undefined) return invalid();
    history.sort((left, right) => left.profile.version - right.profile.version);
    result.push(...normalizeHistory(history, profileId));
  }
  return Object.freeze(result);
}
