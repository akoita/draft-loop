import { createHash, randomUUID } from "node:crypto";
import type {
  BlobStoragePort,
  CandidateKnowledgeBaseRecord,
  CandidateKnowledgeBaseStoragePort,
  CandidateKnowledgeSourceRecord,
  CandidateKnowledgeSourceVersionRecord,
} from "@draft-loop/storage";
import type { CandidateKnowledgeStoreDescriptor } from "@draft-loop/storage/knowledge-store";

import { CliUserError } from "./cli-user-error.js";

/** The source files the hosted service takes; the run worker extracts their text later. */
export const hostedKnowledgeSourceMediaTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/plain",
] as const;

export type HostedKnowledgeSourceMediaType = (typeof hostedKnowledgeSourceMediaTypes)[number];

/** The largest source file taken by default: a long CV or portfolio export fits well inside. */
export const defaultHostedKnowledgeSourceMaxBytes = 10 * 1024 * 1024;

export type HostedKnowledgeIntakeErrorCode =
  | "knowledge_base_not_found"
  | "source_empty"
  | "source_too_large"
  | "unsupported_media_type";

/** A refusal the owner can act on; its message never quotes the file. */
export class HostedKnowledgeIntakeError extends CliUserError {
  readonly code: HostedKnowledgeIntakeErrorCode;

  constructor(code: HostedKnowledgeIntakeErrorCode, message: string) {
    super(message);
    this.name = "HostedKnowledgeIntakeError";
    this.code = code;
  }
}

/**
 * The tenant's knowledge records intake writes and reads, such as Postgres storage bound to one
 * tenant. Knowledge bases belong to the tenant, so the tenant has one store.
 */
export interface HostedKnowledgeIntakeRecords
  extends Pick<
    CandidateKnowledgeBaseStoragePort,
    | "createCandidateKnowledgeBase"
    | "getCandidateKnowledgeBase"
    | "listCandidateKnowledgeBases"
    | "createCandidateKnowledgeSource"
    | "listCandidateKnowledgeSources"
    | "listCandidateKnowledgeSourceVersions"
  > {
  readonly createCandidateKnowledgeStore: (
    descriptor: CandidateKnowledgeStoreDescriptor,
  ) => Promise<CandidateKnowledgeStoreDescriptor>;
  readonly getCandidateKnowledgeStore: (
    id: string,
  ) => Promise<CandidateKnowledgeStoreDescriptor | undefined>;
  /** Records that the service holds a version's bytes at a blob location. */
  readonly recordManagedCandidateKnowledgeSourceVersion: (input: {
    readonly knowledgeBaseId: string;
    readonly sourceId: string;
    readonly versionId: string;
    readonly location: string;
    readonly recordedAt: string;
  }) => Promise<void>;
}

export interface HostedKnowledgeIntakeOptions {
  readonly records: HostedKnowledgeIntakeRecords;
  /** Where source bytes go, such as the tenant's Cloud Storage prefix. */
  readonly blobs: BlobStoragePort;
  /** The tenant's one store. */
  readonly storeId: string;
  /** The blob location of a source version's bytes, inside the tenant's prefix. */
  readonly locate: (versionId: string) => string;
  readonly maxSourceBytes?: number;
  readonly now?: () => string;
  readonly generateId?: () => string;
}

export interface HostedKnowledgeSourceView {
  readonly source: CandidateKnowledgeSourceRecord;
  readonly latestVersion: CandidateKnowledgeSourceVersionRecord;
}

export interface AddHostedKnowledgeFileSourceCommand {
  readonly knowledgeBaseId: string;
  readonly displayName: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export interface AddedHostedKnowledgeSource extends HostedKnowledgeSourceView {
  /** False when the base already held these exact bytes; nothing new was written. */
  readonly created: boolean;
}

export interface HostedKnowledgeIntake {
  /** The largest source file this intake takes, in bytes. */
  readonly maxSourceBytes: number;
  readonly ensureStore: () => Promise<CandidateKnowledgeStoreDescriptor>;
  readonly createKnowledgeBase: (input: {
    readonly displayName: string;
    readonly description?: string;
  }) => Promise<CandidateKnowledgeBaseRecord>;
  readonly listKnowledgeBases: () => Promise<readonly CandidateKnowledgeBaseRecord[]>;
  readonly listSources: (knowledgeBaseId: string) => Promise<readonly HostedKnowledgeSourceView[]>;
  readonly addFileSource: (
    command: AddHostedKnowledgeFileSourceCommand,
  ) => Promise<AddedHostedKnowledgeSource>;
}

const pdfSignature = new TextEncoder().encode("%PDF-");
const zipSignature = Uint8Array.of(0x50, 0x4b, 0x03, 0x04);
const docxMainPart = Buffer.from("word/document.xml");

function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return bytes.byteLength >= prefix.byteLength && prefix.every((byte, at) => bytes[at] === byte);
}

function isText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the bytes are what the declared media type says, judged by their signature only: the
 * service never parses an uploaded PDF or DOCX (ADR 0011, D11), so a file of the right kind that
 * cannot be read fails when a run extracts it.
 */
export function matchesHostedSourceMediaType(
  bytes: Uint8Array,
  mediaType: HostedKnowledgeSourceMediaType,
): boolean {
  switch (mediaType) {
    case "application/pdf":
      return startsWith(bytes, pdfSignature);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return startsWith(bytes, zipSignature) && Buffer.from(bytes).includes(docxMainPart);
    case "text/markdown":
    case "text/plain":
      return isText(bytes);
  }
}

export function isHostedSourceMediaType(value: string): value is HostedKnowledgeSourceMediaType {
  return (hostedKnowledgeSourceMediaTypes as readonly string[]).includes(value);
}

/**
 * A base's sources with their latest version, for a reader that already knows the base exists,
 * such as the worker checking a run's material. A source with no version is left out.
 */
export async function listHostedKnowledgeSources(
  records: Pick<
    HostedKnowledgeIntakeRecords,
    "listCandidateKnowledgeSources" | "listCandidateKnowledgeSourceVersions"
  >,
  knowledgeBaseId: string,
): Promise<readonly HostedKnowledgeSourceView[]> {
  const sources = await records.listCandidateKnowledgeSources(knowledgeBaseId);
  const views: HostedKnowledgeSourceView[] = [];
  for (const source of sources) {
    const versions = await records.listCandidateKnowledgeSourceVersions(knowledgeBaseId, source.id);
    const latestVersion = versions.at(-1);
    if (latestVersion !== undefined) views.push({ source, latestVersion });
  }
  return views;
}

/**
 * Takes candidate source files into a tenant's hosted knowledge store (ADR 0011, D3, D11). Bytes go
 * to blob storage first and the source is recorded after, so a recorded version always has its
 * bytes; a failure between the two leaves only an unreferenced blob.
 */
export function createHostedKnowledgeIntake(
  options: HostedKnowledgeIntakeOptions,
): HostedKnowledgeIntake {
  const { records, blobs, storeId } = options;
  const maxSourceBytes = options.maxSourceBytes ?? defaultHostedKnowledgeSourceMaxBytes;
  const now = options.now ?? (() => new Date().toISOString());
  const generateId = options.generateId ?? randomUUID;

  const ensureStore = async (): Promise<CandidateKnowledgeStoreDescriptor> => {
    const existing = await records.getCandidateKnowledgeStore(storeId);
    if (existing !== undefined) return existing;
    try {
      return await records.createCandidateKnowledgeStore({
        schemaVersion: 1,
        id: storeId,
        createdAt: now(),
      });
    } catch (error) {
      // A concurrent request created it first.
      const created = await records.getCandidateKnowledgeStore(storeId);
      if (created === undefined) throw error;
      return created;
    }
  };

  const requireKnowledgeBase = async (id: string): Promise<CandidateKnowledgeBaseRecord> => {
    const base = await records.getCandidateKnowledgeBase(id);
    if (base === undefined) {
      throw new HostedKnowledgeIntakeError("knowledge_base_not_found", "No such knowledge base.");
    }
    return base;
  };

  const listSources = async (
    knowledgeBaseId: string,
  ): Promise<readonly HostedKnowledgeSourceView[]> => {
    await requireKnowledgeBase(knowledgeBaseId);
    return listHostedKnowledgeSources(records, knowledgeBaseId);
  };

  return {
    maxSourceBytes,
    ensureStore,
    createKnowledgeBase: async (input) => {
      await ensureStore();
      return records.createCandidateKnowledgeBase({
        id: generateId(),
        displayName: input.displayName,
        ...(input.description === undefined ? {} : { description: input.description }),
        isDefault: false,
        createdAt: now(),
      });
    },
    listKnowledgeBases: records.listCandidateKnowledgeBases,
    listSources,
    addFileSource: async (command) => {
      const { knowledgeBaseId, bytes } = command;
      if (!isHostedSourceMediaType(command.mediaType)) {
        throw new HostedKnowledgeIntakeError(
          "unsupported_media_type",
          "Upload a PDF, DOCX, Markdown or plain text file.",
        );
      }
      if (bytes.byteLength === 0) {
        throw new HostedKnowledgeIntakeError("source_empty", "The file is empty.");
      }
      if (bytes.byteLength > maxSourceBytes) {
        throw new HostedKnowledgeIntakeError(
          "source_too_large",
          `The file is larger than the ${maxSourceBytes}-byte limit.`,
        );
      }
      if (!matchesHostedSourceMediaType(bytes, command.mediaType)) {
        throw new HostedKnowledgeIntakeError(
          "unsupported_media_type",
          "The file's content does not match its media type.",
        );
      }
      await ensureStore();
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const duplicate = (await listSources(knowledgeBaseId)).find(
        ({ latestVersion }) => latestVersion.checksum === checksum,
      );
      if (duplicate !== undefined) return { ...duplicate, created: false };

      const sourceId = generateId();
      const versionId = generateId();
      const createdAt = now();
      const blob = await blobs.put(options.locate(versionId), bytes);
      const written = await records.createCandidateKnowledgeSource(
        {
          id: sourceId,
          knowledgeBaseId,
          kind: "file",
          displayName: command.displayName,
          createdAt,
        },
        {
          id: versionId,
          mediaType: command.mediaType,
          checksum,
          sizeBytes: bytes.byteLength,
          createdAt,
        },
      );
      await records.recordManagedCandidateKnowledgeSourceVersion({
        knowledgeBaseId,
        sourceId,
        versionId,
        location: blob.location,
        recordedAt: createdAt,
      });
      return { source: written.source, latestVersion: written.version, created: true };
    },
  };
}
