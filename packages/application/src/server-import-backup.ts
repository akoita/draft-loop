import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CandidateKnowledgePortableBackupManifest,
  candidateKnowledgePortableBackupManifestFilename,
  candidateKnowledgePortableBackupManifestSchema,
} from "@draft-loop/schemas";
import { inspectCandidateKnowledgePortableBackup } from "@draft-loop/storage/knowledge-store";
import { CliUserError } from "./cli-user-error.js";
import { hostedKnowledgeSourceMediaTypes } from "./hosted-knowledge-intake.js";

/** One source a server import would upload: the latest version of a source that is not retired. */
export interface BackupImportSource {
  readonly id: string;
  readonly displayName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
}

/** Why a source in the backup is not uploaded. */
export type BackupImportSkipReason = "retired" | "unsupported-type";

export interface BackupImportKnowledgeBase {
  readonly id: string;
  readonly displayName: string;
  readonly sources: readonly BackupImportSource[];
  readonly skipped: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly reason: BackupImportSkipReason;
  }[];
}

/** What a verified portable backup offers a server import, without any file content. */
export interface BackupImportPlan {
  readonly storeId: string;
  readonly knowledgeBases: readonly BackupImportKnowledgeBase[];
  /** Archived bases stay on the desktop; their sources are not uploaded. */
  readonly archivedKnowledgeBases: number;
  /** Reads one planned source's bytes and checks them against the manifest again. */
  readonly read: (source: BackupImportSource) => Promise<Uint8Array>;
}

const uploadableMediaTypes: ReadonlySet<string> = new Set(hostedKnowledgeSourceMediaTypes);

function backupUnreadable(): CliUserError {
  return new CliUserError(
    "The portable backup could not be verified. Export it again with `draft-loop knowledge export`.",
  );
}

/**
 * Opens a portable candidate knowledge backup (ADR 0007) read only for an import into the server
 * (ADR 0011, D12). The whole package is verified first; each file is checked again when it is read,
 * so a backup that changes during the import is refused instead of uploaded.
 */
export async function readBackupForServerImport(packagePath: string): Promise<BackupImportPlan> {
  let manifest: CandidateKnowledgePortableBackupManifest;
  try {
    await inspectCandidateKnowledgePortableBackup(packagePath);
    manifest = candidateKnowledgePortableBackupManifestSchema.parse(
      JSON.parse(
        await readFile(join(packagePath, candidateKnowledgePortableBackupManifestFilename), "utf8"),
      ),
    );
  } catch {
    throw backupUnreadable();
  }
  const objects = new Map<string, string>();
  const knowledgeBases: BackupImportKnowledgeBase[] = [];
  let archivedKnowledgeBases = 0;
  for (const entry of manifest.knowledgeBases) {
    if (entry.knowledgeBase.state !== "active") {
      archivedKnowledgeBases += 1;
      continue;
    }
    const sources: BackupImportSource[] = [];
    const skipped: BackupImportKnowledgeBase["skipped"][number][] = [];
    for (const source of entry.sources) {
      const latest = source.versions.at(-1);
      if (latest === undefined) continue;
      const reason: BackupImportSkipReason | undefined =
        source.retirement !== null
          ? "retired"
          : uploadableMediaTypes.has(latest.mediaType)
            ? undefined
            : "unsupported-type";
      if (reason !== undefined) {
        skipped.push({ id: source.id, displayName: source.displayName, reason });
        continue;
      }
      objects.set(latest.checksum, join(packagePath, latest.contentObject));
      sources.push({
        id: source.id,
        displayName: source.displayName,
        mediaType: latest.mediaType,
        sizeBytes: latest.sizeBytes,
        checksum: latest.checksum,
      });
    }
    knowledgeBases.push({
      id: entry.knowledgeBase.id,
      displayName: entry.knowledgeBase.displayName,
      sources,
      skipped,
    });
  }
  return {
    storeId: manifest.descriptor.id,
    knowledgeBases,
    archivedKnowledgeBases,
    read: async (source) => {
      const path = objects.get(source.checksum);
      if (path === undefined) throw backupUnreadable();
      const bytes = await readFile(path).catch(() => {
        throw backupUnreadable();
      });
      const checksum = createHash("sha256").update(bytes).digest("hex");
      if (checksum !== source.checksum || bytes.byteLength !== source.sizeBytes) {
        throw backupUnreadable();
      }
      return bytes;
    },
  };
}
