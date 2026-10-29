import type { LocalApplicationDriverOptions } from "@draft-loop/application";
import { type LocalClient, ProviderAdapterError } from "@draft-loop/providers";

import { WorkerConfigError } from "./config-error.js";

/**
 * Reads `DRAFT_LOOP_LOCAL_MODEL_ENDPOINT`: the deployment's OpenAI-compatible endpoint for local
 * models (ADR 0011, D5), such as `http://host.docker.internal:11434/v1` for Ollama beside a
 * Compose stack. The operator chooses it, so unlike a desktop workspace's endpoint it need not be
 * loopback; it must be http or https with no credentials, query or fragment. Unset, a local model
 * has no endpoint and its calls fail.
 */
export function readLocalModelEndpoint(env: NodeJS.ProcessEnv): string | undefined {
  const value = (env.DRAFT_LOOP_LOCAL_MODEL_ENDPOINT ?? "").trim();
  if (value === "") return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    url = new URL("invalid:");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new WorkerConfigError(
      "DRAFT_LOOP_LOCAL_MODEL_ENDPOINT must be an http or https address with no credentials, query or fragment.",
    );
  }
  return value.replace(/\/+$/u, "");
}

type ProviderOptions = Pick<
  LocalApplicationDriverOptions,
  "resolveCredential" | "providerClientFactories"
>;

/**
 * Adds the local route to the worker's provider wiring. Every `local` model goes to the
 * deployment's endpoint, whatever a workspace's configuration says, because a hosted workspace
 * never chooses where material goes. Without an endpoint, a local call is refused.
 */
export function withLocalModels(
  options: ProviderOptions,
  endpoint: string | undefined,
  fetchImpl?: typeof fetch,
): ProviderOptions {
  const local = (): LocalClient => {
    if (endpoint === undefined) {
      throw new ProviderAdapterError(
        "local",
        "invalid-request",
        "This deployment has no local model endpoint.",
        { retryable: false, route: "local" },
      );
    }
    return { endpoint, ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }) };
  };
  return { ...options, providerClientFactories: { ...options.providerClientFactories, local } };
}
