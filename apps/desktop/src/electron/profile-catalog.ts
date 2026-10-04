import type { CanonicalCandidateProfileRecordResult } from "../bridge.js";
import {
  ProfileCatalogValidationError,
  parseReviewedCanonicalCandidateProfileCatalogResult,
  type ReviewedCanonicalCandidateProfileCatalogResult,
  type SavedCanonicalCandidateProfileSummary,
} from "../profile-catalog.js";

const maximumProfileHistoryVersions = 256;

export function projectReviewedCanonicalCandidateProfileCatalog(
  workspaceId: string,
  records: unknown,
  projectRecord: (record: unknown) => CanonicalCandidateProfileRecordResult,
  options: { readonly includeDrafts?: boolean } = {},
): ReviewedCanonicalCandidateProfileCatalogResult {
  try {
    if (!Array.isArray(records)) throw new ProfileCatalogValidationError();

    const histories = new Map<string, CanonicalCandidateProfileRecordResult[]>();
    for (const value of records) {
      const record = projectRecord(value);
      if (record.workspaceId !== workspaceId) throw new ProfileCatalogValidationError();
      const history = histories.get(record.profileId);
      if (history === undefined) histories.set(record.profileId, [record]);
      else history.push(record);
      if (histories.size > maximumProfileHistoryVersions) {
        throw new ProfileCatalogValidationError();
      }
    }

    const summaries: SavedCanonicalCandidateProfileSummary[] = [];
    const profiles: ReviewedCanonicalCandidateProfileCatalogResult["profiles"][number][] = [];
    for (const [profileId, history] of histories) {
      if (history.length > maximumProfileHistoryVersions) {
        throw new ProfileCatalogValidationError();
      }
      history.sort((left, right) => left.version - right.version);
      let latestEligible: (typeof history)[number] | undefined;
      let reviewedVersion: number | undefined;
      history.forEach((record, index) => {
        const expectedVersion = index + 1;
        if (
          record.profileId !== profileId ||
          record.version !== expectedVersion ||
          record.parentVersion !== (expectedVersion === 1 ? null : expectedVersion - 1)
        ) {
          throw new ProfileCatalogValidationError();
        }
        if (record.status === "reviewed" && record.reviewedAt !== null) {
          reviewedVersion = record.version;
        }
        if (
          record.status === "reviewed" &&
          record.reviewedAt !== null &&
          record.facts.length > 0 &&
          record.issues.every((issue) => issue.status !== "open")
        ) {
          latestEligible = record;
        }
      });

      const latest = history[history.length - 1];
      if (latest !== undefined) {
        summaries.push({
          profileId,
          latestVersion: latest.version,
          status: latest.status,
          updatedAt: latest.updatedAt,
          ...(reviewedVersion === undefined ? {} : { reviewedVersion }),
        });
      }

      if (latestEligible !== undefined && latestEligible.reviewedAt !== null) {
        profiles.push({
          profileId,
          version: latestEligible.version,
          reviewedAt: latestEligible.reviewedAt,
        });
      }
    }

    profiles.sort((left, right) =>
      left.profileId < right.profileId ? -1 : left.profileId > right.profileId ? 1 : 0,
    );
    summaries.sort(
      (left, right) =>
        Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
        (left.profileId < right.profileId ? -1 : left.profileId > right.profileId ? 1 : 0),
    );
    return parseReviewedCanonicalCandidateProfileCatalogResult(
      options.includeDrafts === true
        ? { workspaceId, profiles, summaries }
        : { workspaceId, profiles },
      workspaceId,
    );
  } catch {
    throw new ProfileCatalogValidationError();
  }
}
