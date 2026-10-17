/** Where a blob lives and the exact content it must still have. */
export interface BlobReference {
  /** The implementation's address: a file path on the filesystem, an object key in a bucket. */
  readonly location: string;
  /** Lowercase hex SHA-256 of the content. */
  readonly checksum: string;
  readonly sizeBytes: number;
}

/**
 * Whole-file content such as exported documents. A blob is read, checked and deleted by its
 * reference, so a file changed or replaced since it was written never passes for the original.
 */
export interface BlobStoragePort {
  /** Writes the content at the location, replacing what was there, and returns its reference. */
  readonly put: (location: string, content: Uint8Array) => Promise<BlobReference>;
  /** The content, or `undefined` when it is missing or no longer matches the checksum. */
  readonly get: (reference: BlobReference) => Promise<Uint8Array | undefined>;
  /** Whether the location still holds exactly the referenced content. */
  readonly exists: (reference: BlobReference) => Promise<boolean>;
  /** Removes the blob when it still holds the referenced content; resolves with whether it did. */
  readonly delete: (reference: BlobReference) => Promise<boolean>;
}
