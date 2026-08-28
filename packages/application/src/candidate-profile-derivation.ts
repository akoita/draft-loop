import { createHash } from "node:crypto";

import {
  type CandidateKnowledgeSelectionSnapshot,
  canonicalCandidateProfileFactCategories,
  maximumCanonicalCandidateProfileIdLength,
  maximumCanonicalCandidateProfileIssueCount,
  maximumCanonicalCandidateProfileIssueSourceReferenceCount,
} from "@draft-loop/domain";
import { ingestBytes as defaultIngestBytes, type IngestionResult } from "@draft-loop/ingestion";
import type {
  CanonicalCandidateProfileIssue,
  CanonicalCandidateProfileProvenanceReference,
} from "@draft-loop/schemas";
import type { CanonicalCandidateProfileVersionRecord } from "@draft-loop/storage";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore as defaultOpenCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";

import { buildCanonicalCandidateProfile } from "./candidate-profile.js";
import {
  type CanonicalCandidateProfileExtractionMaterial,
  type CanonicalCandidateProfileExtractionPort,
  maximumCanonicalCandidateProfileExtractionSourceCharacters,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";
import type { CanonicalCandidateProfilePersistenceService } from "./candidate-profile-persistence.js";
import {
  type CandidateKnowledgeStoreService,
  type CreateKnowledgeSelectionSnapshotSelection,
  createCandidateKnowledgeStoreService,
} from "./knowledge-base.js";

export const canonicalCandidateProfileDerivationApprovalErrorMessage =
  "Canonical candidate profile derivation requires explicit provider-data approval.";
export const canonicalCandidateProfileDerivationErrorMessage =
  "The canonical candidate profile could not be derived from the selected knowledge.";
export const canonicalCandidateProfileSelectionStaleErrorMessage =
  "The selected candidate knowledge changed during profile derivation.";

const safeIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

export interface DeriveCanonicalCandidateProfileCommand {
  readonly workspaceId: string;
  readonly profileId: string;
  readonly selections: readonly CreateKnowledgeSelectionSnapshotSelection[];
  readonly combinationApproved?: boolean;
  /** Visible approval boundary before candidate material may reach the configured provider. */
  readonly allowProviderData: boolean;
  readonly createdAt?: string;
  readonly signal?: AbortSignal;
}

export interface CanonicalCandidateProfileDerivationService {
  readonly deriveCanonicalCandidateProfile: (
    command: DeriveCanonicalCandidateProfileCommand,
  ) => Promise<CanonicalCandidateProfileVersionRecord>;
}

export interface CanonicalCandidateProfileDerivationDependencies {
  readonly persistence: Pick<
    CanonicalCandidateProfilePersistenceService,
    "getLatestCanonicalCandidateProfile" | "saveCanonicalCandidateProfile"
  >;
  readonly extractor: CanonicalCandidateProfileExtractionPort;
  readonly knowledgeService?: Pick<
    CandidateKnowledgeStoreService,
    "createKnowledgeSelectionSnapshot"
  >;
  readonly openKnowledgeStore?: (root: string) => Promise<CandidateKnowledgeStoreHandle>;
  readonly ingestBytes?: typeof defaultIngestBytes;
  readonly now?: () => string;
}

interface MaterializationResult {
  readonly materials: readonly CanonicalCandidateProfileExtractionMaterial[];
  readonly failedReferences: readonly CanonicalCandidateProfileProvenanceReference[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex");
}

function referenceKey(reference: CanonicalCandidateProfileProvenanceReference): string {
  return JSON.stringify([
    reference.storeId,
    reference.knowledgeBaseId,
    reference.sourceId,
    reference.versionId,
    reference.kind,
  ]);
}

function assertIdentity(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumCanonicalCandidateProfileIdLength ||
    !safeIdentifierPattern.test(value)
  ) {
    throw new Error(canonicalCandidateProfileDerivationErrorMessage);
  }
}

function requireTimestamp(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(canonicalCandidateProfileDerivationErrorMessage);
  }
  return value;
}

function selectionEntriesEqual(
  left: CandidateKnowledgeSelectionSnapshot,
  right: CandidateKnowledgeSelectionSnapshot,
): boolean {
  return JSON.stringify(left.entries) === JSON.stringify(right.entries);
}

function assertSnapshotIdentities(snapshot: CandidateKnowledgeSelectionSnapshot): void {
  for (const entry of snapshot.entries) {
    assertIdentity(entry.storeId);
    assertIdentity(entry.knowledgeBaseId);
    for (const source of entry.sources) {
      assertIdentity(source.sourceId);
      assertIdentity(source.versionId);
      assertIdentity(source.lifecycleRevision.versionId);
    }
  }
}

function sourceReference(
  storeId: string,
  knowledgeBaseId: string,
  sourceId: string,
  versionId: string,
): CanonicalCandidateProfileProvenanceReference {
  return {
    storeId,
    knowledgeBaseId,
    sourceId,
    versionId,
    kind: "candidate-provided",
  };
}

function materialSourceId(reference: CanonicalCandidateProfileProvenanceReference): string {
  return `profile-source-${digest([referenceKey(reference)]).slice(0, 32)}`;
}

function normalizedSource(
  result: IngestionResult,
  expectedChecksum: string,
  expectedSizeBytes: number,
): IngestionResult["source"] {
  const source = result.source;
  if (
    source === null ||
    result.issues.length > 0 ||
    source.issues.length > 0 ||
    source.checksum !== expectedChecksum ||
    source.sizeBytes !== expectedSizeBytes ||
    source.text.trim().length === 0 ||
    source.text.length > maximumCanonicalCandidateProfileExtractionSourceCharacters
  ) {
    return null;
  }
  return source;
}

async function closeQuietly(handle: CandidateKnowledgeStoreHandle | undefined): Promise<void> {
  if (handle === undefined) return;
  try {
    await handle.close();
  } catch {
    // The caller reports one fixed path-free derivation failure.
  }
}

async function materializeSelection(
  snapshot: CandidateKnowledgeSelectionSnapshot,
  selections: readonly CreateKnowledgeSelectionSnapshotSelection[],
  openKnowledgeStore: (root: string) => Promise<CandidateKnowledgeStoreHandle>,
  ingestBytes: typeof defaultIngestBytes,
): Promise<MaterializationResult> {
  const materials: CanonicalCandidateProfileExtractionMaterial[] = [];
  const failedReferences: CanonicalCandidateProfileProvenanceReference[] = [];
  const logicalSelections = new Set<string>();

  for (const selection of selections) {
    let handle: CandidateKnowledgeStoreHandle | undefined;
    try {
      handle = await openKnowledgeStore(selection.storeRoot);
      const storeId = handle.descriptor.id;
      const logicalKey = JSON.stringify([storeId, selection.knowledgeBaseId]);
      if (logicalSelections.has(logicalKey)) {
        throw new Error(canonicalCandidateProfileDerivationErrorMessage);
      }
      logicalSelections.add(logicalKey);
      const entry = snapshot.entries.find(
        (candidate) =>
          candidate.storeId === storeId && candidate.knowledgeBaseId === selection.knowledgeBaseId,
      );
      if (entry === undefined) throw new Error(canonicalCandidateProfileSelectionStaleErrorMessage);

      for (const selectedSource of entry.sources) {
        const reference = sourceReference(
          entry.storeId,
          entry.knowledgeBaseId,
          selectedSource.sourceId,
          selectedSource.versionId,
        );
        const content = await handle.readManagedCandidateKnowledgeSourceVersion(
          entry.knowledgeBaseId,
          selectedSource.sourceId,
          selectedSource.versionId,
        );
        if (
          content === undefined ||
          content.metadata.knowledgeBaseId !== entry.knowledgeBaseId ||
          content.metadata.sourceId !== selectedSource.sourceId ||
          content.metadata.id !== selectedSource.versionId ||
          content.metadata.id !== selectedSource.lifecycleRevision.versionId ||
          content.metadata.version !== selectedSource.lifecycleRevision.version ||
          content.metadata.createdAt !== selectedSource.lifecycleRevision.createdAt ||
          selectedSource.lifecycleRevision.managed !== true
        ) {
          throw new Error(canonicalCandidateProfileSelectionStaleErrorMessage);
        }

        const id = materialSourceId(reference);
        const ingested = await ingestBytes(
          { path: id, mediaType: content.metadata.mediaType },
          content.bytes,
          { maxSourceBytes: content.metadata.sizeBytes || 1 },
        );
        const source = normalizedSource(
          ingested,
          content.metadata.checksum,
          content.metadata.sizeBytes,
        );
        if (source === null) {
          failedReferences.push(reference);
          continue;
        }
        materials.push({
          id,
          mediaType: source.mediaType,
          checksum: source.checksum,
          text: source.text,
          reference,
        });
      }
    } finally {
      await closeQuietly(handle);
    }
  }
  if (logicalSelections.size !== snapshot.entries.length) {
    throw new Error(canonicalCandidateProfileSelectionStaleErrorMessage);
  }
  return { materials, failedReferences };
}

function materializationIssue(
  references: readonly CanonicalCandidateProfileProvenanceReference[],
): CanonicalCandidateProfileIssue {
  const uniqueReferences = [
    ...new Map(references.map((reference) => [referenceKey(reference), reference])).entries(),
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, reference]) => reference)
    .slice(0, maximumCanonicalCandidateProfileIssueSourceReferenceCount);
  return {
    id: `profile-issue-${digest([
      "source-normalization-failure",
      ...uniqueReferences.map(referenceKey),
    ]).slice(0, 32)}`,
    code: "omission",
    severity: "error",
    status: "open",
    message: "Selected candidate knowledge could not be normalized; candidate review is required.",
    factIds: [],
    sourceRefs: uniqueReferences,
  };
}

function operationId(profileId: string, snapshot: CandidateKnowledgeSelectionSnapshot): string {
  const references = snapshot.entries.flatMap((entry) =>
    entry.sources.map((source) =>
      referenceKey(
        sourceReference(entry.storeId, entry.knowledgeBaseId, source.sourceId, source.versionId),
      ),
    ),
  );
  return `profile-derivation-${digest([profileId, snapshot.capturedAt, ...references]).slice(0, 32)}`;
}

/** Create a provider-backed, exact-CKB derivation service without exposing managed paths. */
export function createCanonicalCandidateProfileDerivationService(
  dependencies: CanonicalCandidateProfileDerivationDependencies,
): CanonicalCandidateProfileDerivationService {
  const knowledgeService = dependencies.knowledgeService ?? createCandidateKnowledgeStoreService();
  const openKnowledgeStore = dependencies.openKnowledgeStore ?? defaultOpenCandidateKnowledgeStore;
  const ingestBytes = dependencies.ingestBytes ?? defaultIngestBytes;
  const now = dependencies.now ?? (() => new Date().toISOString());

  const deriveCanonicalCandidateProfile = async (
    command: DeriveCanonicalCandidateProfileCommand,
  ): Promise<CanonicalCandidateProfileVersionRecord> => {
    if (!isRecord(command) || command.allowProviderData !== true) {
      throw new Error(canonicalCandidateProfileDerivationApprovalErrorMessage);
    }
    try {
      assertIdentity(command.workspaceId);
      assertIdentity(command.profileId);
      if (!Array.isArray(command.selections) || command.selections.length === 0) {
        throw new Error(canonicalCandidateProfileDerivationErrorMessage);
      }
      const selections = command.selections.map((selection) => {
        if (
          !isRecord(selection) ||
          typeof selection.storeRoot !== "string" ||
          selection.storeRoot.length === 0 ||
          typeof selection.knowledgeBaseId !== "string"
        ) {
          throw new Error(canonicalCandidateProfileDerivationErrorMessage);
        }
        const knowledgeBaseId = selection.knowledgeBaseId.trim();
        assertIdentity(knowledgeBaseId);
        return { storeRoot: selection.storeRoot, knowledgeBaseId };
      });
      const createdAt = requireTimestamp(command.createdAt ?? now());
      const selectionCommand = {
        selections,
        ...(command.combinationApproved === undefined
          ? {}
          : { combinationApproved: command.combinationApproved }),
      };
      const snapshot = await knowledgeService.createKnowledgeSelectionSnapshot(selectionCommand);
      assertSnapshotIdentities(snapshot);
      const materialization = await materializeSelection(
        snapshot,
        selections,
        openKnowledgeStore,
        ingestBytes,
      );
      const refreshedSnapshot =
        await knowledgeService.createKnowledgeSelectionSnapshot(selectionCommand);
      if (!selectionEntriesEqual(snapshot, refreshedSnapshot)) {
        throw new Error(canonicalCandidateProfileSelectionStaleErrorMessage);
      }

      const extracted =
        materialization.materials.length === 0
          ? { facts: [], issues: [] }
          : await processCanonicalCandidateProfileExtraction(dependencies.extractor, {
              operationId: operationId(command.profileId, snapshot),
              sources: materialization.materials,
              allowProviderData: true,
              ...(command.signal === undefined ? {} : { signal: command.signal }),
            });
      const issues = [
        ...extracted.issues,
        ...(materialization.failedReferences.length === 0
          ? []
          : [materializationIssue(materialization.failedReferences)]),
      ];
      if (issues.length > maximumCanonicalCandidateProfileIssueCount) {
        throw new Error(canonicalCandidateProfileDerivationErrorMessage);
      }
      const finalSnapshot =
        await knowledgeService.createKnowledgeSelectionSnapshot(selectionCommand);
      if (!selectionEntriesEqual(snapshot, finalSnapshot)) {
        throw new Error(canonicalCandidateProfileSelectionStaleErrorMessage);
      }
      const latest = await dependencies.persistence.getLatestCanonicalCandidateProfile(
        command.workspaceId,
        command.profileId,
      );
      const profile = buildCanonicalCandidateProfile({
        id: command.profileId,
        version: latest === undefined ? 1 : latest.profile.version + 1,
        parentVersion: latest === undefined ? null : latest.profile.version,
        status: "draft",
        createdAt: latest?.profile.createdAt ?? createdAt,
        updatedAt: createdAt,
        candidateKnowledgeSelection: snapshot,
        facts: extracted.facts,
        issues,
      });
      return await dependencies.persistence.saveCanonicalCandidateProfile(
        command.workspaceId,
        profile,
      );
    } catch (error) {
      if (
        command.signal?.aborted === true ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw error;
      }
      if (
        error instanceof Error &&
        error.message === canonicalCandidateProfileSelectionStaleErrorMessage
      ) {
        throw error;
      }
      throw new Error(canonicalCandidateProfileDerivationErrorMessage);
    }
  };

  return Object.freeze({ deriveCanonicalCandidateProfile });
}

/** Categories used by the extraction prompt and deterministic omission checks. */
export const canonicalCandidateProfileExtractionCategories =
  canonicalCandidateProfileFactCategories;
