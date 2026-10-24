/**
 * How a hosted deployment authenticates people (ADR 0011): the owner token alone, or sign-in
 * through an identity provider. The API and the worker read the same `DRAFT_LOOP_AUTH_MODE`, so
 * that what the worker enforces follows what the API admits.
 */
export type DeploymentAuthMode = "owner" | "oidc";

export class DeploymentAuthModeConfigError extends Error {
  override readonly name = "DeploymentAuthModeConfigError";
}

/** Reads `DRAFT_LOOP_AUTH_MODE`: `owner` when unset or empty, else `owner` or `oidc`. */
export function readDeploymentAuthMode(env: NodeJS.ProcessEnv): DeploymentAuthMode {
  const mode = env.DRAFT_LOOP_AUTH_MODE ?? "";
  if (mode === "" || mode === "owner") return "owner";
  if (mode === "oidc") return "oidc";
  throw new DeploymentAuthModeConfigError("DRAFT_LOOP_AUTH_MODE must be owner or oidc.");
}
