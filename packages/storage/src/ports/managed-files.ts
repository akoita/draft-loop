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

/**
 * Where committed managed candidate-knowledge files live. Locally they are files under the
 * store's `sources` directory; a server driver can keep them in object storage. Reads fail with
 * a `StorageValidationError` when the content is missing or no longer matches its record.
 */
export interface ManagedFileStorePort {
  read(key: ManagedFileKey, integrity: ManagedFileIntegrity): Promise<Uint8Array>;
  verify(key: ManagedFileKey, integrity: ManagedFileIntegrity): Promise<void>;
}
