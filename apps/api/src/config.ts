import { ownerTokenMinimumLength } from "./owner-access.js";

export interface ApiConfig {
  readonly host: string;
  readonly port: number;
  readonly ownerToken: string;
}

export class ApiConfigError extends Error {
  override readonly name = "ApiConfigError";
}

/**
 * Reads the API's settings from the environment. `PORT` is what Cloud Run sets; the owner token
 * comes from the deployment's secret, never from this repository.
 */
export function readApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const ownerToken = env.DRAFT_LOOP_API_OWNER_TOKEN ?? "";
  if (ownerToken.length < ownerTokenMinimumLength || /\s/u.test(ownerToken)) {
    throw new ApiConfigError(
      `DRAFT_LOOP_API_OWNER_TOKEN must be at least ${ownerTokenMinimumLength} characters with no whitespace.`,
    );
  }
  const portText = env.PORT ?? "8080";
  const port = Number(portText);
  if (!/^\d+$/u.test(portText) || port < 1 || port > 65_535) {
    throw new ApiConfigError("PORT must be a TCP port number.");
  }
  return { host: env.DRAFT_LOOP_API_HOST ?? "0.0.0.0", port, ownerToken };
}
