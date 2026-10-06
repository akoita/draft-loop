import { readFile, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";

import { EmbeddingInputError, EmbeddingModelUnavailableError } from "./errors.js";
import {
  defaultGraniteEmbeddingTier,
  embeddingModelFiles,
  type GraniteEmbeddingModel,
  type GraniteEmbeddingTier,
  getGraniteEmbeddingModel,
} from "./model-manifest.js";
import { loadOnnxRuntime } from "./onnx-runtime-loader.js";
import type {
  EmbeddingModelIdentity,
  EmbeddingRole,
  EmbedOptions,
  TextEmbedder,
} from "./text-embedder.js";
import { truncateAndNormalize } from "./vector.js";

export const onnxRuntimeIdentity = "onnxruntime-node@1.30.0";

export interface OnnxFeed {
  /** Token ids and masks are int64; empty modality features are float32. */
  readonly data: BigInt64Array | Float32Array;
  readonly dims: readonly number[];
}

export interface OnnxOutput {
  readonly data: ArrayLike<number>;
  readonly dims: readonly number[];
}

export interface OnnxSessionLike {
  run(feeds: Record<string, OnnxFeed>): Promise<Record<string, OnnxOutput>>;
  release?(): Promise<void>;
}

export type OnnxSessionFactory = (
  modelPath: string,
  options: { readonly intraOpNumThreads: number },
) => Promise<OnnxSessionLike>;

export interface TokenizerLike {
  encode(text: string): { ids: number[]; attention_mask: number[] };
  token_to_id(token: string): number | undefined;
}

export type TokenizerFactory = (
  tokenizerJsonPath: string,
  tokenizerConfigPath: string,
) => Promise<{ tokenizer: TokenizerLike; padTokenId: number }>;

export type FileInspector = (
  relativePath: string,
) => Promise<{ readonly sizeBytes: number } | undefined>;

export interface OnnxTextEmbedderOptions {
  readonly modelDirectory: string;
  readonly tier?: GraniteEmbeddingTier;
  readonly dimensions?: number;
  readonly threads?: number;
  readonly batchSize?: number;
  readonly maxTokens?: number;
  readonly maxCharacters?: number;
  readonly sessionFactory?: OnnxSessionFactory;
  readonly tokenizerFactory?: TokenizerFactory;
  readonly fileInspector?: FileInspector;
}

const defaultBatchSize = 8;
const defaultMaxCharacters = 20_000;

const defaultSessionFactory: OnnxSessionFactory = async (modelPath, options) => {
  const ort = await loadOnnxRuntime();
  const session = await ort.InferenceSession.create(modelPath, {
    intraOpNumThreads: options.intraOpNumThreads,
    interOpNumThreads: 1,
    graphOptimizationLevel: "all",
  });
  return {
    async run(feeds) {
      const tensors: Record<string, InstanceType<typeof ort.Tensor>> = {};
      for (const [name, feed] of Object.entries(feeds)) {
        tensors[name] =
          feed.data instanceof Float32Array
            ? new ort.Tensor("float32", feed.data, [...feed.dims])
            : new ort.Tensor("int64", feed.data, [...feed.dims]);
      }
      const outputs = await session.run(tensors);
      const result: Record<string, OnnxOutput> = {};
      for (const [name, tensor] of Object.entries(outputs)) {
        result[name] = {
          data: tensor.data as ArrayLike<number>,
          dims: tensor.dims,
        };
      }
      return result;
    },
    release: () => session.release(),
  };
};

const defaultTokenizerFactory: TokenizerFactory = async (
  tokenizerJsonPath,
  tokenizerConfigPath,
) => {
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const tokenizerJson = JSON.parse(await readFile(tokenizerJsonPath, "utf8")) as object;
  const tokenizerConfig = JSON.parse(await readFile(tokenizerConfigPath, "utf8")) as {
    pad_token?: string | { content?: string };
  };
  const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
  const padToken =
    typeof tokenizerConfig.pad_token === "string"
      ? tokenizerConfig.pad_token
      : tokenizerConfig.pad_token?.content;
  const padTokenId = padToken === undefined ? undefined : tokenizer.token_to_id(padToken);
  if (padTokenId === undefined) {
    throw new Error("Embedding tokenizer does not define a usable pad token.");
  }
  return { tokenizer, padTokenId };
};

function resolveInteger(
  name: string,
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return resolved;
}

async function verifyModelFiles(
  model: GraniteEmbeddingModel,
  inspect: FileInspector,
): Promise<void> {
  for (const file of embeddingModelFiles(model)) {
    const found = await inspect(file.path);
    if (found === undefined) {
      throw new EmbeddingModelUnavailableError("missing-file", file.path);
    }
    if (found.sizeBytes !== file.sizeBytes) {
      throw new EmbeddingModelUnavailableError("size-mismatch", file.path);
    }
  }
}

/**
 * Mean of the first `dimensions` features over the real (unpadded) token positions. Padding sits
 * after the real tokens, so only the first `tokenCount` positions of the row contribute.
 */
function meanPool(
  data: ArrayLike<number>,
  rowStart: number,
  width: number,
  ids: readonly number[],
  dimensions: number,
): number[] {
  const sum = new Array<number>(dimensions).fill(0);
  for (let position = 0; position < ids.length; position += 1) {
    const offset = rowStart + position * width;
    for (let feature = 0; feature < dimensions; feature += 1) {
      sum[feature] = (sum[feature] as number) + (data[offset + feature] as number);
    }
  }
  return sum.map((value) => value / ids.length);
}

function prefixFor(model: GraniteEmbeddingModel, role: EmbeddingRole): string {
  return role === "query" ? model.queryPrefix : model.documentPrefix;
}

export async function createOnnxTextEmbedder(
  options: OnnxTextEmbedderOptions,
): Promise<TextEmbedder> {
  const tier = options.tier ?? defaultGraniteEmbeddingTier;
  const model = getGraniteEmbeddingModel(tier);

  const dimensions = options.dimensions ?? model.nativeDimensions;
  if (!model.matryoshkaDimensions.includes(dimensions)) {
    throw new RangeError(
      `dimensions must be one of ${model.matryoshkaDimensions.join(", ")} for the ${tier} tier.`,
    );
  }
  const threads = resolveInteger(
    "threads",
    options.threads,
    Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2))),
    1,
    64,
  );
  const batchSize = resolveInteger("batchSize", options.batchSize, defaultBatchSize, 1, 64);
  const maxTokens = resolveInteger(
    "maxTokens",
    options.maxTokens,
    model.defaultMaxTokens,
    8,
    model.maximumMaxTokens,
  );
  const maxCharacters = resolveInteger(
    "maxCharacters",
    options.maxCharacters,
    defaultMaxCharacters,
    1,
    Number.MAX_SAFE_INTEGER,
  );

  const inspect: FileInspector =
    options.fileInspector ??
    (async (relativePath) => {
      try {
        const info = await stat(join(options.modelDirectory, relativePath));
        return info.isFile() ? { sizeBytes: info.size } : undefined;
      } catch {
        return undefined;
      }
    });
  await verifyModelFiles(model, inspect);

  const { tokenizer, padTokenId } = await (options.tokenizerFactory ?? defaultTokenizerFactory)(
    join(options.modelDirectory, model.files.tokenizer.path),
    join(options.modelDirectory, model.files.tokenizerConfig.path),
  );
  const session = await (options.sessionFactory ?? defaultSessionFactory)(
    join(options.modelDirectory, model.files.model.path),
    { intraOpNumThreads: threads },
  );

  const identity: EmbeddingModelIdentity = Object.freeze({
    modelId: model.modelId,
    sourceRepository: model.sourceRepository,
    revision: model.revision,
    modelFileSha256: model.files.model.sha256,
    dimensions,
    pooling: model.pooling,
    runtime: onnxRuntimeIdentity,
  });

  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();

  function tokenize(text: string): number[] {
    const { ids } = tokenizer.encode(text);
    if (ids.length <= maxTokens) {
      return ids;
    }
    const truncated = ids.slice(0, maxTokens - 1);
    truncated.push(ids[ids.length - 1] as number);
    return truncated;
  }

  async function runBatch(batch: readonly number[][]): Promise<Float32Array[]> {
    const longest = batch.reduce((max, ids) => Math.max(max, ids.length), 0);
    const inputIds = new BigInt64Array(batch.length * longest).fill(BigInt(padTokenId));
    const attentionMask = new BigInt64Array(batch.length * longest);
    batch.forEach((ids, row) => {
      ids.forEach((id, column) => {
        inputIds[row * longest + column] = BigInt(id);
        attentionMask[row * longest + column] = 1n;
      });
    });
    const dims = [batch.length, longest];
    const feeds: Record<string, OnnxFeed> = {
      input_ids: { data: inputIds, dims },
      attention_mask: { data: attentionMask, dims },
    };
    for (const input of model.emptyFeatureInputs ?? []) {
      feeds[input.name] = { data: new Float32Array(0), dims: [0, input.width] };
    }
    const outputs = await session.run(feeds);
    const hidden = outputs.last_hidden_state;
    if (hidden === undefined) {
      throw new Error("Embedding model did not return last_hidden_state.");
    }
    const [batchDim, sequenceDim, width] = hidden.dims;
    if (
      batchDim !== batch.length ||
      sequenceDim !== longest ||
      width === undefined ||
      width < dimensions
    ) {
      throw new Error("Embedding model returned an unexpected output shape.");
    }
    const vectors: Float32Array[] = [];
    for (let row = 0; row < batch.length; row += 1) {
      const start = row * longest * width;
      const pooled =
        model.pooling === "mean"
          ? meanPool(hidden.data, start, width, batch[row] as number[], dimensions)
          : (Array.prototype.slice.call(hidden.data, start, start + width) as number[]);
      vectors.push(truncateAndNormalize(pooled, dimensions));
    }
    return vectors;
  }

  async function embedNow(
    texts: readonly string[],
    role: EmbeddingRole,
    signal: AbortSignal | undefined,
  ): Promise<Float32Array[]> {
    if (disposed) {
      throw new Error("The text embedder has been disposed.");
    }
    signal?.throwIfAborted();
    const prefix = prefixFor(model, role);
    const encoded = texts.map((text, index) => {
      if (text.trim().length === 0) {
        throw new EmbeddingInputError(index, "blank");
      }
      if (text.length > maxCharacters) {
        throw new EmbeddingInputError(index, "too-long", maxCharacters);
      }
      return tokenize(`${prefix}${text}`);
    });
    const results: Float32Array[] = [];
    for (let offset = 0; offset < encoded.length; offset += batchSize) {
      signal?.throwIfAborted();
      results.push(...(await runBatch(encoded.slice(offset, offset + batchSize))));
      signal?.throwIfAborted();
    }
    return results;
  }

  return {
    identity,
    embed(texts: readonly string[], role: EmbeddingRole, embedOptions?: EmbedOptions) {
      if (disposed) {
        return Promise.reject(new Error("The text embedder has been disposed."));
      }
      if (texts.length === 0) {
        return Promise.resolve([]);
      }
      const task = queue.then(() => embedNow(texts, role, embedOptions?.signal));
      queue = task.catch(() => undefined);
      return task;
    },
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      await queue;
      await session.release?.();
    },
  };
}
