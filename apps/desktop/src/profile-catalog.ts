import { maximumCanonicalCandidateProfileIdLength } from "@draft-loop/domain";

export interface ReviewedCanonicalCandidateProfileSummary {
  readonly profileId: string;
  readonly version: number;
  readonly reviewedAt: string;
}

/** One saved profile (draft or reviewed), summarized at its latest version. */
export interface SavedCanonicalCandidateProfileSummary {
  readonly profileId: string;
  readonly latestVersion: number;
  readonly status: "draft" | "reviewed";
  readonly updatedAt: string;
  /** The latest reviewed version, when any version was reviewed. */
  readonly reviewedVersion?: number;
}

export interface ReviewedCanonicalCandidateProfileCatalogInput {
  readonly workspaceId: string;
  /** Also return a summary of every saved profile, newest first. */
  readonly includeDrafts?: true;
}

export interface ReviewedCanonicalCandidateProfileCatalogResult {
  readonly workspaceId: string;
  readonly profiles: readonly ReviewedCanonicalCandidateProfileSummary[];
  /** Present only when the input asked for `includeDrafts`. */
  readonly summaries?: readonly SavedCanonicalCandidateProfileSummary[];
}

export function reviewedCanonicalCandidateProfileChoice(
  profile: ReviewedCanonicalCandidateProfileSummary,
): string {
  return `${profile.profileId}@${profile.version}`;
}

/** Resolve a picker value only against the currently validated catalog. */
export function findReviewedCanonicalCandidateProfileChoice(
  choice: string,
  profiles: readonly ReviewedCanonicalCandidateProfileSummary[],
): ReviewedCanonicalCandidateProfileSummary | undefined {
  return profiles.find((profile) => reviewedCanonicalCandidateProfileChoice(profile) === choice);
}

export class ProfileCatalogValidationError extends Error {
  readonly code = "invalid-input" as const;

  constructor() {
    super("The reviewed profile catalog payload is invalid.");
    this.name = "ProfileCatalogValidationError";
  }
}

const maximumCatalogEntries = 256;
const profileIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

function invalid(): never {
  throw new ProfileCatalogValidationError();
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const parsed = object(value);
  if (parsed === undefined || Object.keys(parsed).some((key) => !keys.includes(key))) {
    return invalid();
  }
  return parsed;
}

function workspaceIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value.trim() !== value ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
    })
  ) {
    return invalid();
  }
  return value;
}

function profileIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumCanonicalCandidateProfileIdLength ||
    !profileIdentifierPattern.test(value)
  ) {
    return invalid();
  }
  return value;
}

function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return invalid();
  }
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 64 ||
    Number.isNaN(Date.parse(value))
  ) {
    return invalid();
  }
  return value;
}

export function parseReviewedCanonicalCandidateProfileCatalogInput(
  value: unknown,
): ReviewedCanonicalCandidateProfileCatalogInput {
  const input = exactObject(value, ["workspaceId", "includeDrafts"]);
  const workspaceId = workspaceIdentifier(input.workspaceId);
  if (!("includeDrafts" in input)) return { workspaceId };
  if (input.includeDrafts !== true) return invalid();
  return { workspaceId, includeDrafts: true };
}

function parseSavedProfileSummaries(
  value: unknown,
): readonly SavedCanonicalCandidateProfileSummary[] {
  if (!Array.isArray(value) || value.length > maximumCatalogEntries) return invalid();
  const seen = new Set<string>();
  let previous: { readonly updatedAt: number; readonly profileId: string } | undefined;
  return value.map((entry) => {
    const summary = exactObject(entry, [
      "profileId",
      "latestVersion",
      "status",
      "updatedAt",
      "reviewedVersion",
    ]);
    const profileId = profileIdentifier(summary.profileId);
    const latestVersion = version(summary.latestVersion);
    if (summary.status !== "draft" && summary.status !== "reviewed") return invalid();
    const updatedAt = timestamp(summary.updatedAt);
    const reviewedVersion =
      "reviewedVersion" in summary ? version(summary.reviewedVersion) : undefined;
    if (
      seen.has(profileId) ||
      (reviewedVersion !== undefined && reviewedVersion > latestVersion) ||
      (summary.status === "reviewed" && reviewedVersion !== latestVersion)
    ) {
      return invalid();
    }
    seen.add(profileId);
    const time = Date.parse(updatedAt);
    if (
      previous !== undefined &&
      (time > previous.updatedAt ||
        (time === previous.updatedAt && profileId <= previous.profileId))
    ) {
      return invalid();
    }
    previous = { updatedAt: time, profileId };
    return {
      profileId,
      latestVersion,
      status: summary.status,
      updatedAt,
      ...(reviewedVersion === undefined ? {} : { reviewedVersion }),
    };
  });
}

/** Label for the saved-profile picker. */
export function savedCanonicalCandidateProfileLabel(
  summary: SavedCanonicalCandidateProfileSummary,
): string {
  return `${summary.profileId} · v${summary.latestVersion} · ${summary.status}`;
}

/**
 * The profile to open automatically: the most recent saved one, only when nothing is typed or
 * loaded yet. Summaries arrive newest first.
 */
export function defaultProfileToAutoload(
  summaries: readonly SavedCanonicalCandidateProfileSummary[],
  currentName: string,
  loadedProfileId: string | null | undefined,
): SavedCanonicalCandidateProfileSummary | undefined {
  if (currentName.trim() !== "" || (loadedProfileId !== null && loadedProfileId !== undefined))
    return undefined;
  return summaries[0];
}

export function parseReviewedCanonicalCandidateProfileCatalogResult(
  value: unknown,
  expectedWorkspaceId?: string,
): ReviewedCanonicalCandidateProfileCatalogResult {
  const result = exactObject(value, ["workspaceId", "profiles", "summaries"]);
  const workspaceId = workspaceIdentifier(result.workspaceId);
  if (expectedWorkspaceId !== undefined && workspaceId !== expectedWorkspaceId) return invalid();
  if (!Array.isArray(result.profiles) || result.profiles.length > maximumCatalogEntries) {
    return invalid();
  }

  const seen = new Set<string>();
  let previousId: string | undefined;
  const profiles = result.profiles.map((value) => {
    const profile = exactObject(value, ["profileId", "version", "reviewedAt"]);
    const profileId = profileIdentifier(profile.profileId);
    const profileVersion = version(profile.version);
    const reviewedAt = timestamp(profile.reviewedAt);
    if (seen.has(profileId) || (previousId !== undefined && profileId <= previousId)) {
      return invalid();
    }
    seen.add(profileId);
    previousId = profileId;
    return { profileId, version: profileVersion, reviewedAt };
  });

  return "summaries" in result
    ? { workspaceId, profiles, summaries: parseSavedProfileSummaries(result.summaries) }
    : { workspaceId, profiles };
}
