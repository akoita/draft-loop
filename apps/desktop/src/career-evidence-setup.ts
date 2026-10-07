import {
  addCareerEvidence,
  type CareerEvidenceAddOutcome,
  type CareerEvidenceCapabilities,
  type CareerEvidenceSource,
  type CareerEvidenceStatus,
} from "./career-evidence.js";
import { defaultKnowledgeStoreDestinationLabel } from "./career-evidence-contract.js";

/**
 * What the Career evidence card does while the workspace has no knowledge base selected.
 *
 * - `first-add`: no legacy evidence either, so the first add creates and selects a base.
 * - `offer`: legacy evidence exists, so the person is offered a one-time import.
 * - `legacy`: the person declined, or the host cannot create a base, so legacy evidence stays.
 */
export type NoSelectionMode = "first-add" | "offer" | "legacy";

export function supportsAutomaticKnowledgeBase(capabilities: CareerEvidenceCapabilities): boolean {
  return (
    capabilities.ensureDefaultCandidateKnowledgeBase !== undefined &&
    capabilities.selectCandidateKnowledgeBase !== undefined &&
    capabilities.getLegacyEvidenceMigration !== undefined &&
    capabilities.declineLegacyEvidenceMigration !== undefined
  );
}

export function noSelectionMode(input: {
  readonly status: Extract<CareerEvidenceStatus, { kind: "none" }>;
  readonly legacyEvidenceSourceCount: number;
  readonly automatic: boolean;
}): NoSelectionMode {
  if (!input.automatic || input.status.legacyDeclined !== false) return "legacy";
  return input.legacyEvidenceSourceCount > 0 ? "offer" : "first-add";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function createdNotice(displayName: string, created: boolean): string {
  return created
    ? `Created knowledge base “${displayName}” in ${defaultKnowledgeStoreDestinationLabel} and selected it for this workspace.`
    : `Selected knowledge base “${displayName}” for this workspace.`;
}

function requireAutomatic(capabilities: CareerEvidenceCapabilities) {
  const ensure = capabilities.ensureDefaultCandidateKnowledgeBase;
  const select = capabilities.selectCandidateKnowledgeBase;
  if (ensure === undefined || select === undefined) {
    throw new Error("Creating a knowledge base is unavailable");
  }
  return { ensure, select };
}

/**
 * The first add on a workspace with no career evidence: creates the default base if needed,
 * imports the person's source into it, then selects it. The base is selected only after the
 * import so an empty or cancelled intake never leaves a workspace pointing at an empty base.
 */
export async function addFirstCareerEvidence(input: {
  readonly capabilities: CareerEvidenceCapabilities;
  readonly workspaceId: string;
  readonly source: CareerEvidenceSource;
  readonly safeName: (displayName: string) => string;
  readonly isCurrent: () => boolean;
  readonly onChanged: (workspaceId: string) => Promise<boolean>;
}): Promise<CareerEvidenceAddOutcome> {
  const { ensure, select } = requireAutomatic(input.capabilities);
  const base = await ensure(input.workspaceId);
  const target = { storeId: base.storeId, knowledgeBaseId: base.knowledgeBaseId };
  const displayName = input.safeName(base.displayName);
  const outcome = await addCareerEvidence({
    capabilities: input.capabilities,
    workspaceId: input.workspaceId,
    target,
    displayName,
    source: input.source,
    isCurrent: input.isCurrent,
    onChanged: input.onChanged,
    afterImport: async () => {
      await select(input.workspaceId, target);
    },
  });
  if (outcome.status !== "added") return outcome;
  return {
    status: "added",
    message: `${createdNotice(displayName, base.created)} ${outcome.message}`,
  };
}

export type LegacyImportOutcome =
  | { readonly status: "stale" }
  | { readonly status: "nothing-imported"; readonly message: string }
  | { readonly status: "imported"; readonly message: string };

/**
 * The one-time import of the workspace's legacy evidence files into the default base.
 *
 * The person has just approved it by pressing Import. Legacy files are copied, never moved, and
 * the base is selected only when at least one source was imported.
 */
export async function importLegacyEvidence(input: {
  readonly capabilities: CareerEvidenceCapabilities;
  readonly workspaceId: string;
  readonly safeName: (displayName: string) => string;
  readonly isCurrent: () => boolean;
  readonly onChanged: (workspaceId: string) => Promise<boolean>;
}): Promise<LegacyImportOutcome> {
  const { ensure, select } = requireAutomatic(input.capabilities);
  const importSources = input.capabilities.importWorkspaceCandidateSources;
  if (importSources === undefined) throw new Error("Importing legacy evidence is unavailable");
  const base = await ensure(input.workspaceId);
  const target = { storeId: base.storeId, knowledgeBaseId: base.knowledgeBaseId };
  const displayName = input.safeName(base.displayName);
  const result = await importSources({
    workspaceId: input.workspaceId,
    ...target,
    approved: true,
  });
  if (result.storeId !== target.storeId || result.knowledgeBaseId !== target.knowledgeBaseId) {
    throw new Error("Imported source result did not match the knowledge base");
  }
  if (!input.isCurrent()) return { status: "stale" };
  const notImported = Math.max(0, result.discoveredFileCount - result.sourceCount);
  if (result.sourceCount === 0) {
    return {
      status: "nothing-imported",
      message:
        `No legacy evidence file could be imported (${plural(result.discoveredFileCount, "file")} found). ` +
        "Nothing changed: runs keep using legacy workspace evidence.",
    };
  }
  await select(input.workspaceId, target);
  let refreshFailed = false;
  try {
    if (!(await input.onChanged(input.workspaceId))) return { status: "stale" };
  } catch {
    refreshFailed = true;
  }
  if (!input.isCurrent()) return { status: "stale" };
  const counts = `Imported ${result.sourceCount} of ${plural(result.discoveredFileCount, "legacy evidence file")}.`;
  const partial =
    result.status === "partial" || notImported > 0
      ? ` Not imported: ${plural(notImported, "file")}, which stay in the workspace evidence folder.`
      : "";
  const skipped =
    result.skippedEntryCount > 0
      ? ` ${plural(result.skippedEntryCount, "entry")} skipped as unsupported.`
      : "";
  const reopen = refreshFailed ? " Reopen the workspace to refresh the review." : "";
  return {
    status: "imported",
    message: `${createdNotice(displayName, base.created)} ${counts}${partial}${skipped}${reopen}`,
  };
}
