import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import { t } from "@lingui/core/macro";
import type { ApplicationImportResult, ApplicationSummaryView } from "./application-contract.js";
import {
  type ApplicationFolderCapabilities,
  createApplicationFolderCapabilities,
} from "./application-folder-capabilities.js";
import {
  type ApplicationJobResult,
  type BridgeCommand,
  type BridgeResult,
  bridgeCapabilities,
  bridgeError,
  type CanonicalCandidateProfileCancelResult,
  type CanonicalCandidateProfileDeriveInput,
  type CanonicalCandidateProfileEditInput,
  type CanonicalCandidateProfileListResult,
  type CanonicalCandidateProfileProgressResult,
  type CanonicalCandidateProfileRecordResult,
  type CapabilityPort,
  createCapabilityPort,
  type KnowledgeCurrentResult,
  type KnowledgeDirectoryImportResult,
  type KnowledgeFileImportResult,
  type KnowledgeReadinessResult,
  type KnowledgeSelectionEntry,
  type KnowledgeSelectionResult,
  type KnowledgeStoreCreateInput,
  type KnowledgeStoreResult,
  type KnowledgeUrlImportResult,
  type KnowledgeWorkspaceSourcesImportInput,
  type MarkdownFileSaveResult,
  type ModelCandidate,
  type ModelCompany,
  type ModelDiscoveryProvider,
  type ModelProfileSupportResult,
  type ModelsListResult,
  type ModelsPreviewIndependenceResult,
  type NativeBridge,
  type OpportunityCancelResult,
  type OpportunityCreateInput,
  type OpportunityEditInput,
  type OpportunityLatestResult,
  type OpportunityListResult,
  type OpportunityRecordResult,
  type ProfileDerivationEstimateInput,
  type ProfileDerivationEstimateResult,
  type ProfileFreshnessResult,
  type ReviewedCanonicalCandidateProfileCatalogResult,
  type SavedCanonicalCandidateProfileSummary,
  type SavedModelProfilesResult,
  type SourceEvidenceKindSetInput,
  type SourceEvidenceKindSetResult,
  type SourceEvidenceKindsResult,
  type WorkspaceCompactHistoryResult,
  type WorkspaceConfigureModelsInput,
  type WritingPolicyReadResult,
} from "./bridge.js";
import type {
  KnowledgeEnsureDefaultResult,
  WorkspaceEvidenceMigrationResult,
} from "./career-evidence-contract.js";
import {
  createFactSuggestionCapabilities,
  type FactSuggestionCapabilities,
} from "./fact-suggestions-capabilities.js";
import {
  createFactUsageCapabilities,
  type FactUsageCapabilities,
} from "./fact-usage-capabilities.js";
import {
  createFixtureReviewPort,
  type DesktopReviewPort,
  type DesktopReviewState,
  type ReviewAction,
} from "./model.js";
import { createNativeStartupUnavailablePort, isElectronRendererRuntime } from "./native-startup.js";
import type { NewApplicationJob } from "./new-application-model.js";
import type { RunEvidenceModeView } from "./run-evidence-mode.js";
import {
  createRunRequirementEvidenceCapabilities,
  type RunRequirementEvidenceCapabilities,
} from "./run-requirement-evidence-capabilities.js";
import { createRunTraceCapabilities, type RunTraceCapabilities } from "./run-trace-capabilities.js";

export type { NativeBridge } from "./bridge.js";

/**
 * What a person chose for a workspace before it existed.
 *
 * A subset of `WorkspaceCreateInput`, holding only the fields the setup form
 * collects. Every field is optional and an omitted one keeps the workspace
 * default, so a caller that names nothing still creates the workspace the
 * single create button always created.
 */
export interface WorkspaceModelSelection {
  readonly authorCompany?: ModelCompany;
  readonly authorModel?: string;
  readonly criticCompany?: ModelCompany;
  readonly criticModel?: string;
  readonly localEndpoint?: string;
  readonly independenceOverrideRationale?: string;
  readonly maxRounds?: number;
}

/**
 * The setup form's own view of a port: choosing models, and asking about them.
 *
 * `listModels` and `previewIndependence` are present only when the host
 * actually offers the capability, so an absent one is a fact the form can
 * report rather than a call that fails later.
 */
export interface WorkspaceSetupCapabilities {
  readonly configureModels?: (
    workspaceId: string,
    selection: Omit<WorkspaceConfigureModelsInput, "workspaceId">,
  ) => Promise<DesktopReviewState>;
  /**
   * Reads the policy text to edit; a workspace without a policy gets the starting template.
   * A checksum reads that exact version from the workspace's history instead.
   */
  readonly readWritingPolicy?: (
    workspaceId: string,
    checksum?: string,
  ) => Promise<WritingPolicyReadResult>;
  /** Saves policy text as a new activated version and returns the refreshed review state. */
  readonly saveWritingPolicy?: (
    workspaceId: string,
    content: string,
  ) => Promise<DesktopReviewState>;
  readonly listModels?: (provider: ModelDiscoveryProvider) => Promise<ModelsListResult>;
  readonly previewIndependence?: (
    author: ModelCandidate,
    critic: ModelCandidate,
  ) => Promise<ModelsPreviewIndependenceResult>;
  readonly getModelProfileSupport?: (workspaceId: string) => Promise<ModelProfileSupportResult>;
  /** Reads the profile pair saved for the workspace, with why new runs would ignore it. */
  readonly readSavedModelProfiles?: (workspaceId: string) => Promise<SavedModelProfilesResult>;
  /** Saves the pair for future runs of the workspace, or clears it when `null`. */
  readonly saveModelProfiles?: (
    workspaceId: string,
    modelProfiles: ModelProfileReferences | null,
  ) => Promise<SavedModelProfilesResult>;
  /**
   * What evidence a start of the scoped application would send with this pair; `null` when there
   * is no preview. Asked for when the start confirmation opens.
   */
  readonly previewStartEvidence?: (
    workspaceId: string,
    modelProfiles: ModelProfileReferences | null,
  ) => Promise<RunEvidenceModeView | null>;
}

export interface DesktopOpportunityCapabilities {
  readonly createOpportunity?: (
    input: Omit<OpportunityCreateInput, "workspaceId">,
  ) => Promise<OpportunityRecordResult>;
  /** Aborts the workspace's in-flight extraction before it saves anything. */
  readonly cancelOpportunityExtraction?: () => Promise<OpportunityCancelResult>;
  readonly getOpportunity?: (briefId: string, version?: number) => Promise<OpportunityRecordResult>;
  readonly listOpportunityVersions?: (briefId: string) => Promise<OpportunityListResult>;
  /** The workspace's most recent opportunity brief (draft or reviewed), or `null` when none. */
  readonly getLatestOpportunity?: () => Promise<OpportunityLatestResult>;
  /** The job description of the loaded application, read back for the review screen. */
  readonly getApplicationJob?: () => Promise<ApplicationJobResult>;
  /** Saves a copy of the loaded application's job page: read once more, or the pasted text. */
  readonly saveApplicationJobCopy?: (text?: string) => Promise<ApplicationJobResult>;
  readonly editOpportunity?: (
    input: Omit<OpportunityEditInput, "workspaceId">,
  ) => Promise<OpportunityRecordResult>;
  readonly reviewOpportunity?: (
    briefId: string,
    expectedVersion: number,
  ) => Promise<OpportunityRecordResult>;
}

export interface DesktopProfileCapabilities {
  readonly deriveCanonicalCandidateProfile?: (
    input: Omit<CanonicalCandidateProfileDeriveInput, "workspaceId">,
  ) => Promise<CanonicalCandidateProfileRecordResult>;
  /** Reports a pending generation's bounded call progress; answerable while it runs. */
  readonly getCanonicalCandidateProfileProgress?: (
    profileId: string,
  ) => Promise<CanonicalCandidateProfileProgressResult>;
  /** Stops a pending generation before any further provider call; nothing is saved. */
  readonly cancelCanonicalCandidateProfileGeneration?: (
    profileId: string,
  ) => Promise<CanonicalCandidateProfileCancelResult>;
  readonly getCanonicalCandidateProfile?: (
    profileId: string,
    version?: number,
  ) => Promise<CanonicalCandidateProfileRecordResult>;
  readonly listCanonicalCandidateProfileVersions?: (
    profileId: string,
  ) => Promise<CanonicalCandidateProfileListResult>;
  readonly editCanonicalCandidateProfile?: (
    input: Omit<CanonicalCandidateProfileEditInput, "workspaceId">,
  ) => Promise<CanonicalCandidateProfileRecordResult>;
  readonly reviewCanonicalCandidateProfile?: (
    profileId: string,
    expectedVersion: number,
  ) => Promise<CanonicalCandidateProfileRecordResult>;
  readonly listReviewedCanonicalCandidateProfiles?: (
    workspaceId: string,
  ) => Promise<ReviewedCanonicalCandidateProfileCatalogResult>;
  /** Every saved profile (draft or reviewed), newest first. */
  readonly listCanonicalCandidateProfileSummaries?: (
    workspaceId: string,
  ) => Promise<readonly SavedCanonicalCandidateProfileSummary[]>;
  /** Whether a saved profile is current with the career evidence, as counts only. */
  readonly getCandidateProfileFreshness?: (
    workspaceId: string,
    profileId: string,
  ) => Promise<ProfileFreshnessResult>;
  /** What an update would send and roughly cost, before it starts (#3183). */
  readonly estimateCanonicalCandidateProfileDerivation?: (
    input: Omit<ProfileDerivationEstimateInput, "workspaceId">,
  ) => Promise<ProfileDerivationEstimateResult>;
  /** Where each fact may be used (#2259); absent on a host without usage levels. */
  readonly factUsage?: FactUsageCapabilities;
  /** Suggested profile updates (#3069); absent on a host without them. */
  readonly factSuggestions?: FactSuggestionCapabilities;
}

export interface DesktopKnowledgeCapabilities {
  readonly createCandidateKnowledgeStore?: (
    input: Omit<KnowledgeStoreCreateInput, "selection">,
  ) => Promise<KnowledgeStoreResult>;
  readonly openCandidateKnowledgeStore?: () => Promise<KnowledgeStoreResult>;
  readonly getCurrentCandidateKnowledge?: (workspaceId: string) => Promise<KnowledgeCurrentResult>;
  readonly selectCandidateKnowledgeBase?: (
    workspaceId: string,
    entry: KnowledgeSelectionEntry,
  ) => Promise<KnowledgeSelectionResult>;
  readonly importCandidateKnowledgeFile?: (
    storeId: string,
    knowledgeBaseId: string,
  ) => Promise<KnowledgeFileImportResult>;
  /** Saves typed or pasted text as one plain-text source; the call is the person's approval. */
  readonly importCandidateKnowledgeText?: (
    storeId: string,
    knowledgeBaseId: string,
    pasted: { readonly title: string; readonly text: string },
  ) => Promise<KnowledgeFileImportResult>;
  /** Fetches one public URL into the base; the call is the person's explicit approval. */
  readonly importCandidateKnowledgeUrl?: (
    storeId: string,
    knowledgeBaseId: string,
    url: string,
  ) => Promise<KnowledgeUrlImportResult>;
  readonly getCandidateKnowledgeReadiness?: (
    storeId: string,
    knowledgeBaseId: string,
  ) => Promise<KnowledgeReadinessResult>;
  /** Each current source's evidence kind, detected or set by the person. */
  readonly listSourceEvidenceKinds?: (
    storeId: string,
    knowledgeBaseId: string,
  ) => Promise<SourceEvidenceKindsResult>;
  /** Sets one source's evidence kind, or clears the override with null. */
  readonly setSourceEvidenceKind?: (
    input: SourceEvidenceKindSetInput,
  ) => Promise<SourceEvidenceKindSetResult>;
  readonly importWorkspaceCandidateSources?: (
    input: KnowledgeWorkspaceSourcesImportInput,
  ) => Promise<KnowledgeDirectoryImportResult>;
  /**
   * Creates the default store and base in DraftLoop application data when absent; no dialog. A
   * host without store folders also takes a name the person typed, and makes or reuses that base.
   */
  readonly ensureDefaultCandidateKnowledgeBase?: (
    workspaceId: string,
    displayName?: string,
  ) => Promise<KnowledgeEnsureDefaultResult>;
  /** Whether the person chose to keep using legacy workspace evidence for this workspace. */
  readonly getLegacyEvidenceMigration?: (
    workspaceId: string,
  ) => Promise<WorkspaceEvidenceMigrationResult>;
  readonly declineLegacyEvidenceMigration?: (
    workspaceId: string,
  ) => Promise<WorkspaceEvidenceMigrationResult>;
}

export type DesktopSetupPort = DesktopReviewPort &
  WorkspaceSetupCapabilities &
  DesktopOpportunityCapabilities &
  DesktopProfileCapabilities &
  DesktopKnowledgeCapabilities & {
    /**
     * Shrinks the workspace's run history behind a verified backup the host keeps beside it.
     * Resolves with the sizes and the backup's file name; refuses while a run is working.
     */
    readonly compactHistory?: (workspaceId: string) => Promise<WorkspaceCompactHistoryResult>;
  } & DesktopApplicationCapabilities;

/** Job applications inside the open workspace (ADR 0010), present when the host offers them. */
export interface DesktopApplicationCapabilities {
  readonly listApplications?: (workspaceId: string) => Promise<readonly ApplicationSummaryView[]>;
  /**
   * False when the host cannot fetch a job page for the person: New application then takes pasted
   * text or a file only. Both the desktop and the hosted service fetch an approved page (#1813).
   */
  readonly jobPagesAllowed?: boolean;
  /**
   * Creates an application and resolves with its summary. The job is pasted text, `{ url }`: a
   * job page the person approved fetching, read only when requirements are extracted, or
   * `{ file }`: an attached file whose text the host keeps as if pasted.
   */
  readonly createApplication?: (
    workspaceId: string,
    name: string,
    job: NewApplicationJob,
  ) => Promise<ApplicationSummaryView>;
  /**
   * Imports another workspace as an application. The host shows the native folder picker, so the
   * renderer never sends or receives a path; a cancelled picker rejects with `permission-denied`.
   */
  readonly importApplication?: (
    workspaceId: string,
  ) => Promise<Pick<ApplicationImportResult, "application" | "imported">>;
  /** Archives (`true`) or restores (`false`) an application and resolves with its summary. */
  readonly archiveApplication?: (
    workspaceId: string,
    applicationId: string,
    archived: boolean,
  ) => Promise<ApplicationSummaryView>;
  /** Renames an application, the default one included, and resolves with its summary. */
  readonly renameApplication?: (
    workspaceId: string,
    applicationId: string,
    name: string,
  ) => Promise<ApplicationSummaryView>;
  /** Deletes a created application that holds no run, brief or export. */
  readonly deleteApplication?: (workspaceId: string, applicationId: string) => Promise<void>;
  /** Folders that group applications on Home; absent on a host without them. */
  readonly applicationFolders?: ApplicationFolderCapabilities;
  /** Reads a run's trace for Run details; absent on a host that records none. */
  readonly runTrace?: RunTraceCapabilities;
  /** Reads which evidence supports each requirement of a run; absent on a host without it. */
  readonly runRequirementEvidence?: RunRequirementEvidenceCapabilities;
  /** Sets the model pair one application's new runs use, or clears it with `null`. */
  readonly setApplicationModels?: (
    workspaceId: string,
    applicationId: string,
    modelProfiles: ApplicationSummaryView["modelProfiles"],
  ) => Promise<ApplicationSummaryView>;
  /** Sets the language a created application's new runs write in, or clears it with `null`. */
  readonly setApplicationLanguage?: (
    workspaceId: string,
    applicationId: string,
    language: string | null,
  ) => Promise<ApplicationSummaryView>;
  /**
   * Scopes later loads and run starts to one application, or back to the workspace-wide view with
   * `null`. Opening another workspace clears the scope. `openRunId` opens that run of the
   * application instead of its latest, such as the run whose draft the person chose.
   */
  readonly selectApplication?: (applicationId: string | null, openRunId?: string) => void;
  /**
   * Opens one of the scoped application's runs, read-only when it is not the latest, and resolves
   * with its review; `null` returns to the latest run. Scoping another application, opening a
   * workspace or starting a review returns to the latest run too.
   */
  readonly openRun?: (runId: string | null) => Promise<DesktopReviewState>;
  /**
   * Reads one of the scoped application's runs for the run comparison. Unlike `openRun` it
   * leaves the review on the run it shows: later loads and changes still target that run.
   */
  readonly loadRunForComparison?: (runId: string) => Promise<DesktopReviewState>;
  /**
   * Uses one of the scoped application's runs for approval and export, with the person's
   * optional reason, then opens it; resolves with its review. Nothing about any run changes.
   */
  readonly chooseRun?: (
    workspaceId: string,
    runId: string,
    reason: string | null,
  ) => Promise<DesktopReviewState>;
  /**
   * Saves Markdown the renderer prepared, such as a run comparison, where the person picks in a
   * save dialog. Resolves with whether it was saved and the file's name.
   */
  readonly saveMarkdownFile?: (
    suggestedName: string,
    content: string,
  ) => Promise<MarkdownFileSaveResult>;
}

/**
 * Browser mode is intentionally capability-empty. It does not emulate a file
 * picker with browser filesystem APIs and it never accepts arbitrary paths.
 */
export function createBrowserNativeBridge(): NativeBridge {
  return Object.freeze({
    capabilities: Object.freeze([]),
    invoke: async (command: BridgeCommand): Promise<BridgeResult<unknown>> => ({
      ok: false,
      error: bridgeError("capability-unavailable", command.type),
    }),
  });
}

export function createNativeCapabilityPort(nativeBridge: NativeBridge): CapabilityPort {
  return createCapabilityPort(nativeBridge);
}

/** A deterministic, capability-empty port for the Vite/browser shell. */
export function createBrowserCapabilityPort(): CapabilityPort {
  return createCapabilityPort(createBrowserNativeBridge());
}

export class DesktopBridgeError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "DesktopBridgeError";
    this.code = code;
  }
}

function unwrap<Value>(result: BridgeResult<Value>): Value {
  if (result.ok) return result.value;
  throw new DesktopBridgeError(result.error.code, result.error.message);
}

export function createBridgeReviewPort(capabilityPort: CapabilityPort): DesktopSetupPort {
  // The application the review is scoped to; every load and run start carries it.
  let applicationId: string | undefined;
  // An earlier run of that application opened from the run list; undefined shows the latest.
  let runId: string | undefined;
  const scopeTo = (selected: string | undefined) => {
    applicationId = selected;
    runId = undefined;
  };
  const load = async (): Promise<DesktopReviewState> => {
    const result = await capabilityPort.execute({
      type: "review.load",
      input:
        applicationId === undefined
          ? {}
          : { applicationId, ...(runId === undefined ? {} : { runId }) },
    });
    return unwrap(result);
  };
  const refresh = async (): Promise<DesktopReviewState> => load();
  const applicationFolders = createApplicationFolderCapabilities(capabilityPort, unwrap);
  const factUsage = createFactUsageCapabilities(capabilityPort, unwrap);
  const factSuggestions = createFactSuggestionCapabilities(capabilityPort, unwrap);
  const runTrace = createRunTraceCapabilities(capabilityPort, unwrap);
  const runRequirementEvidence = createRunRequirementEvidenceCapabilities(capabilityPort, unwrap);
  return {
    load,
    ...(capabilityPort.hasCapability("export.write") ? {} : { exportsDownload: true }),
    ...(capabilityPort.hasCapability("file.save-markdown")
      ? {
          saveMarkdownFile: async (suggestedName: string, content: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "file.save-markdown",
                input: { suggestedName, content },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("application.list")
      ? {
          selectApplication: (selected: string | null, openRunId?: string) => {
            scopeTo(selected ?? undefined);
            if (selected !== null) runId = openRunId;
          },
          openRun: async (selected: string | null) => {
            runId = selected ?? undefined;
            try {
              return await load();
            } catch (error) {
              // A run that cannot be opened leaves the review on the latest run.
              runId = undefined;
              throw error;
            }
          },
          ...(capabilityPort.hasCapability("application.choose-run")
            ? {
                chooseRun: async (workspaceId: string, selected: string, reason: string | null) => {
                  if (applicationId === undefined) {
                    throw new Error(t`Open an application before choosing one of its runs.`);
                  }
                  unwrap(
                    await capabilityPort.execute({
                      type: "application.choose-run",
                      input: {
                        workspaceId,
                        applicationId,
                        runId: selected,
                        ...(reason === null ? {} : { reason }),
                      },
                    }),
                  );
                  runId = selected;
                  try {
                    return await load();
                  } catch (error) {
                    runId = undefined;
                    throw error;
                  }
                },
              }
            : {}),
          loadRunForComparison: async (selected: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "review.load",
                input:
                  applicationId === undefined
                    ? { runId: selected }
                    : { applicationId, runId: selected },
              }),
            ),
          listApplications: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({ type: "application.list", input: { workspaceId } }),
            ).applications,
        }
      : {}),
    ...(capabilityPort.hasCapability("application.create")
      ? {
          createApplication: async (workspaceId: string, name: string, job: NewApplicationJob) =>
            unwrap(
              await capabilityPort.execute({
                type: "application.create",
                input: {
                  workspaceId,
                  name,
                  ...(typeof job === "string"
                    ? { jobText: job }
                    : "file" in job
                      ? { jobFile: job.file }
                      : { jobUrl: job.url, jobUrlApproved: true as const }),
                },
              }),
            ).application,
        }
      : {}),
    ...(capabilityPort.hasCapability("application.import")
      ? {
          importApplication: async (workspaceId: string) => {
            const { application, imported } = unwrap(
              await capabilityPort.execute({
                type: "application.import",
                input: { workspaceId, selection: "native-dialog" },
              }),
            );
            return { application, imported };
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("application.archive")
      ? {
          archiveApplication: async (
            workspaceId: string,
            applicationId: string,
            archived: boolean,
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "application.archive",
                input: { workspaceId, applicationId, archived },
              }),
            ).application,
        }
      : {}),
    ...(capabilityPort.hasCapability("application.rename")
      ? {
          renameApplication: async (workspaceId: string, applicationId: string, name: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "application.rename",
                input: { workspaceId, applicationId, name },
              }),
            ).application,
        }
      : {}),
    ...(capabilityPort.hasCapability("application.set-models")
      ? {
          setApplicationModels: async (
            workspaceId: string,
            applicationId: string,
            modelProfiles: ApplicationSummaryView["modelProfiles"],
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "application.set-models",
                input: { workspaceId, applicationId, modelProfiles },
              }),
            ).application,
        }
      : {}),
    ...(capabilityPort.hasCapability("application.set-language")
      ? {
          setApplicationLanguage: async (
            workspaceId: string,
            applicationId: string,
            language: string | null,
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "application.set-language",
                input: { workspaceId, applicationId, language },
              }),
            ).application,
        }
      : {}),
    ...(applicationFolders === undefined ? {} : { applicationFolders }),
    ...(factUsage === undefined ? {} : { factUsage }),
    ...(factSuggestions === undefined ? {} : { factSuggestions }),
    ...(runTrace === undefined ? {} : { runTrace }),
    ...(runRequirementEvidence === undefined ? {} : { runRequirementEvidence }),
    ...(capabilityPort.hasCapability("application.delete")
      ? {
          deleteApplication: async (workspaceId: string, applicationId: string) => {
            unwrap(
              await capabilityPort.execute({
                type: "application.delete",
                input: { workspaceId, applicationId },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("workspace.configure-models")
      ? {
          configureModels: async (
            workspaceId: string,
            selection: Omit<WorkspaceConfigureModelsInput, "workspaceId">,
          ) => {
            unwrap(
              await capabilityPort.execute({
                type: "workspace.configure-models",
                input: { workspaceId, ...selection },
              }),
            );
            return refresh();
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("writing-policy.read")
      ? {
          readWritingPolicy: async (workspaceId: string, checksum?: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "writing-policy.read",
                input: { workspaceId, ...(checksum === undefined ? {} : { checksum }) },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("writing-policy.save")
      ? {
          saveWritingPolicy: async (workspaceId: string, content: string) => {
            unwrap(
              await capabilityPort.execute({
                type: "writing-policy.save",
                input: { workspaceId, content },
              }),
            );
            return refresh();
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("workspace.compact-history")
      ? {
          compactHistory: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "workspace.compact-history",
                input: { workspaceId },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("source.add-url")
      ? {
          addUrl: async (target, url) => {
            const state = await load();
            unwrap(
              await capabilityPort.execute({
                type: "source.add-url",
                input: { workspaceId: state.workspaceId, target, url, approved: true },
              }),
            );
            return refresh();
          },
        }
      : {}),
    dispatch: async (state: DesktopReviewState, action: ReviewAction) => {
      const result = await capabilityPort.execute({
        type: "review.dispatch",
        input: {
          workspaceId: state.workspaceId,
          runId: state.runId,
          action,
          ...(applicationId === undefined ? {} : { applicationId }),
        },
      });
      const next = unwrap(result);
      // A new review is the application's latest run, so later loads follow it.
      if (action.type === "start") runId = undefined;
      return next;
    },
    // A host that keeps no provider keys, such as the hosted service, offers none of these.
    ...(capabilityPort.hasCapability("models.list")
      ? {
          listModels: async (provider: ModelDiscoveryProvider) =>
            unwrap(await capabilityPort.execute({ type: "models.list", input: { provider } })),
        }
      : {}),
    ...(capabilityPort.hasCapability("models.preview-independence")
      ? {
          previewIndependence: async (author: ModelCandidate, critic: ModelCandidate) =>
            unwrap(
              await capabilityPort.execute({
                type: "models.preview-independence",
                input: { author, critic },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("review.preview-evidence")
      ? {
          previewStartEvidence: async (
            workspaceId: string,
            modelProfiles: ModelProfileReferences | null,
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "review.preview-evidence",
                input: {
                  workspaceId,
                  ...(applicationId === undefined ? {} : { applicationId }),
                  ...(modelProfiles === null ? {} : { modelProfiles }),
                },
              }),
            ).preview,
        }
      : {}),
    ...(capabilityPort.hasCapability("models.profile-support")
      ? {
          getModelProfileSupport: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "models.profile-support",
                input: { workspaceId },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("models.saved-profiles.read")
      ? {
          readSavedModelProfiles: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "models.saved-profiles.read",
                input: { workspaceId },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("models.saved-profiles.save")
      ? {
          saveModelProfiles: async (
            workspaceId: string,
            modelProfiles: ModelProfileReferences | null,
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "models.saved-profiles.save",
                input: { workspaceId, modelProfiles },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.create")
      ? {
          createCandidateKnowledgeStore: async (
            input: Omit<KnowledgeStoreCreateInput, "selection">,
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.create",
                input: { selection: "native-dialog", ...input },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.open")
      ? {
          openCandidateKnowledgeStore: async () =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.open",
                input: { selection: "native-dialog" },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.current")
      ? {
          getCurrentCandidateKnowledge: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.current",
                input: { workspaceId },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.select")
      ? {
          selectCandidateKnowledgeBase: async (
            workspaceId: string,
            entry: KnowledgeSelectionEntry,
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.select",
                input: { workspaceId, entries: [entry] },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.import-file")
      ? {
          importCandidateKnowledgeFile: async (storeId: string, knowledgeBaseId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.import-file",
                input: { storeId, knowledgeBaseId, selection: "native-dialog" },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.import-text")
      ? {
          importCandidateKnowledgeText: async (
            storeId: string,
            knowledgeBaseId: string,
            pasted: { readonly title: string; readonly text: string },
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.import-text",
                input: { storeId, knowledgeBaseId, title: pasted.title, text: pasted.text },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.import-url")
      ? {
          importCandidateKnowledgeUrl: async (
            storeId: string,
            knowledgeBaseId: string,
            url: string,
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.import-url",
                input: { storeId, knowledgeBaseId, url, approved: true },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.readiness")
      ? {
          getCandidateKnowledgeReadiness: async (storeId: string, knowledgeBaseId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.readiness",
                input: { storeId, knowledgeBaseId },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.source-evidence-kinds")
      ? {
          listSourceEvidenceKinds: async (storeId: string, knowledgeBaseId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.source-evidence-kinds",
                input: { storeId, knowledgeBaseId },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.source-evidence-kind.set")
      ? {
          setSourceEvidenceKind: async (input: SourceEvidenceKindSetInput) =>
            unwrap(
              await capabilityPort.execute({ type: "knowledge.source-evidence-kind.set", input }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.import-workspace-sources")
      ? {
          importWorkspaceCandidateSources: async (input: KnowledgeWorkspaceSourcesImportInput) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.import-workspace-sources",
                input,
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("knowledge.ensure-default")
      ? {
          ensureDefaultCandidateKnowledgeBase: async (workspaceId: string, displayName?: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.ensure-default",
                input: displayName === undefined ? { workspaceId } : { workspaceId, displayName },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("workspace.evidence-migration.get")
      ? {
          getLegacyEvidenceMigration: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "workspace.evidence-migration.get",
                input: { workspaceId },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("workspace.evidence-migration.decline")
      ? {
          declineLegacyEvidenceMigration: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "workspace.evidence-migration.decline",
                input: { workspaceId },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.create")
      ? {
          createOpportunity: async (input: Omit<OpportunityCreateInput, "workspaceId">) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.create",
                input: {
                  workspaceId: state.workspaceId,
                  ...input,
                  ...(applicationId === undefined ? {} : { applicationId }),
                },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.cancel")
      ? {
          cancelOpportunityExtraction: async () => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.cancel",
                input: { workspaceId: state.workspaceId },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.get")
      ? {
          getOpportunity: async (briefId: string, version?: number) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.get",
                input: {
                  workspaceId: state.workspaceId,
                  briefId,
                  ...(version === undefined ? {} : { version }),
                },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.list")
      ? {
          listOpportunityVersions: async (briefId: string) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.list",
                input: { workspaceId: state.workspaceId, briefId },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.latest")
      ? {
          getLatestOpportunity: async () => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.latest",
                input: {
                  workspaceId: state.workspaceId,
                  ...(applicationId === undefined ? {} : { applicationId }),
                },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("application.job-copy")
      ? {
          saveApplicationJobCopy: async (text?: string) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "application.job-copy",
                input: {
                  workspaceId: state.workspaceId,
                  ...(applicationId === undefined ? {} : { applicationId }),
                  ...(text === undefined ? {} : { text }),
                },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("application.job")
      ? {
          getApplicationJob: async () => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "application.job",
                input: {
                  workspaceId: state.workspaceId,
                  ...(applicationId === undefined ? {} : { applicationId }),
                },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.edit")
      ? {
          editOpportunity: async (input: Omit<OpportunityEditInput, "workspaceId">) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.edit",
                input: {
                  workspaceId: state.workspaceId,
                  ...input,
                  ...(applicationId === undefined ? {} : { applicationId }),
                },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("opportunity.review")
      ? {
          reviewOpportunity: async (briefId: string, expectedVersion: number) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "opportunity.review",
                input: {
                  workspaceId: state.workspaceId,
                  briefId,
                  expectedVersion,
                  ...(applicationId === undefined ? {} : { applicationId }),
                },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.derive")
      ? {
          deriveCanonicalCandidateProfile: async (
            input: Omit<CanonicalCandidateProfileDeriveInput, "workspaceId">,
          ) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "profile.derive",
                input: { workspaceId: state.workspaceId, ...input },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.progress")
      ? {
          getCanonicalCandidateProfileProgress: async (profileId: string) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "profile.progress",
                input: { workspaceId: state.workspaceId, profileId },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.cancel")
      ? {
          cancelCanonicalCandidateProfileGeneration: async (profileId: string) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "profile.cancel",
                input: { workspaceId: state.workspaceId, profileId },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.get")
      ? {
          getCanonicalCandidateProfile: async (profileId: string, version?: number) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "profile.get",
                input: {
                  workspaceId: state.workspaceId,
                  profileId,
                  ...(version === undefined ? {} : { version }),
                },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.list")
      ? {
          listCanonicalCandidateProfileVersions: async (profileId: string) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "profile.list",
                input: { workspaceId: state.workspaceId, profileId },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.freshness")
      ? {
          getCandidateProfileFreshness: async (workspaceId: string, profileId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "profile.freshness",
                input: { workspaceId, profileId },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.estimate")
      ? {
          estimateCanonicalCandidateProfileDerivation: async (
            input: Omit<ProfileDerivationEstimateInput, "workspaceId">,
          ) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "profile.estimate",
                input: { workspaceId: state.workspaceId, ...input },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.catalog")
      ? {
          listReviewedCanonicalCandidateProfiles: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "profile.catalog",
                input: { workspaceId },
              }),
            ),
          listCanonicalCandidateProfileSummaries: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "profile.catalog",
                input: { workspaceId, includeDrafts: true },
              }),
            ).summaries ?? [],
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.edit")
      ? {
          editCanonicalCandidateProfile: async (
            input: Omit<CanonicalCandidateProfileEditInput, "workspaceId">,
          ) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "profile.edit",
                input: { workspaceId: state.workspaceId, ...input },
              }),
            );
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("profile.review")
      ? {
          reviewCanonicalCandidateProfile: async (profileId: string, expectedVersion: number) => {
            const state = await load();
            return unwrap(
              await capabilityPort.execute({
                type: "profile.review",
                input: { workspaceId: state.workspaceId, profileId, expectedVersion },
              }),
            );
          },
        }
      : {}),
  };
}

export interface DesktopReviewPortStartupOptions {
  /** Override the preload bridge for tests and isolated renderer startup. */
  readonly nativeBridge?: unknown;
  /** Override runtime detection without granting additional bridge capability. */
  readonly electronRuntime?: boolean;
}

/** Uses a host-backed review port when available; only browser mode gets the fixture. */
export function createDesktopReviewPort(
  options: DesktopReviewPortStartupOptions = {},
): DesktopSetupPort {
  const nativeBridge =
    "nativeBridge" in options ? options.nativeBridge : getNativeBridgeCandidate();
  const electronRuntime = options.electronRuntime ?? isElectronRendererRuntime();

  if (isNativeBridge(nativeBridge)) {
    const capabilityPort = createNativeCapabilityPort(nativeBridge);
    if (
      capabilityPort.hasCapability("review.load") &&
      capabilityPort.hasCapability("review.dispatch")
    ) {
      return createBridgeReviewPort(capabilityPort);
    }
  }

  return electronRuntime ? createNativeStartupUnavailablePort() : createFixtureReviewPort();
}

const nativeBridgeGlobalKey = "__DRAFT_LOOP_NATIVE_BRIDGE__";

function isNativeBridge(value: unknown): value is NativeBridge {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as {
    readonly capabilities?: unknown;
    readonly invoke?: unknown;
  };
  if (!Array.isArray(candidate.capabilities) || typeof candidate.invoke !== "function") {
    return false;
  }
  return candidate.capabilities.every((capability) =>
    (bridgeCapabilities as readonly string[]).includes(capability as string),
  );
}

/**
 * Resolves an optional host-injected bridge, falling back to browser mode.
 * The Electron preload installs a NativeBridge at this key after the host has
 * applied its permission, filesystem-scope, and user-gesture checks.
 */
export function getNativeBridge(): NativeBridge {
  const candidate = getNativeBridgeCandidate();
  return isNativeBridge(candidate) ? candidate : createBrowserNativeBridge();
}

function getNativeBridgeCandidate(): unknown {
  return (globalThis as Record<string, unknown>)[nativeBridgeGlobalKey];
}
