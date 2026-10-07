/**
 * Path-free bridge contracts for creating the workspace's career-evidence knowledge base
 * automatically and for remembering a declined one-time import of legacy evidence.
 *
 * The renderer never receives the default store's location: the main process owns it and the
 * renderer only ever sees `defaultKnowledgeStoreDestinationLabel`.
 */

/** How the created-base notice names the store's location, instead of a local path. */
export const defaultKnowledgeStoreDestinationLabel = "DraftLoop application data";

/** Binds a runtime key list to its interface so a missing or extra key is a compile error. */
function exactKeys<Shape extends object>() {
  return <const Keys extends readonly (keyof Shape & string)[]>(
    keys: Keys & {
      readonly [Key in Exclude<keyof Shape, Keys[number]>]: "add this key to the runtime key list";
    },
  ): Keys => keys;
}

export interface KnowledgeEnsureDefaultInput {
  readonly workspaceId: string;
}

/**
 * The default knowledge base, ready to receive sources. `created` is true when this call made the
 * store or the base, so the renderer can say so once.
 */
export interface KnowledgeEnsureDefaultResult {
  readonly storeId: string;
  readonly knowledgeBaseId: string;
  readonly displayName: string;
  readonly created: boolean;
}

export interface WorkspaceEvidenceMigrationInput {
  readonly workspaceId: string;
}

export interface WorkspaceEvidenceMigrationResult {
  readonly workspaceId: string;
  /** True once the person chose to keep using legacy workspace evidence. */
  readonly declined: boolean;
}

export const knowledgeEnsureDefaultKeys = exactKeys<KnowledgeEnsureDefaultInput>()(["workspaceId"]);
export const knowledgeEnsureDefaultResultKeys = exactKeys<KnowledgeEnsureDefaultResult>()([
  "storeId",
  "knowledgeBaseId",
  "displayName",
  "created",
]);
export const workspaceEvidenceMigrationKeys = exactKeys<WorkspaceEvidenceMigrationInput>()([
  "workspaceId",
]);
export const workspaceEvidenceMigrationResultKeys = exactKeys<WorkspaceEvidenceMigrationResult>()([
  "workspaceId",
  "declined",
]);
