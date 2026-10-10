import {
  type CandidateEvidenceKind,
  candidateEvidenceKinds,
  isCandidateEvidenceKind,
} from "@draft-loop/domain/candidate-evidence-kind";
import {
  ingestBytes as defaultIngestBytes,
  detectCandidateEvidenceKind,
} from "@draft-loop/ingestion";
import {
  type CandidateKnowledgeStoreHandle,
  openCandidateKnowledgeStore as defaultOpenCandidateKnowledgeStore,
} from "@draft-loop/storage/knowledge-store";
import { CliUserError } from "./cli-user-error.js";

/**
 * Names what kind of career material each knowledge source is. The effective
 * kind is the user's override when one is set, otherwise the kind detected
 * locally from the source's latest version. Detection is deterministic and
 * recomputed on demand, so only overrides are stored; an override belongs to
 * the logical source and survives refreshes that add new versions.
 */

export type { CandidateEvidenceKind } from "@draft-loop/domain/candidate-evidence-kind";
export { candidateEvidenceKinds } from "@draft-loop/domain/candidate-evidence-kind";

export interface SourceEvidenceKindEntry {
  readonly sourceId: string;
  readonly displayName: string;
  /** The version the kind was determined for; always the source's latest. */
  readonly versionId: string;
  readonly kind: CandidateEvidenceKind;
  readonly origin: "user" | "detected";
  /** Detected kinds only: 0..1, how strongly the heuristics pointed at the kind. */
  readonly confidence?: number;
  /** Detected kinds only: names of the heuristics that fired; never source text. */
  readonly signals?: readonly string[];
}

interface StoreCommand {
  readonly storeRoot: string;
  readonly knowledgeBaseId: string;
}

export type ListSourceEvidenceKindsCommand = StoreCommand;

export interface SetSourceEvidenceKindCommand extends StoreCommand {
  readonly sourceId: string;
  /** A taxonomy kind to pin, or `null` to clear the override and return to detection. */
  readonly kind: CandidateEvidenceKind | null;
}

export interface SourceEvidenceKindService {
  /** Lists every current (non-retired) source with its effective kind. Writes nothing. */
  readonly listSourceEvidenceKinds: (
    command: ListSourceEvidenceKindsCommand,
  ) => Promise<readonly SourceEvidenceKindEntry[]>;
  /** Sets or clears a source's override and returns the source's new effective kind. */
  readonly setSourceEvidenceKind: (
    command: SetSourceEvidenceKindCommand,
  ) => Promise<SourceEvidenceKindEntry>;
}

export interface SourceEvidenceKindServiceDependencies {
  readonly open?: (storeRoot: string) => Promise<CandidateKnowledgeStoreHandle>;
  readonly ingestBytes?: typeof defaultIngestBytes;
  readonly now?: () => string;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CliUserError(`${label} is required.`);
  }
  return value.trim();
}

async function useHandle<T>(
  acquire: () => Promise<CandidateKnowledgeStoreHandle>,
  operation: (handle: CandidateKnowledgeStoreHandle) => Promise<T>,
): Promise<T> {
  const handle = await acquire();
  try {
    return await operation(handle);
  } finally {
    try {
      await handle.close();
    } catch {
      // The operation outcome is more useful than a close failure.
    }
  }
}

async function requireKnowledgeBase(
  handle: CandidateKnowledgeStoreHandle,
  knowledgeBaseId: string,
): Promise<void> {
  if ((await handle.getCandidateKnowledgeBase(knowledgeBaseId)) === undefined) {
    throw new CliUserError(`Knowledge base ${knowledgeBaseId} was not found in this store.`);
  }
}

export function createSourceEvidenceKindService(
  dependencies: SourceEvidenceKindServiceDependencies = {},
): SourceEvidenceKindService {
  const open = dependencies.open ?? defaultOpenCandidateKnowledgeStore;
  const ingestBytes = dependencies.ingestBytes ?? defaultIngestBytes;
  const now = dependencies.now ?? (() => new Date().toISOString());

  const describe = async (
    handle: CandidateKnowledgeStoreHandle,
    knowledgeBaseId: string,
    source: { readonly id: string; readonly displayName: string },
    override: CandidateEvidenceKind | undefined,
  ): Promise<SourceEvidenceKindEntry | undefined> => {
    const versions = await handle.listCandidateKnowledgeSourceVersions(knowledgeBaseId, source.id);
    const latest = versions.reduce<(typeof versions)[number] | undefined>(
      (best, item) => (best === undefined || item.version > best.version ? item : best),
      undefined,
    );
    if (latest === undefined) return undefined;
    const base = { sourceId: source.id, displayName: source.displayName, versionId: latest.id };
    if (override !== undefined) return { ...base, kind: override, origin: "user" };

    const content = await handle.readManagedCandidateKnowledgeSourceVersion(
      knowledgeBaseId,
      source.id,
      latest.id,
    );
    const ingested =
      content === undefined
        ? undefined
        : await ingestBytes(
            { path: "evidence-kind", mediaType: content.metadata.mediaType },
            content.bytes,
            { maxSourceBytes: content.metadata.sizeBytes || 1 },
          );
    const normalized = ingested?.source;
    if (
      normalized === undefined ||
      normalized === null ||
      ingested === undefined ||
      ingested.issues.length > 0 ||
      normalized.issues.length > 0
    ) {
      // Unreadable material cannot be named; "other" with no confidence says so.
      return { ...base, kind: "other", origin: "detected", confidence: 0, signals: [] };
    }
    const detection = detectCandidateEvidenceKind({
      text: normalized.text,
      mediaType: normalized.mediaType,
      displayName: source.displayName,
    });
    return {
      ...base,
      kind: detection.kind,
      origin: "detected",
      confidence: detection.confidence,
      signals: detection.signals,
    };
  };

  const overridesOf = async (
    handle: CandidateKnowledgeStoreHandle,
    knowledgeBaseId: string,
  ): Promise<ReadonlyMap<string, CandidateEvidenceKind>> => {
    const records = await handle.listCandidateKnowledgeSourceEvidenceKindOverrides(knowledgeBaseId);
    const overrides = new Map<string, CandidateEvidenceKind>();
    for (const record of records) {
      if (record.kind !== null) overrides.set(record.sourceId, record.kind);
    }
    return overrides;
  };

  return {
    listSourceEvidenceKinds: async (command) => {
      const storeRoot = requireText(command.storeRoot, "The knowledge store root");
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "The knowledge base id");
      return useHandle(
        () => open(storeRoot),
        async (handle) => {
          await requireKnowledgeBase(handle, knowledgeBaseId);
          const overrides = await overridesOf(handle, knowledgeBaseId);
          const entries: SourceEvidenceKindEntry[] = [];
          for (const source of await handle.listCandidateKnowledgeSources(knowledgeBaseId)) {
            if (
              (await handle.getCandidateKnowledgeSourceRetirement(knowledgeBaseId, source.id)) !==
              undefined
            ) {
              continue;
            }
            const entry = await describe(handle, knowledgeBaseId, source, overrides.get(source.id));
            if (entry !== undefined) entries.push(entry);
          }
          return entries;
        },
      );
    },

    setSourceEvidenceKind: async (command) => {
      const storeRoot = requireText(command.storeRoot, "The knowledge store root");
      const knowledgeBaseId = requireText(command.knowledgeBaseId, "The knowledge base id");
      const sourceId = requireText(command.sourceId, "The source id");
      if (command.kind !== null && !isCandidateEvidenceKind(command.kind)) {
        throw new CliUserError(
          `Evidence kind must be one of: ${candidateEvidenceKinds.join(", ")}.`,
        );
      }
      return useHandle(
        () => open(storeRoot),
        async (handle) => {
          const run = async (): Promise<SourceEvidenceKindEntry> => {
            await requireKnowledgeBase(handle, knowledgeBaseId);
            const source = await handle.getCandidateKnowledgeSource(knowledgeBaseId, sourceId);
            if (source === undefined) {
              throw new CliUserError(`Source ${sourceId} was not found in this knowledge base.`);
            }
            if (
              (await handle.getCandidateKnowledgeSourceRetirement(knowledgeBaseId, sourceId)) !==
              undefined
            ) {
              throw new CliUserError(`Source ${sourceId} is retired.`);
            }
            const current = (await overridesOf(handle, knowledgeBaseId)).get(sourceId);
            if ((command.kind ?? undefined) !== current) {
              const records =
                await handle.listCandidateKnowledgeSourceEvidenceKindOverrides(knowledgeBaseId);
              const previous = records.find((record) => record.sourceId === sourceId);
              const requested = Date.parse(now());
              const floor =
                previous === undefined ? Number.NEGATIVE_INFINITY : Date.parse(previous.createdAt);
              await handle.appendCandidateKnowledgeSourceEvidenceKindOverride(
                knowledgeBaseId,
                sourceId,
                {
                  kind: command.kind,
                  createdAt: new Date(Math.max(requested, floor)).toISOString(),
                },
              );
            }
            const entry = await describe(
              handle,
              knowledgeBaseId,
              source,
              command.kind ?? undefined,
            );
            if (entry === undefined) throw new CliUserError(`Source ${sourceId} has no versions.`);
            return entry;
          };
          return typeof handle.withWriterLease === "function"
            ? handle.withWriterLease("ckb-evidence-kind-override", run)
            : run();
        },
      );
    },
  };
}

export const sourceEvidenceKindService = createSourceEvidenceKindService();
