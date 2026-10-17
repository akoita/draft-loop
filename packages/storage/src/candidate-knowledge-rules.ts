import type { CandidateKnowledgeBaseState } from "@draft-loop/domain";
import {
  requireNonEmpty,
  requireNonNegativeInteger,
  rowNullableString,
  rowNumber,
  rowString,
} from "./history-record-rows.js";
import type {
  CandidateKnowledgeBaseInput,
  CandidateKnowledgeBaseRecord,
  CandidateKnowledgeSourceInput,
  CandidateKnowledgeSourceKind,
  CandidateKnowledgeSourceRecord,
  CandidateKnowledgeSourceVersionInput,
  CandidateKnowledgeSourceVersionRecord,
} from "./ports/candidate-knowledge.js";
import { StorageConflictError, StorageValidationError } from "./storage-errors.js";
import { requireTimestamp } from "./versioned-record-rules.js";

/**
 * The rules for candidate knowledge bases, sources and their immutable versions, shared by every
 * storage implementation: input normalization, row mapping, and how a new version is numbered.
 * Implementations differ only in their queries.
 */

export const candidateKnowledgeBaseColumns =
  "id, display_name, description, state, is_default, created_at, updated_at, archived_at";
export const candidateKnowledgeSourceColumns =
  "id, candidate_knowledge_base_id, kind, display_name, created_at";
export const candidateKnowledgeSourceVersionColumns =
  "id, source_id, version, parent_version_id, media_type, checksum, size_bytes, created_at";

/** Refuses writes into an archived knowledge base. */
export function requireActiveCandidateKnowledgeBaseRecord(
  knowledgeBase: CandidateKnowledgeBaseRecord,
): CandidateKnowledgeBaseRecord {
  if (knowledgeBase.state !== "active") {
    throw new StorageConflictError(`candidate knowledge base ${knowledgeBase.id} is archived`);
  }
  return knowledgeBase;
}

/** The first version of a new source, which must not predate the source itself. */
export function initialCandidateKnowledgeSourceVersion(
  source: CandidateKnowledgeSourceRecord,
  initialVersion: CandidateKnowledgeSourceVersionInput,
): CandidateKnowledgeSourceVersionRecord {
  if (Date.parse(initialVersion.createdAt) < Date.parse(source.createdAt)) {
    throw new StorageValidationError(
      "candidate knowledge source version createdAt must not precede its source createdAt",
    );
  }
  return { ...initialVersion, sourceId: source.id, version: 1, parentVersionId: null };
}

/**
 * The version an append produces after `current`: the same bytes return `current` unchanged
 * (`created: false`), anything else becomes the next number with `current` as its parent.
 */
export function nextCandidateKnowledgeSourceVersion(
  current: CandidateKnowledgeSourceVersionRecord,
  next: CandidateKnowledgeSourceVersionInput,
): { readonly version: CandidateKnowledgeSourceVersionRecord; readonly created: boolean } {
  if (Date.parse(next.createdAt) < Date.parse(current.createdAt)) {
    throw new StorageValidationError(
      "candidate knowledge source version createdAt must not precede the current version createdAt",
    );
  }
  if (current.checksum === next.checksum) {
    if (current.mediaType !== next.mediaType || current.sizeBytes !== next.sizeBytes) {
      throw new StorageConflictError(
        "candidate knowledge source version checksum conflicts with its integrity metadata",
      );
    }
    return { version: current, created: false };
  }
  return {
    version: {
      ...next,
      sourceId: current.sourceId,
      version: current.version + 1,
      parentVersionId: current.id,
    },
    created: true,
  };
}

export function normalizeCandidateKnowledgeBaseInput(
  input: CandidateKnowledgeBaseInput,
): CandidateKnowledgeBaseRecord {
  const id = requireNonEmpty(input.id, "candidate knowledge base id").trim();
  const displayName = requireNonEmpty(
    input.displayName,
    "candidate knowledge base displayName",
  ).trim();
  const createdAt = requireTimestamp(input.createdAt, "candidate knowledge base createdAt");
  if (input.description !== undefined && typeof input.description !== "string") {
    throw new StorageValidationError("candidate knowledge base description must be a string");
  }
  if (typeof input.isDefault !== "boolean") {
    throw new StorageValidationError("candidate knowledge base isDefault must be a boolean");
  }
  return {
    id,
    displayName,
    description: (input.description ?? "").trim(),
    state: "active",
    isDefault: input.isDefault,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  };
}

export function normalizeCandidateKnowledgeSourceInput(
  input: CandidateKnowledgeSourceInput,
): CandidateKnowledgeSourceRecord {
  const id = requireNonEmpty(input.id, "candidate knowledge source id").trim();
  const knowledgeBaseId = requireNonEmpty(
    input.knowledgeBaseId,
    "candidate knowledge source knowledgeBaseId",
  ).trim();
  if (input.kind !== "file" && input.kind !== "url") {
    throw new StorageValidationError(`Unsupported candidate knowledge source kind: ${input.kind}`);
  }
  const displayName = requireNonEmpty(
    input.displayName,
    "candidate knowledge source displayName",
  ).trim();
  const createdAt = requireTimestamp(input.createdAt, "candidate knowledge source createdAt");
  return { id, knowledgeBaseId, kind: input.kind, displayName, createdAt };
}

export function normalizeCandidateKnowledgeSourceVersionInput(
  input: CandidateKnowledgeSourceVersionInput,
): CandidateKnowledgeSourceVersionInput {
  const id = requireNonEmpty(input.id, "candidate knowledge source version id").trim();
  const mediaType = requireNonEmpty(
    input.mediaType,
    "candidate knowledge source version mediaType",
  ).trim();
  if (!/^[0-9a-f]{64}$/.test(input.checksum)) {
    throw new StorageValidationError(
      "candidate knowledge source version checksum must be a lowercase SHA-256 checksum",
    );
  }
  const sizeBytes = requireNonNegativeInteger(
    input.sizeBytes,
    "candidate knowledge source version sizeBytes",
  );
  const createdAt = requireTimestamp(
    input.createdAt,
    "candidate knowledge source version createdAt",
  );
  return { id, mediaType, checksum: input.checksum, sizeBytes, createdAt };
}

export function candidateKnowledgeBaseFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeBaseRecord {
  return {
    id: rowString(row, "id"),
    displayName: rowString(row, "display_name"),
    description: rowString(row, "description"),
    state: rowString(row, "state") as CandidateKnowledgeBaseState,
    isDefault: rowNumber(row, "is_default") === 1,
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at"),
    archivedAt: rowNullableString(row, "archived_at"),
  };
}

export function candidateKnowledgeSourceFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceRecord {
  return {
    id: rowString(row, "id"),
    knowledgeBaseId: rowString(row, "candidate_knowledge_base_id"),
    kind: rowString(row, "kind") as CandidateKnowledgeSourceKind,
    displayName: rowString(row, "display_name"),
    createdAt: rowString(row, "created_at"),
  };
}

export function candidateKnowledgeSourceVersionFromRow(
  row: Record<string, unknown>,
): CandidateKnowledgeSourceVersionRecord {
  return {
    id: rowString(row, "id"),
    sourceId: rowString(row, "source_id"),
    version: rowNumber(row, "version"),
    parentVersionId: rowNullableString(row, "parent_version_id"),
    mediaType: rowString(row, "media_type"),
    checksum: rowString(row, "checksum"),
    sizeBytes: rowNumber(row, "size_bytes"),
    createdAt: rowString(row, "created_at"),
  };
}
