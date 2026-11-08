import {
  type SavedApplicationMaterial,
  savedApplicationMaterialSchema,
} from "@draft-loop/schemas/saved-application-material";

/**
 * One tenant's saved cover letters and interview question sets (#2477). This module holds the
 * port, its error and an in-memory implementation for tests and single-process stacks; Postgres
 * implements it too. A saved draft never changes: an edit or a new draft is a new version.
 */

export type SavedApplicationMaterialStoreErrorCode = "duplicate_material" | "invalid_material";

export class SavedApplicationMaterialStoreError extends Error {
  readonly code: SavedApplicationMaterialStoreErrorCode;

  constructor(code: SavedApplicationMaterialStoreErrorCode, message: string) {
    super(message);
    this.name = "SavedApplicationMaterialStoreError";
    this.code = code;
  }
}

export interface SavedApplicationMaterialStore {
  insert(material: SavedApplicationMaterial): Promise<void>;
  get(workspaceId: string, id: string): Promise<SavedApplicationMaterial | undefined>;
  /** One application's saved drafts, newest first, optionally of one kind. */
  list(
    workspaceId: string,
    applicationId: string,
    options?: { readonly kind?: SavedApplicationMaterial["kind"]; readonly limit?: number },
  ): Promise<readonly SavedApplicationMaterial[]>;
  /** True when a draft was removed. */
  delete(workspaceId: string, id: string): Promise<boolean>;
}

/** The most versions one list returns. */
export const savedApplicationMaterialListLimit = 50;

/** Parses a draft before it is stored or after it is read, so a store never holds a bad one. */
export function requireSavedApplicationMaterial(value: unknown): SavedApplicationMaterial {
  const parsed = savedApplicationMaterialSchema.safeParse(value);
  if (!parsed.success) {
    throw new SavedApplicationMaterialStoreError(
      "invalid_material",
      "The saved application material is invalid.",
    );
  }
  return parsed.data;
}

const newestFirst = (left: SavedApplicationMaterial, right: SavedApplicationMaterial) =>
  right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);

/** An in-memory store for one tenant. */
export function createMemorySavedApplicationMaterialStore(): SavedApplicationMaterialStore {
  const drafts = new Map<string, SavedApplicationMaterial>();
  return {
    insert: async (input) => {
      const material = requireSavedApplicationMaterial(input);
      if (drafts.has(material.id)) {
        throw new SavedApplicationMaterialStoreError(
          "duplicate_material",
          "The saved application material already exists.",
        );
      }
      drafts.set(material.id, material);
    },
    get: async (workspaceId, id) => {
      const material = drafts.get(id);
      return material?.workspace_id === workspaceId ? material : undefined;
    },
    list: async (workspaceId, applicationId, options = {}) =>
      [...drafts.values()]
        .filter(
          (draft) =>
            draft.workspace_id === workspaceId &&
            draft.application_id === applicationId &&
            (options.kind === undefined || draft.kind === options.kind),
        )
        .sort(newestFirst)
        .slice(0, options.limit ?? savedApplicationMaterialListLimit),
    delete: async (workspaceId, id) =>
      drafts.get(id)?.workspace_id === workspaceId && drafts.delete(id),
  };
}
