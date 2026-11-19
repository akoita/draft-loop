import { t } from "@lingui/core/macro";
import type {
  KnowledgeFileImportResult,
  KnowledgeReadinessResult,
  KnowledgeUrlImportResult,
} from "./bridge.js";
import { countedNouns } from "./counted-nouns.js";
import type { DesktopKnowledgeCapabilities } from "./native.js";

export type CareerEvidenceCapabilities = DesktopKnowledgeCapabilities;

/** What the Career evidence setup card shows about the knowledge base the run will use. */
export type CareerEvidenceStatus =
  | { readonly kind: "loading" }
  /** The host cannot report a knowledge selection (browser or fixture): legacy evidence only. */
  | { readonly kind: "unsupported" }
  | { readonly kind: "none" }
  /** A base is selected but its saved store could not be opened or read. */
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "selected";
      readonly storeId: string;
      readonly knowledgeBaseId: string;
      readonly displayName: string;
      readonly sourceCount: number;
      readonly blockedCount: number;
    };

export function supportsCareerEvidence(capabilities: CareerEvidenceCapabilities): boolean {
  return (
    capabilities.getCurrentCandidateKnowledge !== undefined &&
    capabilities.getCandidateKnowledgeReadiness !== undefined
  );
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
      return current.unavailable === true ? { kind: "unavailable" } : { kind: "none" };
    }
    const base = current.store.knowledgeBases.find(
      (candidate) =>
        candidate.state === "active" && current.selectedKnowledgeBaseIds.includes(candidate.id),
    );
    if (base === undefined) return { kind: "none" };
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

/** The stored name of a workspace's default knowledge base. */
export const defaultCareerEvidenceName = "Career evidence";

/** A knowledge base's name as shown: the default base keeps its stored English name, so translate it. */
export function knowledgeBaseDisplayName(displayName: string): string {
  return displayName === defaultCareerEvidenceName ? t`Career evidence` : displayName;
}

export function careerEvidenceSourcesText(
  status: Extract<CareerEvidenceStatus, { kind: "selected" }>,
): string {
  const documents = countedNouns.document(status.sourceCount);
  // The default base needs no name: it is simply the person's documents.
  if (status.displayName === defaultCareerEvidenceName) return documents;
  return t`${status.displayName} · ${documents}`;
}

export function careerEvidenceReadinessText(
  status: Extract<CareerEvidenceStatus, { kind: "selected" }>,
): string {
  if (status.sourceCount === 0) return t`Empty: add a CV, portfolio, or other document`;
  if (status.blockedCount > 0) return `${status.blockedCount} not ready`;
  return t`Ready`;
}

export type CareerEvidenceSource =
  | { readonly kind: "file" }
  | { readonly kind: "url"; readonly url: string }
  /** Typed or pasted text, saved as one plain-text source (#2417). */
  | { readonly kind: "text"; readonly title: string; readonly text: string };

/** Says what adding the source did: new source, new version of one, or already there. */
function careerEvidenceAddLead(
  result: KnowledgeFileImportResult | KnowledgeUrlImportResult,
  displayName: string,
): string {
  const outcome = "outcome" in result ? result.outcome : undefined;
  if (outcome === "new-version") return t`Added a new version of that file to ${displayName}.`;
  const created =
    outcome !== undefined ? outcome === "added" : !("created" in result) || result.created;
  return created ? t`Added to ${displayName}.` : t`Already in ${displayName}.`;
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
  const importUrl = capabilities.importCandidateKnowledgeUrl;
  const importText = capabilities.importCandidateKnowledgeText;
  const readReadiness = capabilities.getCandidateKnowledgeReadiness;
  if (readReadiness === undefined) throw new Error(t`Career evidence intake is unavailable`);
  let result: KnowledgeFileImportResult | KnowledgeUrlImportResult;
  if (input.source.kind === "file") {
    if (importFile === undefined) throw new Error(t`Career evidence intake is unavailable`);
    result = await importFile(target.storeId, target.knowledgeBaseId);
  } else if (input.source.kind === "text") {
    if (importText === undefined) throw new Error(t`Career evidence intake is unavailable`);
    const { title, text } = input.source;
    result = await importText(target.storeId, target.knowledgeBaseId, { title, text });
  } else {
    if (importUrl === undefined) throw new Error(t`Career evidence intake is unavailable`);
    result = await importUrl(target.storeId, target.knowledgeBaseId, input.source.url);
  }
  if (result.storeId !== target.storeId || result.knowledgeBaseId !== target.knowledgeBaseId) {
    throw new Error(t`Imported source result did not match the selected knowledge base`);
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
      ? ` ${t`Readiness could not be checked.`}`
      : ` ${t`${countedNouns.document(readiness.sourceCount)}, ${readiness.readyCount} ready.`}`;
  const reopen = refreshFailed ? ` ${t`Reopen the workspace to refresh the review.`}` : "";
  return { status: "added", message: `${lead}${counts}${reopen}` };
}
