import {
  addCareerEvidence,
  type CareerEvidenceAddOutcome,
  type CareerEvidenceCapabilities,
  type CareerEvidenceSource,
} from "./career-evidence.js";
import { defaultKnowledgeStoreDestinationLabel } from "./career-evidence-contract.js";

/**
 * What the Career evidence card does while the workspace has no knowledge base selected.
 *
 * - `first-add`: the first add creates and selects a base.
 * - `legacy`: the host cannot create a base, so adds go to legacy workspace evidence.
 */
export type NoSelectionMode = "first-add" | "legacy";

export function supportsAutomaticKnowledgeBase(capabilities: CareerEvidenceCapabilities): boolean {
  return (
    capabilities.ensureDefaultCandidateKnowledgeBase !== undefined &&
    capabilities.selectCandidateKnowledgeBase !== undefined
  );
}

export function noSelectionMode(automatic: boolean): NoSelectionMode {
  return automatic ? "first-add" : "legacy";
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
