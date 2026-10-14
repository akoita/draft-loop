import type { CandidateKnowledgePortableBackupManifest } from "@draft-loop/schemas";

import { StorageValidationError } from "./storage-errors.js";

/**
 * Absorbs backward wall-clock corrections (WSL2 or NTP steps) and modest machine-to-machine
 * skew, while still rejecting clearly future-dated backups.
 */
export const portableBackupClockSkewToleranceMs = 5 * 60_000;

function isBeyondClockSkewTolerance(timestamp: string): boolean {
  return Date.parse(timestamp) > Date.now() + portableBackupClockSkewToleranceMs;
}

export function portableBackupTimestamp(value: string | undefined): string {
  const candidate = value ?? new Date().toISOString();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(candidate) ||
    Number.isNaN(Date.parse(candidate)) ||
    isBeyondClockSkewTolerance(candidate)
  ) {
    throw new StorageValidationError(
      "Portable candidate knowledge backup timestamp is invalid or in the future.",
    );
  }
  return candidate;
}

export function validatePortableBackupManifestTimestamps(
  manifest: CandidateKnowledgePortableBackupManifest,
  failure: () => Error,
): void {
  const timestamps = [manifest.createdAt, manifest.descriptor.createdAt];
  for (const entry of manifest.knowledgeBases) {
    timestamps.push(
      entry.knowledgeBase.createdAt,
      entry.knowledgeBase.updatedAt,
      ...(entry.knowledgeBase.archivedAt === null ? [] : [entry.knowledgeBase.archivedAt]),
      entry.retentionPolicy.updatedAt,
    );
    for (const override of entry.retentionPolicy.activeOverrides) {
      timestamps.push(override.changedAt);
    }
    for (const source of entry.sources) {
      timestamps.push(source.createdAt);
      if (source.refreshObservation !== null) {
        timestamps.push(source.refreshObservation.checkedAt);
        if (source.refreshObservation.lastRefreshedAt !== null) {
          timestamps.push(source.refreshObservation.lastRefreshedAt);
        }
      }
      if (source.retirement !== null) timestamps.push(source.retirement.retiredAt);
      for (const version of source.versions) {
        timestamps.push(version.createdAt);
        if (version.urlProvenance !== undefined) {
          timestamps.push(version.urlProvenance.fetchedAt);
        }
      }
    }
  }
  if (timestamps.some(isBeyondClockSkewTolerance)) throw failure();
}
