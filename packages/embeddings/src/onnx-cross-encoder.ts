import { readFile, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { join } from "node:path";

import { EmbeddingInputError, EmbeddingModelUnavailableError } from "./errors.js";
import {
  defaultOnnxSessionFactory,
  type FileInspector,
  type OnnxFeed,
  type OnnxSessionFactory,
  onnxRuntimeIdentity,
} from "./onnx-text-embedder.js";
import {
  bgeRerankerV2M3,
  type CrossEncoderModel,
  crossEncoderModelFiles,
} from "./reranker-manifest.js";

/** A tokenizer that encodes a query and a passage as one pair. */
export interface PairTokenizerLike {
  encode(text: string, options: { readonly text_pair: string }): { ids: number[] };
}

export type PairTokenizerFactory = (
  tokenizerJsonPath: string,
  tokenizerConfigPath: string,
) => Promise<{ tokenizer: PairTokenizerLike; padTokenId: number }>;

export interface CrossEncoderIdentity {
  readonly modelId: string;
  readonly sourceRepository: string;
  readonly revision: string;
  readonly modelFileSha256: string;
  readonly runtime: string;
}

/** Scores passages against one query; higher is more relevant, from 0 to 1. */
export interface CrossEncoder {
  readonly identity: CrossEncoderIdentity;
  score(query: string, passages: readonly string[]): Promise<number[]>;
  dispose(): Promise<void>;
}

export interface OnnxCrossEncoderOptions {
  readonly modelDirectory: string;
  readonly model?: CrossEncoderModel;
  readonly threads?: number;
  readonly batchSize?: number;
  readonly maxTokens?: number;
  readonly maxCharacters?: number;
  readonly sessionFactory?: OnnxSessionFactory;
  readonly tokenizerFactory?: PairTokenizerFactory;
  readonly fileInspector?: FileInspector;
}

const defaultBatchSize = 8;
const defaultMaxCharacters = 20_000;

const defaultPairTokenizerFactory: PairTokenizerFactory = async (
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
    throw new Error("Cross-encoder tokenizer does not define a usable pad token.");
  }
  return {
    tokenizer: {
      encode: (text, options) => ({ ids: tokenizer.encode(text, options).ids }),
    },
    padTokenId,
  };
};

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function boundedInteger(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

/**
 * Opens the pinned cross-encoder. Each pair is encoded query first, so truncation to `maxTokens`
 * drops the end of the passage, never the query.
 */
export async function createOnnxCrossEncoder(
  options: OnnxCrossEncoderOptions,
): Promise<CrossEncoder> {
  const model = options.model ?? bgeRerankerV2M3;
  const threads = boundedInteger(
    "threads",
    options.threads ?? Math.min(4, Math.max(1, Math.floor(availableParallelism() / 2))),
    1,
    64,
  );
  const batchSize = boundedInteger("batchSize", options.batchSize ?? defaultBatchSize, 1, 64);
  const maxTokens = boundedInteger(
    "maxTokens",
    options.maxTokens ?? model.defaultMaxTokens,
    8,
    model.maximumMaxTokens,
  );
  const maxCharacters = boundedInteger(
    "maxCharacters",
    options.maxCharacters ?? defaultMaxCharacters,
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
  for (const file of crossEncoderModelFiles(model)) {
    const found = await inspect(file.path);
    if (found === undefined) throw new EmbeddingModelUnavailableError("missing-file", file.path);
    if (found.sizeBytes !== file.sizeBytes) {
      throw new EmbeddingModelUnavailableError("size-mismatch", file.path);
    }
  }
  const { tokenizer, padTokenId } = await (options.tokenizerFactory ?? defaultPairTokenizerFactory)(
    join(options.modelDirectory, model.files.tokenizer.path),
    join(options.modelDirectory, model.files.tokenizerConfig.path),
  );
  const session = await (options.sessionFactory ?? defaultOnnxSessionFactory)(
    join(options.modelDirectory, model.files.model.path),
    { intraOpNumThreads: threads },
  );
  const identity: CrossEncoderIdentity = Object.freeze({
    modelId: model.modelId,
    sourceRepository: model.sourceRepository,
    revision: model.revision,
    modelFileSha256: model.files.model.sha256,
    runtime: onnxRuntimeIdentity,
  });

  let disposed = false;
  let queue: Promise<unknown> = Promise.resolve();

  function encode(query: string, passage: string): number[] {
    const { ids } = tokenizer.encode(query, { text_pair: passage });
    if (ids.length <= maxTokens) return ids;
    const truncated = ids.slice(0, maxTokens - 1);
    truncated.push(ids[ids.length - 1] as number);
    return truncated;
  }

  async function runBatch(batch: readonly number[][]): Promise<number[]> {
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
    const outputs = await session.run(feeds);
    const logits = outputs.logits;
    if (
      logits === undefined ||
      logits.dims[0] !== batch.length ||
      logits.data.length < batch.length
    ) {
      throw new Error("Cross-encoder returned an unexpected output shape.");
    }
    const width = logits.data.length / batch.length;
    return batch.map((_, row) => sigmoid(logits.data[row * width] as number));
  }

  async function scoreNow(query: string, passages: readonly string[]): Promise<number[]> {
    if (disposed) throw new Error("The cross-encoder has been disposed.");
    if (query.trim().length === 0) throw new EmbeddingInputError(0, "blank");
    const encoded = passages.map((passage, index) => {
      if (passage.trim().length === 0) throw new EmbeddingInputError(index, "blank");
      if (passage.length > maxCharacters || query.length > maxCharacters) {
        throw new EmbeddingInputError(index, "too-long", maxCharacters);
      }
      return encode(query, passage);
    });
    const scores: number[] = [];
    for (let offset = 0; offset < encoded.length; offset += batchSize) {
      scores.push(...(await runBatch(encoded.slice(offset, offset + batchSize))));
    }
    return scores;
  }

  return {
    identity,
    score(query, passages) {
      if (disposed) return Promise.reject(new Error("The cross-encoder has been disposed."));
      if (passages.length === 0) return Promise.resolve([]);
      const task = queue.then(() => scoreNow(query, passages));
      queue = task.catch(() => undefined);
      return task;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await queue;
      await session.release?.();
    },
  };
}
