export type { EmbeddingInputProblem, EmbeddingModelUnavailableReason } from "./errors.js";
export { EmbeddingInputError, EmbeddingModelUnavailableError } from "./errors.js";
export type {
  GraniteEmbeddingModel,
  GraniteEmbeddingTier,
  GraniteModelFile,
} from "./model-manifest.js";
export {
  defaultGraniteEmbeddingTier,
  getGraniteEmbeddingModel,
  graniteEmbeddingModels,
} from "./model-manifest.js";
export type { OnnxRuntimeCheckOptions, OnnxRuntimeCheckResult } from "./onnx-runtime-check.js";
export { verifyOnnxRuntime } from "./onnx-runtime-check.js";
export type { OnnxRuntimeLoaderOptions, OnnxRuntimeModule } from "./onnx-runtime-loader.js";
export {
  loadOnnxRuntime,
  loadOnnxRuntimeUncached,
  OnnxRuntimeUnavailableError,
} from "./onnx-runtime-loader.js";
export type {
  FileInspector,
  OnnxFeed,
  OnnxOutput,
  OnnxSessionFactory,
  OnnxSessionLike,
  OnnxTextEmbedderOptions,
  TokenizerFactory,
  TokenizerLike,
} from "./onnx-text-embedder.js";
export { createOnnxTextEmbedder, onnxRuntimeIdentity } from "./onnx-text-embedder.js";
export type { SemanticRelevanceFloor } from "./relevance-floor.js";
export {
  applySemanticRelevanceFloor,
  defaultSemanticRelevanceFloor,
  defaultSemanticRelevanceFloors,
  semanticRelevanceFloorForIdentity,
} from "./relevance-floor.js";
export type {
  EmbeddingModelIdentity,
  EmbeddingRole,
  EmbedOptions,
  TextEmbedder,
} from "./text-embedder.js";
export { cosineSimilarity, l2Normalize, truncateAndNormalize } from "./vector.js";
