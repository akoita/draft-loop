import { describe, expect, it } from "vitest";

import { type GraniteEmbeddingTier, getGraniteEmbeddingModel } from "./model-manifest.js";
import { createOnnxTextEmbedder } from "./onnx-text-embedder.js";
import { cosineSimilarity } from "./vector.js";

const modelDirectory = process.env.DRAFT_LOOP_EMBEDDING_MODEL_DIR;
const tier: GraniteEmbeddingTier =
  process.env.DRAFT_LOOP_EMBEDDING_TIER === "311m" ? "311m" : "97m";

describe.skipIf(modelDirectory === undefined || modelDirectory === "")(
  "Granite embedding model (real files)",
  () => {
    it("embeds sentences into unit vectors that rank related text higher", async () => {
      const embedder = await createOnnxTextEmbedder({
        modelDirectory: modelDirectory as string,
        tier,
      });
      try {
        const query = await embedder.embed(["people leadership experience"], "query");
        const documents = await embedder.embed(
          ["Managed a team of six engineers.", "Baked bread for the farmers market."],
          "document",
        );
        const dimensions = getGraniteEmbeddingModel(tier).nativeDimensions;
        const vectors = [...query, ...documents];

        expect(vectors).toHaveLength(3);
        for (const vector of vectors) {
          expect(vector).toHaveLength(dimensions);
          expect(Math.hypot(...vector)).toBeCloseTo(1, 4);
        }
        const [queryVector, related, unrelated] = vectors as [
          Float32Array,
          Float32Array,
          Float32Array,
        ];
        expect(cosineSimilarity(queryVector, related)).toBeGreaterThan(
          cosineSimilarity(queryVector, unrelated),
        );
      } finally {
        await embedder.dispose();
      }
    }, 120_000);
  },
);
