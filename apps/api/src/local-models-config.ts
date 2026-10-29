import { ApiConfigError } from "./config.js";

/** The most models a deployment may declare on its local endpoint. */
const maximumLocalModels = 20;

const modelIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

/**
 * Reads `DRAFT_LOOP_LOCAL_MODELS`: the model names the deployment's local OpenAI-compatible
 * endpoint serves (Ollama, LM Studio, llama.cpp), separated by commas (ADR 0011, D5). Only the
 * worker knows the endpoint; the API offers these names in the catalog and accepts them in a
 * workspace's pair. Unset, the deployment offers no local model.
 */
export function readLocalModels(env: NodeJS.ProcessEnv): readonly string[] {
  const names = (env.DRAFT_LOOP_LOCAL_MODELS ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  if (names.length > maximumLocalModels || names.some((name) => !modelIdPattern.test(name))) {
    throw new ApiConfigError(
      `DRAFT_LOOP_LOCAL_MODELS must list up to ${maximumLocalModels} model ids, separated by commas.`,
    );
  }
  return [...new Set(names)];
}
