import { resolve } from "node:path";

import type { ContextSnapshot } from "@draft-loop/domain";

import { candidateKnowledgeRuntimeRetrieval } from "./candidate-knowledge-retrieval.js";
import { resolveProviderAuthModes } from "./glm-provider-routing.js";
import type { ModelProfileReferences } from "./index.js";
import type { LocalApplicationDriverOptions } from "./local.js";
import { readWorkspace, validateConfiguredKnowledgeSelection } from "./local.js";
import { resolveRequestedRunModelProfiles } from "./run-model-profiles.js";
import { modelConfiguration } from "./run-model-selection.js";
import { runSensitivityExclusions } from "./run-sensitivity-exclusions.js";
import { readWorkspaceEvidenceMode } from "./workspace-evidence-mode.js";

/**
 * What evidence a run started now would send, worked out before any run exists: the same
 * full-source decision a started run records in its `run.evidence-mode` event, without writing
 * history or calling a provider. A start confirmation shows it so the person sees the mode and size
 * before the provider calls begin.
 */
export interface EvidenceModePreviewCommand {
  readonly root: string;
  /**
   * The application the run would belong to. An application changes only the job, so it does not
   * change the result; the knowledge selection, evidence mode and consent are workspace settings.
   */
  readonly applicationId?: string;
  /** The exact pair the start would apply; omitted means no profiles, as for such a start. */
  readonly modelProfiles?: ModelProfileReferences;
}

export interface EvidenceModePreview {
  readonly requestedMode: "retrieval" | "full-source";
  readonly effectiveMode: "retrieval" | "full-source";
  /** Eligible chunks of the pinned sources; zero when retrieval is requested. */
  readonly chunkCount: number;
  /** Distinct sources among those chunks; absent when retrieval is requested. */
  readonly sourceCount?: number;
  readonly fallbackReason?: "budget-exceeded" | "no-eligible-chunks";
}

/** The run's trace port, which a decision never reaches; a preview must not write history. */
const previewStorage = {
  appendCandidateKnowledgeRetrievalTrace: async (): Promise<never> => {
    throw new Error("An evidence-mode preview does not record retrieval traces.");
  },
};

/**
 * The evidence decision for a new run, or `undefined` when the workspace has no candidate knowledge
 * selection (such a run uses its legacy workspace evidence). Unreadable settings throw, as they stop
 * a start.
 */
export async function previewEvidenceMode(
  command: EvidenceModePreviewCommand,
  options: Pick<
    LocalApplicationDriverOptions,
    "modelProfileRegistry" | "providerAuthMode" | "providerAuthModeConfiguration"
  > = {},
): Promise<EvidenceModePreview | undefined> {
  const root = resolve(command.root);
  const config = await readWorkspace(root);
  const selection = await validateConfiguredKnowledgeSelection(config.candidateKnowledgeSelection);
  if (selection === undefined) return undefined;
  const { mode } = await readWorkspaceEvidenceMode(root);
  const profiles = resolveRequestedRunModelProfiles(
    command.modelProfiles,
    options.modelProfileRegistry,
    options.providerAuthModeConfiguration ?? resolveProviderAuthModes(options.providerAuthMode),
  );
  const configured = modelConfiguration(config);
  // The decision reads only the selection and the pair's profiles from the run context.
  const context = {
    candidateKnowledgeSelection: selection,
    modelConfiguration: {
      ...configured,
      author:
        profiles === undefined
          ? configured.author
          : { ...configured.author, profile: profiles.author },
      critic:
        profiles === undefined
          ? configured.critic
          : { ...configured.critic, profile: profiles.critic },
    },
  } as unknown as ContextSnapshot;
  const withheld = await runSensitivityExclusions(root, config, context);
  const runtime = candidateKnowledgeRuntimeRetrieval(
    previewStorage,
    config,
    context,
    withheld,
    mode,
  );
  if (runtime === undefined) return undefined;
  const { requestedMode, effectiveMode, chunkCount, sourceCount, fallbackReason } =
    await runtime.evidenceModeDecision();
  return {
    requestedMode,
    effectiveMode,
    chunkCount,
    ...(sourceCount === undefined ? {} : { sourceCount }),
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
  };
}
