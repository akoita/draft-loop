import type {
  KnowledgeDirectoryImportResult,
  KnowledgeReadinessResult,
  KnowledgeUrlImportResult,
} from "./bridge.js";
import type { KnowledgeIntakeResult } from "./knowledge-intake.js";
import type {
  DesktopKnowledgeCapabilities,
  DesktopSemanticRetrievalCapabilities,
} from "./native.js";
import type { EmbeddingModelState } from "./semantic-retrieval-contract.js";

export type CareerEvidenceCapabilities = DesktopKnowledgeCapabilities &
  DesktopSemanticRetrievalCapabilities;

/** What the Career evidence setup card shows about the knowledge base the run will use. */
export type CareerEvidenceStatus =
  | { readonly kind: "loading" }
  /** The host cannot report a knowledge selection (browser or fixture): legacy evidence only. */
  | { readonly kind: "unsupported" }
  | {
      readonly kind: "none";
      /**
       * Whether the person chose to keep legacy workspace evidence. Absent when the host cannot
       * create a knowledge base automatically or the choice could not be read: legacy stays.
       */
      readonly legacyDeclined?: boolean;
    }
  /** A base is selected but its saved store could not be opened or read. */
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "selected";
      readonly storeId: string;
      readonly knowledgeBaseId: string;
      readonly displayName: string;
      readonly sourceCount: number;
      readonly blockedCount: number;
      /** Null in lexical mode, where no model is involved. */
      readonly semanticLine: string | null;
    };

export function supportsCareerEvidence(capabilities: CareerEvidenceCapabilities): boolean {
  return (
    capabilities.getCurrentCandidateKnowledge !== undefined &&
    capabilities.getCandidateKnowledgeReadiness !== undefined
  );
}

export function semanticStatusLine(state: EmbeddingModelState): string {
  switch (state) {
    case "ready":
      return "Semantic search: ready";
    case "absent":
      return "Semantic search: model not installed";
    case "installing":
      return "Semantic search: model installing";
    case "corrupt":
      return "Semantic search: model needs reinstalling";
    case "unsupported-platform":
      return "Semantic search: not supported on this computer";
  }
}

async function readSemanticLine(
  capabilities: CareerEvidenceCapabilities,
  workspaceId: string,
): Promise<string | null> {
  const readMode = capabilities.getRetrievalMode;
  const readModel = capabilities.getEmbeddingModelStatus;
  if (readMode === undefined || readModel === undefined) return null;
  try {
    const record = await readMode(workspaceId);
    if (record.mode === "lexical") return null;
    return semanticStatusLine((await readModel(record.modelTier)).state);
  } catch {
    return null;
  }
}

async function readLegacyDecision(
  capabilities: CareerEvidenceCapabilities,
  workspaceId: string,
): Promise<boolean | undefined> {
  const read = capabilities.getLegacyEvidenceMigration;
  if (read === undefined) return undefined;
  try {
    return (await read(workspaceId)).declined;
  } catch {
    return undefined;
  }
}

async function noSelectionStatus(
  capabilities: CareerEvidenceCapabilities,
  workspaceId: string,
): Promise<CareerEvidenceStatus> {
  const legacyDeclined = await readLegacyDecision(capabilities, workspaceId);
  return legacyDeclined === undefined ? { kind: "none" } : { kind: "none", legacyDeclined };
}

/** Reads the workspace's selected knowledge base and its readiness through the host port. */
export async function loadCareerEvidenceStatus(
  capabilities: CareerEvidenceCapabilities,
  workspaceId: string,
  safeName: (displayName: string) => string,
): Promise<CareerEvidenceStatus> {
  const readCurrent = capabilities.getCurrentCandidateKnowledge;
  const readReadiness = capabilities.getCandidateKnowledgeReadiness;
  if (readCurrent === undefined || readReadiness === undefined) return { kind: "unsupported" };
  try {
    const current = await readCurrent(workspaceId);
    if (current.store === null) {
      return current.unavailable === true
        ? { kind: "unavailable" }
        : await noSelectionStatus(capabilities, workspaceId);
    }
    const base = current.store.knowledgeBases.find(
      (candidate) =>
        candidate.state === "active" && current.selectedKnowledgeBaseIds.includes(candidate.id),
    );
    if (base === undefined) return await noSelectionStatus(capabilities, workspaceId);
    const readiness = await readReadiness(current.store.storeId, base.id);
    if (readiness.storeId !== current.store.storeId || readiness.knowledgeBaseId !== base.id) {
      return { kind: "unavailable" };
    }
    return {
      kind: "selected",
      storeId: current.store.storeId,
      knowledgeBaseId: base.id,
      displayName: safeName(base.displayName),
      sourceCount: readiness.sourceCount,
      blockedCount: readiness.blockedCount,
      semanticLine: await readSemanticLine(capabilities, workspaceId),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Whether the card is satisfied: the used base has a source, else legacy evidence exists. */
export function careerEvidenceReady(
  status: CareerEvidenceStatus,
  workspaceEvidenceSourceCount: number,
): boolean {
  return status.kind === "selected"
    ? status.sourceCount > 0
    : status.kind !== "unavailable" && workspaceEvidenceSourceCount > 0;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function careerEvidenceSourcesText(
  status: Extract<CareerEvidenceStatus, { kind: "selected" }>,
): string {
  return `${status.displayName} · ${plural(status.sourceCount, "source")}`;
}

export function careerEvidenceReadinessText(
  status: Extract<CareerEvidenceStatus, { kind: "selected" }>,
): string {
  if (status.sourceCount === 0) return "Empty: add a CV, portfolio, or other source";
  if (status.blockedCount > 0) return `${status.blockedCount} not ready`;
  return "Ready";
}

export type CareerEvidenceSource =
  | { readonly kind: "file" }
  | { readonly kind: "directory" }
  | { readonly kind: "url"; readonly url: string };

/** Says what adding the source did: new source, new version of one, or already there. */
function careerEvidenceAddLead(
  result: KnowledgeIntakeResult | KnowledgeUrlImportResult,
  displayName: string,
): string {
  if ("status" in result) return folderAddLead(result, displayName);
  const outcome = "outcome" in result ? result.outcome : undefined;
  if (outcome === "new-version") return `Added a new version of that file to ${displayName}.`;
  const created =
    outcome !== undefined ? outcome === "added" : !("created" in result) || result.created;
  return created ? `Added to ${displayName}.` : `Already in ${displayName}.`;
}

/** Says how many of the folder's files reached the base, and when the import stopped early. */
function folderAddLead(result: KnowledgeDirectoryImportResult, displayName: string): string {
  const lead = `Added ${plural(result.sourceCount, "source")} from the folder to ${displayName}.`;
  return result.status === "partial" ? `${lead} Some files could not be imported.` : lead;
}

export type CareerEvidenceAddOutcome =
  | { readonly status: "stale" }
  | { readonly status: "added"; readonly message: string };

/**
 * Imports one source into the selected knowledge base, then refreshes the workspace.
 *
 * The host call is the person's explicit approval: files come from the native picker and a URL
 * is fetched only after they press its button. The result must name the selected base.
 */
export async function addCareerEvidence(input: {
  readonly capabilities: CareerEvidenceCapabilities;
  readonly workspaceId: string;
  readonly target: { readonly storeId: string; readonly knowledgeBaseId: string };
  readonly displayName: string;
  readonly source: CareerEvidenceSource;
  readonly isCurrent: () => boolean;
  readonly onChanged: (workspaceId: string) => Promise<boolean>;
  /** Runs once the source is in the base and before the workspace refreshes, e.g. to select it. */
  readonly afterImport?: () => Promise<void>;
}): Promise<CareerEvidenceAddOutcome> {
  const { capabilities, target } = input;
  const importFile = capabilities.importCandidateKnowledgeFile;
  const importDirectory = capabilities.importCandidateKnowledgeDirectory;
  const importUrl = capabilities.importCandidateKnowledgeUrl;
  const readReadiness = capabilities.getCandidateKnowledgeReadiness;
  if (readReadiness === undefined) throw new Error("Career evidence intake is unavailable");
  let result: KnowledgeIntakeResult | KnowledgeUrlImportResult;
  if (input.source.kind === "file") {
    if (importFile === undefined) throw new Error("Career evidence intake is unavailable");
    result = await importFile(target.storeId, target.knowledgeBaseId);
  } else if (input.source.kind === "directory") {
    if (importDirectory === undefined) throw new Error("Career evidence intake is unavailable");
    result = await importDirectory(target.storeId, target.knowledgeBaseId);
  } else {
    if (importUrl === undefined) throw new Error("Career evidence intake is unavailable");
    result = await importUrl(target.storeId, target.knowledgeBaseId, input.source.url);
  }
  if (result.storeId !== target.storeId || result.knowledgeBaseId !== target.knowledgeBaseId) {
    throw new Error("Imported source result did not match the selected knowledge base");
  }
  // An empty folder adds nothing, so a first add must not go on to select an empty base.
  if ("status" in result && result.sourceCount === 0) {
    throw new Error("The folder has no supported files to add.");
  }
  await input.afterImport?.();
  if (!input.isCurrent()) return { status: "stale" };

  let readiness: KnowledgeReadinessResult | null = null;
  try {
    const found = await readReadiness(target.storeId, target.knowledgeBaseId);
    if (found.storeId === target.storeId && found.knowledgeBaseId === target.knowledgeBaseId) {
      readiness = found;
    }
  } catch {
    // The import succeeded even when readiness cannot be inspected.
  }
  if (!input.isCurrent()) return { status: "stale" };

  let refreshFailed = false;
  try {
    if (!(await input.onChanged(input.workspaceId))) return { status: "stale" };
  } catch {
    refreshFailed = true;
  }
  if (!input.isCurrent()) return { status: "stale" };

  const lead = careerEvidenceAddLead(result, input.displayName);
  const counts =
    readiness === null
      ? " Readiness could not be checked."
      : ` ${plural(readiness.sourceCount, "source")}, ${readiness.readyCount} ready.`;
  const reopen = refreshFailed ? " Reopen the workspace to refresh the review." : "";
  return { status: "added", message: `${lead}${counts}${reopen}` };
}
