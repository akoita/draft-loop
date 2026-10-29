import { isAbsolute } from "node:path";
import type { LocalApplicationDriverOptions } from "@draft-loop/application";
import {
  createAnthropicApiClient,
  createFileCredentialResolver,
  createOpenAiClient,
  defaultSecretsDirectory,
  type OpenAiEndpoint,
} from "@draft-loop/model-gateway";

import { WorkerConfigError } from "./config-error.js";
import {
  type ModelGatewayConfig,
  type ModelRouteDependencies,
  readModelGatewayConfig,
  workerProviderOptions,
} from "./model-routes.js";

/**
 * The self-hosted routes (ADR 0011, D5 and D15): the Claude API and OpenAI with the operator's
 * own keys, read from files in `secretsDirectory`. Material goes to the providers' own endpoints,
 * so this is a deployment's explicit choice, never a fallback.
 */
export interface DirectRoutesConfig {
  readonly secretsDirectory: string;
  /** `global` unless the operator's OpenAI project has EU data residency. */
  readonly openAiEndpoint: OpenAiEndpoint;
}

/** Which routes the worker's provider calls take; none means fixtures only. */
export type WorkerModelRoutes =
  | { readonly kind: "vertex"; readonly gateway: ModelGatewayConfig }
  | { readonly kind: "direct"; readonly direct: DirectRoutesConfig };

/** Settings that belong to the Vertex routes, refused beside `direct` so no route is ambiguous. */
const vertexSettings = [
  "DRAFT_LOOP_VERTEX_PROJECT_ID",
  "DRAFT_LOOP_VERTEX_LOCATION",
  "DRAFT_LOOP_VERTEX_PRICE_FACTOR",
  "DRAFT_LOOP_OPENAI_KEY_SECRET",
  "DRAFT_LOOP_ANTHROPIC_FALLBACK",
  "DRAFT_LOOP_ANTHROPIC_KEY_SECRET",
] as const;

const isSet = (env: NodeJS.ProcessEnv, name: string) => (env[name] ?? "") !== "";

function readDirectRoutes(env: NodeJS.ProcessEnv): DirectRoutesConfig {
  const mixed = vertexSettings.filter((name) => isSet(env, name));
  if (mixed.length > 0) {
    throw new WorkerConfigError(
      `${mixed.join(", ")} belong to the vertex routes; remove them when DRAFT_LOOP_MODEL_ROUTES is direct.`,
    );
  }
  const secretsDirectory = env.DRAFT_LOOP_SECRETS_DIR || defaultSecretsDirectory;
  if (!isAbsolute(secretsDirectory)) {
    throw new WorkerConfigError("DRAFT_LOOP_SECRETS_DIR must be an absolute path.");
  }
  const openAiEndpoint = env.DRAFT_LOOP_OPENAI_ENDPOINT || "global";
  if (openAiEndpoint !== "eu" && openAiEndpoint !== "global") {
    throw new WorkerConfigError("DRAFT_LOOP_OPENAI_ENDPOINT must be eu or global.");
  }
  return { secretsDirectory, openAiEndpoint };
}

/**
 * Reads `DRAFT_LOOP_MODEL_ROUTES`. Unset, a Vertex project selects `vertex`, as before, and no
 * project leaves the worker on fixtures. `direct` takes keys from files and refuses every Vertex
 * setting; an unknown value is a startup error.
 */
export function readModelRoutes(env: NodeJS.ProcessEnv): WorkerModelRoutes | undefined {
  const kind = env.DRAFT_LOOP_MODEL_ROUTES ?? "";
  if (kind === "direct") return { kind, direct: readDirectRoutes(env) };
  if (kind !== "" && kind !== "vertex") {
    throw new WorkerConfigError("DRAFT_LOOP_MODEL_ROUTES must be vertex or direct.");
  }
  const gateway = readModelGatewayConfig(env);
  if (gateway === undefined) {
    if (kind === "vertex") {
      throw new WorkerConfigError(
        "DRAFT_LOOP_VERTEX_PROJECT_ID is required when DRAFT_LOOP_MODEL_ROUTES is vertex.",
      );
    }
    return undefined;
  }
  return { kind: "vertex", gateway };
}

/** The direct routes' wiring: keys from files, the Claude API and the chosen OpenAI endpoint. */
export function directProviderOptions(
  config: DirectRoutesConfig,
  dependencies: Pick<ModelRouteDependencies, "anthropicApiClient" | "openAiClient"> = {},
): Pick<LocalApplicationDriverOptions, "resolveCredential" | "providerClientFactories"> {
  return {
    resolveCredential: createFileCredentialResolver({ directory: config.secretsDirectory }),
    providerClientFactories: {
      // No `anthropicRoute`: the application's API-key route runs, with its prompt cache.
      anthropic: dependencies.anthropicApiClient ?? ((apiKey) => createAnthropicApiClient(apiKey)),
      openai:
        dependencies.openAiClient ??
        ((apiKey: string) => createOpenAiClient(apiKey, config.openAiEndpoint)),
    },
  };
}

/** The provider wiring for the deployment's routes, or none on fixtures. */
export function routeProviderOptions(
  routes: WorkerModelRoutes | undefined,
  dependencies: ModelRouteDependencies = {},
): Pick<LocalApplicationDriverOptions, "resolveCredential" | "providerClientFactories"> {
  if (routes?.kind === "direct") return directProviderOptions(routes.direct, dependencies);
  return workerProviderOptions(routes?.gateway, dependencies);
}

/** The start line's content-free description of the routes. */
export function routeFields(routes: WorkerModelRoutes): Record<string, string | boolean> {
  if (routes.kind === "direct") {
    return {
      routes: "direct",
      anthropic: "anthropic-api",
      openAiEndpoint: routes.direct.openAiEndpoint,
    };
  }
  return {
    routes: "vertex",
    openAiEndpoint: routes.gateway.openAiEndpoint,
    anthropicFallback: routes.gateway.anthropicKeySecret !== undefined,
  };
}
