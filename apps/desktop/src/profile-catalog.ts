import { maximumCanonicalCandidateProfileIdLength } from "@draft-loop/domain";

export interface ReviewedCanonicalCandidateProfileSummary {
  readonly profileId: string;
  readonly version: number;
  readonly reviewedAt: string;
}

export interface ReviewedCanonicalCandidateProfileCatalogInput {
  readonly workspaceId: string;
}

export interface ReviewedCanonicalCandidateProfileCatalogResult {
  readonly workspaceId: string;
  readonly profiles: readonly ReviewedCanonicalCandidateProfileSummary[];
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
  const input = exactObject(value, ["workspaceId"]);
  return { workspaceId: workspaceIdentifier(input.workspaceId) };
}

export function parseReviewedCanonicalCandidateProfileCatalogResult(
  value: unknown,
  expectedWorkspaceId?: string,
): ReviewedCanonicalCandidateProfileCatalogResult {
  const result = exactObject(value, ["workspaceId", "profiles"]);
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

  return { workspaceId, profiles };
}
