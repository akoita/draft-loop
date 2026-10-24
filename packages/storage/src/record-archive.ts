/**
 * A candidate record's archive (ADR 0011, D7): everything the service keeps about one record, as
 * the files of record archive v1 (`@draft-loop/schemas/record-archive`). This module holds only
 * the port, its files and its errors; hosted storage implements it.
 */
import type { RecordArchiveManifest } from "@draft-loop/schemas/record-archive";

/** Which record to archive. */
export interface RecordArchiveRequest {
  /** The record's workspace id, as the API names it. */
  readonly workspaceId: string;
  /** The workspace's history record id, which its runs, versions and consents are keyed by. */
  readonly historyId: string;
  /**
   * Which knowledge bases the archive holds. `owned`: the bases the record owns, for sign-in
   * mode, where each base belongs to one record. `tenant`: every base of the tenant, for
   * owner-token mode, which holds one workspace and tenant-wide bases. The adapter chooses it from
   * its authentication mode; it is never inferred from the data.
   */
  readonly knowledgeScope: RecordArchiveKnowledgeScope;
}

export type RecordArchiveKnowledgeScope = "owned" | "tenant";

/** One file of the archive: its path in the archive and its bytes. */
export interface RecordArchiveFile {
  readonly path: string;
  readonly content: Uint8Array;
}

/** A prepared archive: the manifest is known before any object's bytes are read again. */
export interface RecordArchive {
  readonly manifest: RecordArchiveManifest;
  /** Lowercase hex SHA-256 of the manifest file's bytes. */
  readonly manifestSha256: string;
  /**
   * The manifest file first, then every entry in manifest order. Each object is read and checked
   * against its recorded checksum and size as it is reached; one that is missing or changed throws
   * `RecordArchiveError` with `object_integrity`, and nothing unchecked is yielded.
   */
  readonly files: () => AsyncIterable<RecordArchiveFile>;
}

export interface RecordArchives {
  /**
   * Reads the record's rows from one snapshot and checks every object it references, so a missing
   * or changed object fails before the first byte is sent.
   */
  readonly prepare: (request: RecordArchiveRequest) => Promise<RecordArchive>;
}

export type RecordArchiveErrorCode = "object_integrity";

/** Why an archive could not be made. Its message is safe to show and names no stored location. */
export class RecordArchiveError extends Error {
  readonly code: RecordArchiveErrorCode;

  constructor(code: RecordArchiveErrorCode, message: string) {
    super(message);
    this.name = "RecordArchiveError";
    this.code = code;
  }
}
