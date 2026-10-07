import type {
  KnowledgeDirectoryImportResult,
  KnowledgeFileImportResult,
  KnowledgeReadinessResult,
} from "./bridge.js";
import type { DesktopKnowledgeCapabilities } from "./native.js";

export interface KnowledgeBaseTarget {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
}

export type KnowledgeIntakeResult = KnowledgeFileImportResult | KnowledgeDirectoryImportResult;
export type KnowledgeIntakeCapabilities = Required<
  Pick<
    DesktopKnowledgeCapabilities,
    | "importCandidateKnowledgeFile"
    | "importCandidateKnowledgeDirectory"
    | "getCandidateKnowledgeReadiness"
  >
>;
export type WorkspaceSourcesIntakeCapabilities = Required<
  Pick<
    DesktopKnowledgeCapabilities,
    "importWorkspaceCandidateSources" | "getCandidateKnowledgeReadiness"
  >
>;

export type KnowledgeIntakeOutcome =
  | { readonly status: "stale" }
  | { readonly status: "readiness-unavailable"; readonly result: KnowledgeIntakeResult }
  | {
      readonly status: "refresh-unavailable";
      readonly result: KnowledgeIntakeResult;
      readonly readiness: KnowledgeReadinessResult | null;
    }
  | {
      readonly status: "ready";
      readonly result: KnowledgeIntakeResult;
      readonly readiness: KnowledgeReadinessResult;
    };

export function hasDesktopKnowledgeIntakeCapabilities(
  capabilities: DesktopKnowledgeCapabilities,
): capabilities is DesktopKnowledgeCapabilities & KnowledgeIntakeCapabilities {
  return (
    capabilities.importCandidateKnowledgeFile !== undefined &&
    capabilities.importCandidateKnowledgeDirectory !== undefined &&
    capabilities.getCandidateKnowledgeReadiness !== undefined
  );
}

export function hasWorkspaceSourcesIntakeCapabilities(
  capabilities: DesktopKnowledgeCapabilities,
): capabilities is DesktopKnowledgeCapabilities & WorkspaceSourcesIntakeCapabilities {
  return (
    capabilities.importWorkspaceCandidateSources !== undefined &&
    capabilities.getCandidateKnowledgeReadiness !== undefined
  );
}

export function matchesKnowledgeBaseTarget(
  result: KnowledgeIntakeResult | KnowledgeReadinessResult,
  target: KnowledgeBaseTarget,
): boolean {
  return result.storeId === target.storeId && result.knowledgeBaseId === target.knowledgeBaseId;
}

export function knowledgeReadinessSummary(result: KnowledgeReadinessResult): string {
  const stateNote = result.state === "archived" ? " This knowledge base is archived." : "";
  return `Readiness: ${result.readyCount} ready, ${result.blockedCount} blocked of ${result.sourceCount} sources.${stateNote}`;
}

export function knowledgeIntakeSummary(result: KnowledgeIntakeResult): string {
  if ("kind" in result) {
    return result.created
      ? "File import complete. A career-evidence source was added."
      : "File import complete. An existing career-evidence source was reused.";
  }
  const directoryText =
    `Directory import ${result.status}: scanned ${result.scannedEntryCount} entries, ` +
    `found ${result.discoveredFileCount} files, skipped ${result.skippedEntryCount}, ` +
    `processed ${result.sourceCount} sources.`;
  return result.status === "partial"
    ? `${directoryText} Some content may not be available.`
    : directoryText;
}

export async function runKnowledgeIntake(input: {
  readonly workspaceId: string;
  readonly target: KnowledgeBaseTarget;
  readonly isCurrent: () => boolean;
  readonly importSource: () => Promise<KnowledgeIntakeResult>;
  readonly readReadiness: () => Promise<KnowledgeReadinessResult>;
  readonly refreshWorkspace: (workspaceId: string) => Promise<boolean>;
}): Promise<KnowledgeIntakeOutcome> {
  const result = await input.importSource();
  if (!matchesKnowledgeBaseTarget(result, input.target)) {
    throw new Error("Imported source result did not match the selected knowledge base");
  }
  if (!input.isCurrent()) return { status: "stale" };

  let readiness: KnowledgeReadinessResult | null = null;
  try {
    const found = await input.readReadiness();
    if (matchesKnowledgeBaseTarget(found, input.target)) readiness = found;
  } catch {
    // The import can succeed while readiness inspection is unavailable.
  }

  if (!input.isCurrent()) return { status: "stale" };
  try {
    const refreshed = await input.refreshWorkspace(input.workspaceId);
    if (!refreshed || !input.isCurrent()) return { status: "stale" };
  } catch {
    if (!input.isCurrent()) return { status: "stale" };
    return { status: "refresh-unavailable", result, readiness };
  }

  return readiness === null
    ? { status: "readiness-unavailable", result }
    : { status: "ready", result, readiness };
}
