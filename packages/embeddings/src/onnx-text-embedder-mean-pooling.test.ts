import { describe, expect, it } from "vitest";

import { embeddingModelFiles, getGraniteEmbeddingModel } from "./model-manifest.js";
import {
  createOnnxTextEmbedder,
  type OnnxFeed,
  type OnnxSessionLike,
} from "./onnx-text-embedder.js";

const width = 768;
const model = getGraniteEmbeddingModel("eg2-text");

/** Words get ids 10 + length; the Gemma template wraps them in <bos> (2) and <eos> (1). */
const tokenizer = {
  encode(text: string) {
    const ids = [2, ...text.split(/\s+/).map((word) => 10 + word.length), 1];
    return { ids, attention_mask: ids.map(() => 1) };
  },
  token_to_id: () => undefined,
};

function tokenCount(text: string): number {
  return tokenizer.encode(text).ids.length;
}

/**
 * Real position `p` of a row holds [p + 1, 2, 0, ...]; padding positions hold a large decoy, so a
 * pooling that reads padding is visibly wrong.
 */
function createSession(runs: Record<string, OnnxFeed>[]): OnnxSessionLike {
  return {
    async run(feeds) {
      runs.push(feeds);
      const input = feeds.input_ids as OnnxFeed;
      const mask = feeds.attention_mask as OnnxFeed;
      const [batch = 0, sequence = 0] = input.dims;
      const data = new Float32Array(batch * sequence * width);
      for (let row = 0; row < batch; row += 1) {
        for (let position = 0; position < sequence; position += 1) {
          const offset = (row * sequence + position) * width;
          if ((mask.data as BigInt64Array)[row * sequence + position] === 1n) {
            data[offset] = position + 1;
            data[offset + 1] = 2;
          } else {
            data.fill(1000, offset, offset + width);
          }
        }
      }
      return { last_hidden_state: { data, dims: [batch, sequence, width] } };
    },
  };
}

async function build(runs: Record<string, OnnxFeed>[], dimensions?: number) {
  return createOnnxTextEmbedder({
    modelDirectory: "/models/eg2",
    tier: "eg2-text",
    ...(dimensions === undefined ? {} : { dimensions }),
    sessionFactory: async () => createSession(runs),
    tokenizerFactory: async () => ({ tokenizer, padTokenId: 0 }),
    fileInspector: async (path) => {
      const match = embeddingModelFiles(model).find((file) => file.path === path);
      return match === undefined ? undefined : { sizeBytes: match.sizeBytes };
    },
  });
}

describe("mean pooling (EmbeddingGemma 2)", () => {
  it("averages real token positions only and normalizes", async () => {
    const embedder = await build([]);
    const shortText = "a";
    const longText = "a b c d e f g";

    // Both rows share one batch, so the short row is padded to the long row's length.
    const [short, long] = await embedder.embed([shortText, longText], "document");

    // Feature 0 is the mean of 1..n and feature 1 is always 2, so their ratio is 2 / ((n + 1) / 2).
    for (const [vector, text] of [
      [short, shortText],
      [long, longText],
    ] as const) {
      const count = tokenCount(`${model.documentPrefix}${text}`);
      expect(vector).toHaveLength(width);
      expect(Math.hypot(...(vector as Float32Array))).toBeCloseTo(1, 5);
      expect((vector as Float32Array)[2]).toBe(0);
      const [first = 0, second = 0] = vector as Float32Array;
      const ratio = second / first;
      expect(ratio).toBeCloseTo(2 / ((count + 1) / 2), 5);
    }
  });

  it("truncates Matryoshka dimensions after pooling and renormalizes", async () => {
    const embedder = await build([], 256);

    const [vector] = await embedder.embed(["hello"], "query");

    expect(vector).toHaveLength(256);
    expect(Math.hypot(...(vector as Float32Array))).toBeCloseTo(1, 5);
    expect(embedder.identity.dimensions).toBe(256);
    expect(embedder.identity.pooling).toBe("mean");
  });

  it("applies the task prefixes and feeds the empty modality inputs", async () => {
    const runs: Record<string, OnnxFeed>[] = [];
    const embedder = await build(runs);

    await embedder.embed(["hello"], "query");
    await embedder.embed(["hello"], "document");

    const [queryRun, documentRun] = runs;
    expect(queryRun?.input_ids?.dims).toEqual([1, tokenCount(`${model.queryPrefix}hello`)]);
    expect(documentRun?.input_ids?.dims).toEqual([1, tokenCount(`${model.documentPrefix}hello`)]);
    for (const run of runs) {
      for (const name of ["image_features", "video_features", "audio_features"]) {
        expect(run[name]?.dims).toEqual([0, 512]);
        expect(run[name]?.data).toBeInstanceOf(Float32Array);
      }
    }
  });
});
