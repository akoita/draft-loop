/**
 * Path-free bridge contracts for the local embedding model and the workspace retrieval mode.
 *
 * The renderer never receives a filesystem root: the model lives in DraftLoop application data
 * owned by the main process, and the renderer only ever sees this label for it.
 */

export const embeddingModelTiers = ["311m", "97m"] as const;
export type EmbeddingModelTier = (typeof embeddingModelTiers)[number];
export const defaultEmbeddingModelTier: EmbeddingModelTier = "311m";

export const embeddingModelStates = [
  "absent",
  "installing",
  "ready",
  "corrupt",
  "unsupported-platform",
] as const;
export type EmbeddingModelState = (typeof embeddingModelStates)[number];

export const retrievalModes = ["lexical", "semantic", "hybrid"] as const;
export type RetrievalMode = (typeof retrievalModes)[number];
export const defaultRetrievalMode: RetrievalMode = "lexical";

/** How the install approval names the destination, instead of a local path. */
export const embeddingModelDestinationLabel = "DraftLoop application data";

/** The fixed message a cancelled install reports; the renderer shows it as a status. */
export const embeddingModelInstallCancelledMessage =
  "The model download was cancelled. Nothing was installed.";

/** Binds a runtime key list to its interface so a missing or extra key is a compile error. */
function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export interface EmbeddingModelTierInput {
  readonly tier: EmbeddingModelTier;
}

export interface EmbeddingModelInstallInput {
  readonly tier: EmbeddingModelTier;
  /** The candidate confirmed the source, size, license, and destination. */
  readonly approved: true;
}

export interface EmbeddingModelStatusResult {
  readonly tier: EmbeddingModelTier;
  readonly state: EmbeddingModelState;
  readonly modelId: string;
  readonly revision: string;
  readonly license: string;
  readonly totalSizeBytes: number;
  readonly sourceUrl: string;
}

export interface EmbeddingModelPlanFile {
  readonly path: string;
  readonly sizeBytes: number;
}

export interface EmbeddingModelPlanResult {
  readonly tier: EmbeddingModelTier;
  readonly modelId: string;
  readonly revision: string;
  readonly license: string;
  readonly sourceUrl: string;
  readonly files: readonly EmbeddingModelPlanFile[];
  readonly totalSizeBytes: number;
}

/** Byte counts are present only once the running install has reported them. */
export interface EmbeddingModelProgressResult {
  readonly active: boolean;
  readonly receivedBytes?: number;
  readonly totalBytes?: number;
}

export interface EmbeddingModelCancelResult {
  readonly cancelled: boolean;
}

export interface WorkspaceRetrievalModeGetInput {
  readonly workspaceId: string;
}

export interface WorkspaceRetrievalModeSetInput {
  readonly workspaceId: string;
  readonly mode: RetrievalMode;
  readonly modelTier: EmbeddingModelTier;
}

export interface WorkspaceRetrievalModeResult {
  readonly workspaceId: string;
  readonly mode: RetrievalMode;
  readonly modelTier: EmbeddingModelTier;
  /** Absent while the defaults apply because no setting was ever saved. */
  readonly updatedAt?: string;
}

export const embeddingModelTierKeys = exactKeys<EmbeddingModelTierInput>()(["tier"]);
export const embeddingModelInstallKeys = exactKeys<EmbeddingModelInstallInput>()([
  "tier",
  "approved",
]);
export const embeddingModelStatusResultKeys = exactKeys<EmbeddingModelStatusResult>()([
  "tier",
  "state",
  "modelId",
  "revision",
  "license",
  "totalSizeBytes",
  "sourceUrl",
]);
export const embeddingModelPlanFileKeys = exactKeys<EmbeddingModelPlanFile>()([
  "path",
  "sizeBytes",
]);
export const embeddingModelPlanResultKeys = exactKeys<EmbeddingModelPlanResult>()([
  "tier",
  "modelId",
  "revision",
  "license",
  "sourceUrl",
  "files",
  "totalSizeBytes",
]);
export const embeddingModelProgressResultKeys = exactKeys<EmbeddingModelProgressResult>()([
  "active",
  "receivedBytes",
  "totalBytes",
]);
export const embeddingModelCancelResultKeys = exactKeys<EmbeddingModelCancelResult>()([
  "cancelled",
]);
export const workspaceRetrievalModeGetKeys = exactKeys<WorkspaceRetrievalModeGetInput>()([
  "workspaceId",
]);
export const workspaceRetrievalModeSetKeys = exactKeys<WorkspaceRetrievalModeSetInput>()([
  "workspaceId",
  "mode",
  "modelTier",
]);
export const workspaceRetrievalModeResultKeys = exactKeys<WorkspaceRetrievalModeResult>()([
  "workspaceId",
  "mode",
  "modelTier",
  "updatedAt",
]);
