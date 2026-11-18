import { describe, expect, it } from "vitest";

import { EmbeddingModelUnavailableError } from "./errors.js";
import { createOnnxCrossEncoder } from "./onnx-cross-encoder.js";
import type { OnnxFeed } from "./onnx-text-embedder.js";
import { bgeRerankerV2M3, crossEncoderModelFiles } from "./reranker-manifest.js";

const sizes = new Map(crossEncoderModelFiles().map((file) => [file.path, file.sizeBytes]));
const present = async (path: string) => {
  const sizeBytes = sizes.get(path);
  return sizeBytes === undefined ? undefined : { sizeBytes };
};

/** Encodes each character as one id: [0, query..., 2, 2, passage..., 2]. */
const tokenizerFactory = async () => ({
  tokenizer: {
    encode: (text: string, { text_pair }: { readonly text_pair: string }) => ({
      ids: [0, ...[...text].map(() => 5), 2, 2, ...[...text_pair].map(() => 6), 2],
    }),
  },
  padTokenId: 1,
});

describe("createOnnxCrossEncoder", () => {
  it("scores each passage with the sigmoid of its logit, in batches, padding to the longest", async () => {
    const batches: { readonly dims: readonly number[]; readonly mask: number[] }[] = [];
    const encoder = await createOnnxCrossEncoder({
      modelDirectory: "/model",
      batchSize: 2,
      fileInspector: present,
      tokenizerFactory,
      sessionFactory: async () => ({
        run: async (feeds: Record<string, OnnxFeed>) => {
          const ids = feeds.input_ids as OnnxFeed;
          const mask = feeds.attention_mask as OnnxFeed;
          batches.push({ dims: ids.dims, mask: Array.from(mask.data as BigInt64Array, Number) });
          const rows = ids.dims[0] as number;
          // Logit = number of real tokens minus 8, so longer passages score higher.
          const logits = Array.from({ length: rows }, (_, row) => {
            const width = ids.dims[1] as number;
            let count = 0;
            for (let column = 0; column < width; column += 1) {
              count += Number((mask.data as BigInt64Array)[row * width + column]);
            }
            return count - 8;
          });
          return { logits: { data: logits, dims: [rows, 1] } };
        },
      }),
    });
    const scores = await encoder.score("ab", ["x", "xxxx", "xx"]);
    expect(batches.map(({ dims }) => dims)).toEqual([
      [2, 10],
      [1, 8],
    ]);
    expect(batches[0]?.mask).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));
    expect(scores).toEqual([sigmoid(-1), sigmoid(2), sigmoid(0)]);
    expect(encoder.identity).toMatchObject({
      modelId: bgeRerankerV2M3.modelId,
      revision: bgeRerankerV2M3.revision,
      modelFileSha256: bgeRerankerV2M3.files.model.sha256,
    });
    await encoder.dispose();
    await expect(encoder.score("ab", ["x"])).rejects.toThrow("disposed");
  });

  it("truncates a long pair from the passage end and keeps the closing token", async () => {
    let seen: number[] = [];
    const encoder = await createOnnxCrossEncoder({
      modelDirectory: "/model",
      maxTokens: 8,
      fileInspector: present,
      tokenizerFactory,
      sessionFactory: async () => ({
        run: async (feeds: Record<string, OnnxFeed>) => {
          seen = Array.from((feeds.input_ids as OnnxFeed).data as BigInt64Array, Number);
          return { logits: { data: [0], dims: [1, 1] } };
        },
      }),
    });
    await encoder.score("ab", ["xxxxxxxx"]);
    expect(seen).toEqual([0, 5, 5, 2, 2, 6, 6, 2]);
  });

  it("refuses a model directory whose files are missing", async () => {
    await expect(
      createOnnxCrossEncoder({
        modelDirectory: "/model",
        fileInspector: async () => undefined,
        tokenizerFactory,
        sessionFactory: async () => ({ run: async () => ({}) }),
      }),
    ).rejects.toBeInstanceOf(EmbeddingModelUnavailableError);
  });
});
