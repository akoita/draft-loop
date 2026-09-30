import type { WorkspaceDescriptor } from "@draft-loop/application";
import {
  type ModelProfileReferences,
  type RunProviderAuthModeConfiguration,
  resolveModelProfilePair,
} from "@draft-loop/application/model-profile-selection";

export class RunModelProfileSelectionError extends Error {
  constructor(readonly code: "unsupported-route" | "workspace-mismatch") {
    super(
      code === "unsupported-route"
        ? "The selected model profiles are unsupported by the configured authentication routes."
        : "The selected model profiles must match the workspace's configured author and critic.",
    );
    this.name = "RunModelProfileSelectionError";
  }
}

/** Resolves profile references and binds them to the workspace's configured pair. */
export function resolveWorkspaceModelProfileSelection(
  references: unknown,
  workspace: WorkspaceDescriptor,
  authModes: RunProviderAuthModeConfiguration,
): ModelProfileReferences {
  let resolved: ReturnType<typeof resolveModelProfilePair>;
  try {
    resolved = resolveModelProfilePair(references, authModes);
  } catch {
    throw new RunModelProfileSelectionError("unsupported-route");
  }

  if (
    resolved.author.provider !== workspace.author.company ||
    resolved.author.modelId !== workspace.author.model ||
    resolved.critic.provider !== workspace.critic.company ||
    resolved.critic.modelId !== workspace.critic.model
  ) {
    throw new RunModelProfileSelectionError("workspace-mismatch");
  }

  return {
    author: { id: resolved.author.id, version: resolved.author.version },
    critic: { id: resolved.critic.id, version: resolved.critic.version },
  };
}
