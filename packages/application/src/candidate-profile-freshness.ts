import type { CandidateKnowledgeSelectionSnapshot } from "@draft-loop/domain";
import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";

import { sourceRevisionSignature } from "./candidate-profile-incremental.js";
import { createKnowledgeSelectionSnapshot } from "./knowledge-base.js";
import { selectionSnapshotsMatch } from "./knowledge-selection-match.js";

/**
 * Whether the candidate's career profile is current with their career evidence (ADR 0010).
 *
 * - `not-generated`: no version of the profile exists.
 * - `review-pending`: the newest version is a draft; `reviewedVersion` is the last reviewed one.
 * - `up-to-date`: the newest version is reviewed and was derived from the evidence as it is now.
 * - `update-available`: sources were added, replaced by a new version, or retired since then.
 * - `unavailable`: the comparison cannot be made, because the version records no selection or the
 *   configured knowledge selection cannot be read.
 */
export type CandidateProfileFreshness =
  | { readonly state: "not-generated" }
  | { readonly state: "up-to-date"; readonly version: number }
  | {
      readonly state: "update-available";
      readonly version: number;
      readonly newSourceCount: number;
      readonly changedSourceCount: number;
      readonly removedSourceCount: number;
    }
  | {
      readonly state: "review-pending";
      readonly version: number;
      readonly reviewedVersion?: number;
    }
  | { readonly state: "unavailable"; readonly version: number };

export interface CandidateProfileSourceChanges {
  readonly newSourceCount: number;
  readonly changedSourceCount: number;
  readonly removedSourceCount: number;
}

/** A source is the same logical source across versions: store, knowledge base and source id. */
function sourceSignatures(snapshot: CandidateKnowledgeSelectionSnapshot): Map<string, string> {
  const signatures = new Map<string, string>();
  for (const entry of snapshot.entries) {
    for (const source of entry.sources) {
      signatures.set(
        JSON.stringify([entry.storeId, entry.knowledgeBaseId, source.sourceId]),
        JSON.stringify([source.versionId, sourceRevisionSignature(source)]),
      );
    }
  }
  return signatures;
}

/** Counts the sources added, replaced by a newer version, and retired between two selections. */
export function countCandidateProfileSourceChanges(
  profileSelection: CandidateKnowledgeSelectionSnapshot,
  current: CandidateKnowledgeSelectionSnapshot,
): CandidateProfileSourceChanges {
  const before = sourceSignatures(profileSelection);
  const after = sourceSignatures(current);
  let newSourceCount = 0;
  let changedSourceCount = 0;
  for (const [key, signature] of after) {
    const previous = before.get(key);
    if (previous === undefined) newSourceCount += 1;
    else if (previous !== signature) changedSourceCount += 1;
  }
  let removedSourceCount = 0;
  for (const key of before.keys()) if (!after.has(key)) removedSourceCount += 1;
  return { newSourceCount, changedSourceCount, removedSourceCount };
}

export interface ComputeCandidateProfileFreshnessInput {
  /** Every saved version of the profile. */
  readonly versions: readonly CanonicalCandidateProfileVersionRecord[];
  /** The selection as it is now; `undefined` when it cannot be read. */
  readonly current: CandidateKnowledgeSelectionSnapshot | undefined;
}

/** Pure decision over the saved versions and the current knowledge selection snapshot. */
export function computeCandidateProfileFreshness(
  input: ComputeCandidateProfileFreshnessInput,
): CandidateProfileFreshness {
  const newest = input.versions.reduce<CanonicalCandidateProfileVersionRecord | undefined>(
    (latest, record) =>
      latest === undefined || record.profile.version > latest.profile.version ? record : latest,
    undefined,
  );
  if (newest === undefined) return { state: "not-generated" };
  const version = newest.profile.version;

  if (newest.profile.status !== "reviewed") {
    const reviewedVersion = input.versions
      .filter((record) => record.profile.status === "reviewed")
      .reduce<number | undefined>(
        (latest, record) =>
          latest === undefined || record.profile.version > latest ? record.profile.version : latest,
        undefined,
      );
    return {
      state: "review-pending",
      version,
      ...(reviewedVersion === undefined ? {} : { reviewedVersion }),
    };
  }

  const selection = newest.profile.candidateKnowledgeSelection;
  if (selection === undefined || input.current === undefined) {
    return { state: "unavailable", version };
  }
  if (selectionSnapshotsMatch(selection, input.current)) return { state: "up-to-date", version };
  const changes = countCandidateProfileSourceChanges(selection, input.current);
  if (changes.newSourceCount + changes.changedSourceCount + changes.removedSourceCount === 0) {
    return { state: "up-to-date", version };
  }
  return { state: "update-available", version, ...changes };
}

/** The workspace's configured knowledge selection; the store roots stay inside the application. */
export interface CandidateProfileFreshnessSelection {
  readonly entries: readonly {
    readonly storeRoot: string;
    readonly knowledgeBaseId: string;
  }[];
  readonly combinationApproved?: true;
}

export interface CandidateProfileFreshnessCommand {
  readonly root: string;
  readonly profileId: string;
}

export interface CandidateProfileFreshnessDependencies {
  readonly listVersions: (
    command: CandidateProfileFreshnessCommand,
  ) => Promise<readonly CanonicalCandidateProfileVersionRecord[]>;
  readonly readSelection: (root: string) => Promise<CandidateProfileFreshnessSelection | undefined>;
}

/** Reads the saved versions and the current selection, then decides. Never reads source text. */
export async function readCandidateProfileFreshness(
  command: CandidateProfileFreshnessCommand,
  dependencies: CandidateProfileFreshnessDependencies,
): Promise<CandidateProfileFreshness> {
  const versions = await dependencies.listVersions(command);
  if (versions.length === 0) return { state: "not-generated" };
  let current: CandidateKnowledgeSelectionSnapshot | undefined;
  try {
    const binding = await dependencies.readSelection(command.root);
    if (binding !== undefined && binding.entries.length > 0) {
      current = await createKnowledgeSelectionSnapshot({
        selections: binding.entries.map(({ storeRoot, knowledgeBaseId }) => ({
          storeRoot,
          knowledgeBaseId,
        })),
        ...(binding.entries.length > 1 && binding.combinationApproved === true
          ? { combinationApproved: true }
          : {}),
      });
    }
  } catch {
    current = undefined;
  }
  return computeCandidateProfileFreshness({ versions, current });
}

interface FreshnessDriver {
  readonly listCanonicalCandidateProfileVersions: (command: {
    readonly root: string;
    readonly profileId?: string;
  }) => Promise<readonly CanonicalCandidateProfileVersionRecord[]>;
}

/** Adds `getCandidateProfileFreshness` to a driver that can list profile versions. */
export function withCandidateProfileFreshness<Driver extends FreshnessDriver>(
  driver: Driver,
  dependencies: {
    readonly readWorkspace: (
      root: string,
    ) => Promise<{ readonly candidateKnowledgeSelection?: CandidateProfileFreshnessSelection }>;
  },
): Driver & {
  readonly getCandidateProfileFreshness: (
    command: CandidateProfileFreshnessCommand,
  ) => Promise<CandidateProfileFreshness>;
} {
  return {
    ...driver,
    getCandidateProfileFreshness: async (command) =>
      readCandidateProfileFreshness(command, {
        listVersions: (listing) => driver.listCanonicalCandidateProfileVersions(listing),
        readSelection: async (root) =>
          (await dependencies.readWorkspace(root)).candidateKnowledgeSelection,
      }),
  };
}
