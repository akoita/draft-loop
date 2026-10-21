/**
 * A workspace's settings: its configuration, the managed writing policy, and the small documents
 * that record its modes, model pair, consent and decisions. The local driver keeps them as files
 * under `<root>/.draft-loop/`; the hosted service keeps them in Postgres (ADR 0011, D3).
 *
 * History, managed candidate files and embedding models are not settings; they have their own
 * ports or stay local.
 */
export const workspaceSettingNames = [
  "workspace.json",
  "writing-policy.md",
  "evidence-mode.json",
  "retrieval-mode.json",
  "model-profile-selection.json",
  "sensitive-knowledge-consent.json",
  "legacy-evidence-migration.json",
] as const;

export type WorkspaceSettingName = (typeof workspaceSettingNames)[number];

/**
 * Named text documents of one workspace. `workspace` is the driver's reference to it: the root
 * directory locally, an opaque reference on the server. Each caller owns its document's format.
 */
export interface WorkspaceSettingsPort {
  /** The document's text, or `undefined` when it was never written; other failures throw. */
  readonly read: (workspace: string, name: WorkspaceSettingName) => Promise<string | undefined>;
  /** Replaces the whole document; a reader sees the old text or the new text, never a mix. */
  readonly write: (workspace: string, name: WorkspaceSettingName, content: string) => Promise<void>;
  /** Removes the document; resolves to whether it existed. */
  readonly remove: (workspace: string, name: WorkspaceSettingName) => Promise<boolean>;
}
