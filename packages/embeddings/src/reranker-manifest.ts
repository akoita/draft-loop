import type { GraniteModelFile } from "./model-manifest.js";

/**
 * The pinned local cross-encoder (#3020): it reads a query and a passage together and scores how
 * well the passage answers the query. It is evaluated offline before any run uses it.
 */
export interface CrossEncoderModel {
  readonly modelId: string;
  readonly sourceRepository: string;
  readonly revision: string;
  /** The base model's licence; the ONNX conversion carries the same weights. */
  readonly license: "Apache-2.0";
  readonly defaultMaxTokens: number;
  readonly maximumMaxTokens: number;
  readonly files: {
    readonly model: GraniteModelFile;
    readonly tokenizer: GraniteModelFile;
    readonly tokenizerConfig: GraniteModelFile;
  };
}

export const bgeRerankerV2M3: CrossEncoderModel = Object.freeze({
  modelId: "BAAI/bge-reranker-v2-m3",
  sourceRepository: "onnx-community/bge-reranker-v2-m3-ONNX",
  revision: "6f5ff65298512715a1e669753bc754d2bc8f367b",
  license: "Apache-2.0",
  defaultMaxTokens: 512,
  maximumMaxTokens: 8192,
  files: Object.freeze({
    model: Object.freeze({
      path: "onnx/model_int8.onnx",
      sizeBytes: 570727094,
      sha256: "912fc1215c2dbff6499700534bd8d31253af01573861abbfc43afd1fab6cce5d",
    }),
    tokenizer: Object.freeze({
      path: "tokenizer.json",
      sizeBytes: 17082900,
      sha256: "8bf8afbfd11306bd872018c53bfdf2e160a56f8edbcf49933324404791c148d3",
    }),
    tokenizerConfig: Object.freeze({
      path: "tokenizer_config.json",
      sizeBytes: 1203,
      sha256: "b87c8703482b0300d3da30e201519aa641f6a450f5eb5bf1e624afbf70c74d80",
    }),
  }),
});

/** Every file the cross-encoder needs on disk, in install order. */
export function crossEncoderModelFiles(
  model: CrossEncoderModel = bgeRerankerV2M3,
): readonly GraniteModelFile[] {
  return [model.files.model, model.files.tokenizer, model.files.tokenizerConfig];
}
