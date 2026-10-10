import type { ModelProfileReferences } from "@draft-loop/application/model-profile-selection";
import type { ApplicationImportResult, ApplicationSummaryView } from "./application-contract.js";

import {
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
  type EmbeddingModelCancelResult,
  type EmbeddingModelPlanResult,
  type EmbeddingModelProgressResult,
  type EmbeddingModelStatusResult,
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
  type ProfileFreshnessResult,
  type ProviderAuthMode,
  type ProviderAuthModeResult,
  type ProviderAuthModeStatus,
  type ReviewedCanonicalCandidateProfileCatalogResult,
  type SavedCanonicalCandidateProfileSummary,
  type SavedModelProfilesResult,
  type SourceEvidenceKindSetInput,
  type SourceEvidenceKindSetResult,
  type SourceEvidenceKindsResult,
  type WorkspaceConfigureModelsInput,
  type WorkspaceCreateInput,
  type WorkspaceRetrievalModeResult,
  type WritingPolicyReadResult,
} from "./bridge.js";
import type {
  KnowledgeEnsureDefaultResult,
  WorkspaceEvidenceMigrationResult,
} from "./career-evidence-contract.js";
import {
  createFixtureReviewPort,
  type DesktopReviewPort,
  type DesktopReviewState,
  type ReviewAction,
} from "./model.js";
import { createNativeStartupUnavailablePort, isElectronRendererRuntime } from "./native-startup.js";
import {
  parseRecentWorkspacesListResult,
  type RecentWorkspaceSummary,
} from "./recent-workspaces.js";
import type { EmbeddingModelTier, RetrievalMode } from "./semantic-retrieval-contract.js";

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
 * `createWorkspace` is widened here rather than in `DesktopReviewPort` so that
 * a fixture port written against the narrower signature stays assignable; a
 * function that ignores the second argument satisfies one that offers it.
 * `listModels` and `previewIndependence` are present only when the host
 * actually offers the capability, so an absent one is a fact the form can
 * report rather than a call that fails later.
 */
export interface WorkspaceSetupCapabilities {
  readonly createWorkspace?: (
    name: string,
    selection?: WorkspaceModelSelection,
  ) => Promise<DesktopReviewState>;
  readonly configureModels?: (
    workspaceId: string,
    selection: Omit<WorkspaceConfigureModelsInput, "workspaceId">,
  ) => Promise<DesktopReviewState>;
  /** Reads the policy text to edit; a workspace without a policy gets the starting template. */
  readonly readWritingPolicy?: (workspaceId: string) => Promise<WritingPolicyReadResult>;
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
  readonly importCandidateKnowledgeDirectory?: (
    storeId: string,
    knowledgeBaseId: string,
  ) => Promise<KnowledgeDirectoryImportResult>;
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
  /** Creates the default store and base in DraftLoop application data when absent; no dialog. */
  readonly ensureDefaultCandidateKnowledgeBase?: (
    workspaceId: string,
  ) => Promise<KnowledgeEnsureDefaultResult>;
  /** Whether the person chose to keep using legacy workspace evidence for this workspace. */
  readonly getLegacyEvidenceMigration?: (
    workspaceId: string,
  ) => Promise<WorkspaceEvidenceMigrationResult>;
  readonly declineLegacyEvidenceMigration?: (
    workspaceId: string,
  ) => Promise<WorkspaceEvidenceMigrationResult>;
}

/**
 * The local embedding model and the workspace retrieval mode, through the same application
 * contracts as the CLI. Each member is present only when the host offers the capability, so an
 * absent one is a fact the panel can report rather than a call that fails later.
 */
export interface DesktopSemanticRetrievalCapabilities {
  readonly getEmbeddingModelStatus?: (
    tier: EmbeddingModelTier,
  ) => Promise<EmbeddingModelStatusResult>;
  /** What an install would download, shown at the approval step; it downloads nothing. */
  readonly planEmbeddingModelInstall?: (
    tier: EmbeddingModelTier,
  ) => Promise<EmbeddingModelPlanResult>;
  /** Downloads the model; the call is the explicit approval, so it carries `approved: true`. */
  readonly installEmbeddingModel?: (
    tier: EmbeddingModelTier,
  ) => Promise<EmbeddingModelStatusResult>;
  /** Reports a pending install's byte progress; answerable while it runs. */
  readonly getEmbeddingModelProgress?: (
    tier: EmbeddingModelTier,
  ) => Promise<EmbeddingModelProgressResult>;
  /** Stops a pending install; nothing is kept. */
  readonly cancelEmbeddingModelInstall?: (
    tier: EmbeddingModelTier,
  ) => Promise<EmbeddingModelCancelResult>;
  readonly removeEmbeddingModel?: (tier: EmbeddingModelTier) => Promise<EmbeddingModelStatusResult>;
  readonly getRetrievalMode?: (workspaceId: string) => Promise<WorkspaceRetrievalModeResult>;
  readonly setRetrievalMode?: (
    workspaceId: string,
    mode: RetrievalMode,
    modelTier: EmbeddingModelTier,
  ) => Promise<WorkspaceRetrievalModeResult>;
}

export type DesktopSetupPort = Omit<DesktopReviewPort, "createWorkspace"> &
  DesktopSemanticRetrievalCapabilities &
  WorkspaceSetupCapabilities &
  DesktopOpportunityCapabilities &
  DesktopProfileCapabilities &
  DesktopKnowledgeCapabilities & {
    readonly getProviderAuthModeStatus?: (
      provider: "anthropic" | "openai",
    ) => Promise<ProviderAuthModeStatus>;
    readonly setProviderAuthMode?: (
      provider: "anthropic" | "openai",
      mode: ProviderAuthMode,
    ) => Promise<ProviderAuthModeResult>;
    readonly listRecentWorkspaces?: () => Promise<readonly RecentWorkspaceSummary[]>;
    readonly openRecentWorkspace?: (id: string) => Promise<DesktopReviewState>;
    readonly clearRecentWorkspaces?: () => Promise<void>;
    /** Renames the open workspace and resolves with the stored name. */
    readonly renameWorkspace?: (workspaceId: string, name: string) => Promise<string>;
  } & DesktopApplicationCapabilities;

/** Job applications inside the open workspace (ADR 0010), present when the host offers them. */
export interface DesktopApplicationCapabilities {
  readonly listApplications?: (workspaceId: string) => Promise<readonly ApplicationSummaryView[]>;
  /**
   * Creates an application and resolves with its summary. The job is pasted text, or `{ url }`:
   * a job page the person approved fetching, read only when requirements are extracted.
   */
  readonly createApplication?: (
    workspaceId: string,
    name: string,
    job: string | { readonly url: string },
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
  /** Deletes a created application that holds no run, brief or export. */
  readonly deleteApplication?: (workspaceId: string, applicationId: string) => Promise<void>;
  /** Sets the model pair one application's new runs use, or clears it with `null`. */
  readonly setApplicationModels?: (
    workspaceId: string,
    applicationId: string,
    modelProfiles: ApplicationSummaryView["modelProfiles"],
  ) => Promise<ApplicationSummaryView>;
  /**
   * Scopes later loads and run starts to one application, or back to the workspace-wide view with
   * `null`. Opening another workspace clears the scope.
   */
  readonly selectApplication?: (applicationId: string | null) => void;
}

/**
 * Fills `workspace.create` in from a form's strings.
 *
 * A field left blank means "keep the workspace default", so a blank is dropped
 * rather than sent as an empty string the boundary would refuse. Trimming
 * happens here because a person typing a model id into a form leaves spaces
 * behind and the boundary's `modelId` rule does not forgive them.
 */
export function workspaceCreateInput(
  name: string,
  selection?: WorkspaceModelSelection,
): WorkspaceCreateInput {
  const named = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? undefined : trimmed;
  };
  const authorModel = named(selection?.authorModel);
  const criticModel = named(selection?.criticModel);
  const localEndpoint = named(selection?.localEndpoint);
  const rationale = named(selection?.independenceOverrideRationale);
  return {
    name: name.trim(),
    mode: "real",
    ...(selection?.authorCompany === undefined ? {} : { authorCompany: selection.authorCompany }),
    ...(authorModel === undefined ? {} : { authorModel }),
    ...(selection?.criticCompany === undefined ? {} : { criticCompany: selection.criticCompany }),
    ...(criticModel === undefined ? {} : { criticModel }),
    ...(localEndpoint === undefined ? {} : { localEndpoint }),
    ...(rationale === undefined ? {} : { independenceOverrideRationale: rationale }),
    ...(selection?.maxRounds === undefined ? {} : { maxRounds: selection.maxRounds }),
  };
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
  const load = async (): Promise<DesktopReviewState> => {
    const result = await capabilityPort.execute({
      type: "review.load",
      input: applicationId === undefined ? {} : { applicationId },
    });
    return unwrap(result);
  };
  const ensureRun = async (workspaceId: string): Promise<DesktopReviewState> => {
    const status = unwrap(
      await capabilityPort.execute({ type: "run.status", input: { workspaceId } }),
    );
    if (status.runId === null) {
      unwrap(await capabilityPort.execute({ type: "run.start", input: { workspaceId } }));
    }
    return load();
  };
  const refresh = async (): Promise<DesktopReviewState> => load();
  return {
    load,
    openWorkspace: async () => {
      unwrap(
        await capabilityPort.execute({
          type: "workspace.open",
          input: { selection: "native-dialog" },
        }),
      );
      applicationId = undefined;
      return refresh();
    },
    createWorkspace: async (name, selection) => {
      unwrap(
        await capabilityPort.execute({
          type: "workspace.create",
          input: workspaceCreateInput(name, selection),
        }),
      );
      applicationId = undefined;
      return refresh();
    },
    ...(capabilityPort.hasCapability("application.list")
      ? {
          selectApplication: (selected: string | null) => {
            applicationId = selected ?? undefined;
          },
          listApplications: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({ type: "application.list", input: { workspaceId } }),
            ).applications,
        }
      : {}),
    ...(capabilityPort.hasCapability("application.create")
      ? {
          createApplication: async (
            workspaceId: string,
            name: string,
            job: string | { readonly url: string },
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "application.create",
                input: {
                  workspaceId,
                  name,
                  ...(typeof job === "string"
                    ? { jobText: job }
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
          readWritingPolicy: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "writing-policy.read",
                input: { workspaceId },
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
    ...(capabilityPort.hasCapability("workspace.recent-list")
      ? {
          listRecentWorkspaces: async () =>
            parseRecentWorkspacesListResult(
              unwrap(await capabilityPort.execute({ type: "workspace.recent-list", input: {} })),
            ).workspaces,
        }
      : {}),
    ...(capabilityPort.hasCapability("workspace.recent-open")
      ? {
          openRecentWorkspace: async (id: string) => {
            unwrap(await capabilityPort.execute({ type: "workspace.recent-open", input: { id } }));
            applicationId = undefined;
            return refresh();
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("workspace.recent-clear")
      ? {
          clearRecentWorkspaces: async () => {
            unwrap(await capabilityPort.execute({ type: "workspace.recent-clear", input: {} }));
          },
        }
      : {}),
    ...(capabilityPort.hasCapability("workspace.rename")
      ? {
          renameWorkspace: async (workspaceId: string, name: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "workspace.rename",
                input: { workspaceId, name },
              }),
            ).name,
        }
      : {}),
    createDemoWorkspace: async (name) => {
      const result = unwrap(
        await capabilityPort.execute({ type: "workspace.create", input: { name, mode: "demo" } }),
      );
      applicationId = undefined;
      return ensureRun(result.workspace.id);
    },
    selectFiles: async (target) => {
      const state = await load();
      unwrap(
        await capabilityPort.execute({
          type: "file.select",
          input: {
            workspaceId: state.workspaceId,
            target,
            ...(target === "job-description" ||
            target === "writing-policy" ||
            target === "writing-policy-override"
              ? { multiple: false }
              : {}),
            ...(target === "writing-policy" || target === "writing-policy-override"
              ? { extensions: [".md", ".markdown", ".txt", ".text"] as const }
              : {}),
          },
        }),
      );
      return refresh();
    },
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
      return unwrap(result);
    },
    getCredentialStatus: async (provider) => {
      const result = await capabilityPort.execute({
        type: "credential.status",
        input: { provider },
      });
      return unwrap(result);
    },
    setCredential: async (provider, apiKey) => {
      const result = await capabilityPort.execute({
        type: "credential.set",
        input: { provider, apiKey },
      });
      return unwrap(result);
    },
    removeCredential: async (provider) => {
      const result = await capabilityPort.execute({
        type: "credential.remove",
        input: { provider },
      });
      return unwrap(result);
    },
    ...(capabilityPort.hasCapability("provider-auth.status")
      ? {
          getProviderAuthModeStatus: async (provider: "anthropic" | "openai") =>
            unwrap(
              await capabilityPort.execute({
                type: "provider-auth.status",
                input: { provider },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("provider-auth.set")
      ? {
          setProviderAuthMode: async (provider: "anthropic" | "openai", mode: ProviderAuthMode) =>
            unwrap(
              await capabilityPort.execute({
                type: "provider-auth.set",
                input: { provider, mode },
              }),
            ),
        }
      : {}),
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
    ...(capabilityPort.hasCapability("embedding-model.status")
      ? {
          getEmbeddingModelStatus: async (tier: EmbeddingModelTier) =>
            unwrap(
              await capabilityPort.execute({ type: "embedding-model.status", input: { tier } }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("embedding-model.plan-install")
      ? {
          planEmbeddingModelInstall: async (tier: EmbeddingModelTier) =>
            unwrap(
              await capabilityPort.execute({
                type: "embedding-model.plan-install",
                input: { tier },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("embedding-model.install")
      ? {
          installEmbeddingModel: async (tier: EmbeddingModelTier) =>
            unwrap(
              await capabilityPort.execute({
                type: "embedding-model.install",
                input: { tier, approved: true },
              }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("embedding-model.progress")
      ? {
          getEmbeddingModelProgress: async (tier: EmbeddingModelTier) =>
            unwrap(
              await capabilityPort.execute({ type: "embedding-model.progress", input: { tier } }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("embedding-model.cancel")
      ? {
          cancelEmbeddingModelInstall: async (tier: EmbeddingModelTier) =>
            unwrap(
              await capabilityPort.execute({ type: "embedding-model.cancel", input: { tier } }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("embedding-model.remove")
      ? {
          removeEmbeddingModel: async (tier: EmbeddingModelTier) =>
            unwrap(
              await capabilityPort.execute({ type: "embedding-model.remove", input: { tier } }),
            ),
        }
      : {}),
    ...(capabilityPort.hasCapability("workspace.retrieval-mode.get")
      ? {
          getRetrievalMode: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "workspace.retrieval-mode.get",
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
    ...(capabilityPort.hasCapability("workspace.retrieval-mode.set")
      ? {
          setRetrievalMode: async (
            workspaceId: string,
            mode: RetrievalMode,
            modelTier: EmbeddingModelTier,
          ) =>
            unwrap(
              await capabilityPort.execute({
                type: "workspace.retrieval-mode.set",
                input: { workspaceId, mode, modelTier },
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
    ...(capabilityPort.hasCapability("knowledge.import-directory")
      ? {
          importCandidateKnowledgeDirectory: async (storeId: string, knowledgeBaseId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.import-directory",
                input: { storeId, knowledgeBaseId, selection: "native-dialog" },
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
          ensureDefaultCandidateKnowledgeBase: async (workspaceId: string) =>
            unwrap(
              await capabilityPort.execute({
                type: "knowledge.ensure-default",
                input: { workspaceId },
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
