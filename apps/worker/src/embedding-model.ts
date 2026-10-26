import {
  createEmbeddingModelService,
  defaultEmbeddingModelRoot,
  defaultEmbeddingModelTier,
  type EmbeddingModelService,
  type EmbeddingModelStatus,
} from "@draft-loop/application";

type ModelService = Pick<EmbeddingModelService, "install" | "status">;

/**
 * Installs the default embedding model from downloaded files into the worker image's model root
 * (#1806). The install verifies each file against the pinned size and SHA-256, and the result is
 * checked once more in full, so an image is never built around a model that cannot load.
 */
export async function installBakedEmbeddingModel(input: {
  readonly from: string;
  readonly modelRoot: string;
  readonly service?: ModelService;
}): Promise<EmbeddingModelStatus> {
  const service = input.service ?? createEmbeddingModelService({ modelRoot: input.modelRoot });
  await service.install(defaultEmbeddingModelTier, { from: input.from });
  const status = await service.status(defaultEmbeddingModelTier, { verify: "sha256" });
  if (status.state !== "ready") {
    throw new Error(`The ${status.tier} embedding model is ${status.state} after install.`);
  }
  return status;
}

/**
 * The default model's state where this worker loads it from, named in the start log. A worker
 * without a ready model still runs, but its critic judges no requirement coverage, so the run's
 * relevance counts only word matches.
 */
export async function embeddingModelReadiness(
  env: Readonly<Record<string, string | undefined>>,
  service?: Pick<EmbeddingModelService, "status">,
): Promise<{ readonly tier: string; readonly state: EmbeddingModelStatus["state"] }> {
  const modelRoot = defaultEmbeddingModelRoot({ env });
  const status = await (service ?? createEmbeddingModelService({ modelRoot })).status(
    defaultEmbeddingModelTier,
  );
  return { tier: status.tier, state: status.state };
}
