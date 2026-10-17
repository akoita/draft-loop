import type { CandidateKnowledgeDeletionOperationRecord } from "./candidate-knowledge.js";

/** Identifies one managed candidate-knowledge file: a version of a managed source. */
export interface ManagedFileKey {
  readonly sourceId: string;
  readonly versionId: string;
}

/** What the record says the file must contain; every read is checked against it. */
export interface ManagedFileIntegrity {
  /** Lowercase hex SHA-256 of the content. */
  readonly checksum: string;
  readonly sizeBytes: number;
}

/** Device and inode pair the write journal records to tell its staging file from any other. */
export interface ManagedFileIdentity {
  readonly dev: number;
  readonly ino: number;
}

/** Captured, verified bytes waiting to be published under a key. */
export interface StagedManagedFile extends ManagedFileIntegrity {
  /** Where the implementation staged the bytes; opaque to callers. */
  readonly location: string;
  readonly identity: ManagedFileIdentity;
}

/**
 * Where committed managed candidate-knowledge files live. Locally they are files under the
 * store's `sources` directory; a server driver can keep them in object storage. Reads fail with
 * a `StorageValidationError` when the content is missing or no longer matches its record.
 */
export interface ManagedFileStorePort {
  read(key: ManagedFileKey, integrity: ManagedFileIntegrity): Promise<Uint8Array>;
  verify(key: ManagedFileKey, integrity: ManagedFileIntegrity): Promise<void>;
  /** Makes sure a source can hold versions, reporting whether this call created its location. */
  ensureSource(sourceId: string): Promise<{ readonly created: boolean }>;
  /**
   * Publishes staged bytes under a key without ever replacing what is there: an existing key is
   * a `StorageConflictError`. The published file is verified before this resolves.
   */
  publish(staged: StagedManagedFile, key: ManagedFileKey): Promise<void>;
  /** Removes staged bytes if they are still the ones staged; false when that can't be proved. */
  removeStaged(staged: StagedManagedFile): Promise<boolean>;
  /**
   * Rolls back an uncommitted write: the staged bytes, the published copy when `published`, and
   * the source location when this write created it and it is now empty. False when any part
   * could not be proved removed; recovery at open retries it.
   */
  discardUncommitted(
    staged: StagedManagedFile,
    write: {
      readonly target: ManagedFileKey | undefined;
      readonly published: boolean;
      readonly createdSource: boolean;
    },
  ): Promise<boolean>;
  /**
   * Deletion moves a graph's files aside under its operation, then commits by removing them or
   * rolls back by restoring them. The returned identity is what the deletion journal records.
   */
  createDeletionStaging(operationId: string): Promise<{ readonly identity: ManagedFileIdentity }>;
  /** Moves each artifact aside, resuming safely if some already moved; never overwrites. */
  stageDeletion(operation: CandidateKnowledgeDeletionOperationRecord): Promise<void>;
  /** Fails unless every artifact is staged, unchanged, and gone from its committed location. */
  verifyDeletionStaged(operation: CandidateKnowledgeDeletionOperationRecord): Promise<void>;
  /** Removes the staged artifacts and any source location the deletion left empty. */
  commitDeletion(operation: CandidateKnowledgeDeletionOperationRecord): Promise<void>;
  /** Moves staged artifacts home; false when any could not be proved restored. */
  restoreDeletion(operation: CandidateKnowledgeDeletionOperationRecord): Promise<boolean>;
}
