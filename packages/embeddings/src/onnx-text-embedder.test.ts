import { describe, expect, it } from "vitest";

import { EmbeddingInputError, EmbeddingModelUnavailableError } from "./errors.js";
import { getGraniteEmbeddingModel } from "./model-manifest.js";
import {
  createOnnxTextEmbedder,
  type FileInspector,
  type OnnxFeed,
  type OnnxSessionLike,
  type OnnxTextEmbedderOptions,
} from "./onnx-text-embedder.js";

const padTokenId = 0;
const clsId = 1;
const sepId = 2;
const secretDirectory = "/private/home/secret-model-dir";

interface RecordedRun {
  readonly inputIds: bigint[][];
  readonly attentionMask: bigint[][];
  readonly dims: readonly number[];
}

function rowsOf(feed: OnnxFeed): bigint[][] {
  const [batch = 0, sequence = 0] = feed.dims;
  const rows: bigint[][] = [];
  for (let row = 0; row < batch; row += 1) {
    rows.push(Array.from((feed.data as BigInt64Array).slice(row * sequence, (row + 1) * sequence)));
  }
  return rows;
}

/**
 * The CLS vector is [3, 4, ...] by default; other positions hold a large
 * decoy value so a test fails if pooling reads anything but position 0.
 */
function createFakeSession(options: {
  readonly width: number;
  readonly cls?: (marker: number) => number[];
  readonly onRun?: (index: number) => Promise<void> | void;
  readonly released?: { value: boolean };
}) {
  const runs: RecordedRun[] = [];
  let active = 0;
  let maxActive = 0;
  const session: OnnxSessionLike = {
    async run(feeds) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        const inputFeed = feeds.input_ids as OnnxFeed;
        const maskFeed = feeds.attention_mask as OnnxFeed;
        const inputIds = rowsOf(inputFeed);
        runs.push({ inputIds, attentionMask: rowsOf(maskFeed), dims: inputFeed.dims });
        await options.onRun?.(runs.length - 1);
        const [batch = 0, sequence = 0] = inputFeed.dims;
        const data = new Float32Array(batch * sequence * options.width).fill(99);
        for (let row = 0; row < batch; row += 1) {
          // Marker is the first word id, so output order can be verified.
          const marker = Number(inputIds[row]?.[1] ?? 0);
          const vector = options.cls?.(marker) ?? [
            3,
            4,
            ...new Array<number>(options.width - 2).fill(0),
          ];
          data.set(vector, row * sequence * options.width);
        }
        return { last_hidden_state: { data, dims: [batch, sequence, options.width] } };
      } finally {
        active -= 1;
      }
    },
    async release() {
      if (options.released) {
        options.released.value = true;
      }
    },
  };
  return { session, runs, maxActive: () => maxActive };
}

/** Word ids are 10 + word length; CLS and SEP are added like the real tokenizer. */
const fakeTokenizer = {
  encode(text: string) {
    const ids = [clsId, ...text.split(/\s+/).map((word) => 10 + word.length), sepId];
    return { ids, attention_mask: ids.map(() => 1) };
  },
  token_to_id: () => undefined,
};

const allFilesPresent: FileInspector = async (relativePath) => {
  const { files } = getGraniteEmbeddingModel("311m");
  const match = Object.values(files).find((file) => file.path === relativePath);
  return match ? { sizeBytes: match.sizeBytes } : undefined;
};

function build(session: OnnxSessionLike, overrides: Partial<OnnxTextEmbedderOptions> = {}) {
  return createOnnxTextEmbedder({
    modelDirectory: secretDirectory,
    tier: "311m",
    sessionFactory: async () => session,
    tokenizerFactory: async () => ({ tokenizer: fakeTokenizer, padTokenId }),
    fileInspector: allFilesPresent,
    ...overrides,
  });
}

describe("createOnnxTextEmbedder", () => {
  it("uses CLS pooling and returns unit vectors at native dimensions", async () => {
    const fake = createFakeSession({ width: 768 });
    const embedder = await build(fake.session);

    const [vector] = await embedder.embed(["hello world"], "document");

    expect(vector).toHaveLength(768);
    expect(vector?.[0]).toBeCloseTo(0.6);
    expect(vector?.[1]).toBeCloseTo(0.8);
    expect(vector?.[2]).toBe(0);
  });

  it("truncates Matryoshka dimensions and renormalizes", async () => {
    const fake = createFakeSession({
      width: 768,
      cls: () => [3, 4, ...new Array<number>(126).fill(0), 12, ...new Array<number>(639).fill(0)],
    });
    const embedder = await build(fake.session, { dimensions: 128 });

    const [vector] = await embedder.embed(["hello"], "query");

    expect(vector).toHaveLength(128);
    expect(vector?.[0]).toBeCloseTo(0.6);
    expect(vector?.[1]).toBeCloseTo(0.8);
    expect(embedder.identity.dimensions).toBe(128);
  });

  it("rejects invalid options with RangeError", async () => {
    const fake = createFakeSession({ width: 768 });
    await expect(build(fake.session, { dimensions: 100 })).rejects.toThrow(RangeError);
    await expect(build(fake.session, { threads: 0 })).rejects.toThrow(RangeError);
    await expect(build(fake.session, { threads: 65 })).rejects.toThrow(RangeError);
    await expect(build(fake.session, { threads: 1.5 })).rejects.toThrow(RangeError);
    await expect(build(fake.session, { batchSize: 0 })).rejects.toThrow(RangeError);
    await expect(build(fake.session, { batchSize: 65 })).rejects.toThrow(RangeError);
    await expect(build(fake.session, { maxTokens: 7 })).rejects.toThrow(RangeError);
    await expect(build(fake.session, { maxTokens: 8193 })).rejects.toThrow(RangeError);
    await expect(build(fake.session, { maxCharacters: 0 })).rejects.toThrow(RangeError);
  });

  it("batches, pads, masks, and preserves input order", async () => {
    const fake = createFakeSession({ width: 768, cls: (marker) => [marker, 1, 0] });
    const embedder = await build(fake.session, { batchSize: 4, dimensions: 768 });
    // Marker (first word id) is 10 + first word length: 1..10 letters.
    const texts = Array.from(
      { length: 10 },
      (_, index) => `${"x".repeat(index + 1)}${index % 3 === 0 ? " extra words here" : ""}`,
    );

    const vectors = await embedder.embed(texts, "document");

    expect(vectors).toHaveLength(10);
    expect(fake.runs).toHaveLength(3);
    expect(fake.runs.map((run) => run.dims[0])).toEqual([4, 4, 2]);
    for (const run of fake.runs) {
      const [batch = 0, sequence = 0] = run.dims;
      expect(run.inputIds).toHaveLength(batch);
      for (let row = 0; row < batch; row += 1) {
        const ids = run.inputIds[row] as bigint[];
        const mask = run.attentionMask[row] as bigint[];
        expect(ids).toHaveLength(sequence);
        const real = mask.filter((value) => value === 1n).length;
        expect(mask.slice(0, real).every((value) => value === 1n)).toBe(true);
        expect(mask.slice(real).every((value) => value === 0n)).toBe(true);
        expect(ids[0]).toBe(BigInt(clsId));
        expect(ids[real - 1]).toBe(BigInt(sepId));
        expect(ids.slice(real).every((value) => value === BigInt(padTokenId))).toBe(true);
      }
    }
    // The first batch holds the longest rows (index 0 has 4 words + CLS + SEP = 6 ids).
    expect(fake.runs[0]?.dims[1]).toBe(6);
    // Padding exists in the first batch because rows differ in length.
    expect(fake.runs[0]?.attentionMask.some((row) => row.includes(0n))).toBe(true);
  });

  it("returns vectors in input order across batches", async () => {
    const fake = createFakeSession({
      width: 768,
      cls: (marker) => [marker, 1, ...new Array<number>(766).fill(0)],
    });
    const embedder = await build(fake.session, { batchSize: 2 });
    const texts = ["a", "bb", "ccc", "dddd", "eeeee"];

    const vectors = await embedder.embed(texts, "document");

    expect(vectors).toHaveLength(5);
    vectors.forEach((vector, index) => {
      const marker = 10 + index + 1;
      const norm = Math.hypot(marker, 1);
      expect(vector[0]).toBeCloseTo(marker / norm);
      expect(vector[1]).toBeCloseTo(1 / norm);
    });
  });

  it("truncates long inputs to maxTokens, keeping the first and final special ids", async () => {
    const fake = createFakeSession({ width: 768 });
    const embedder = await build(fake.session, { maxTokens: 8 });
    const text = Array.from({ length: 30 }, (_, index) => "w".repeat(index + 1)).join(" ");

    await embedder.embed([text], "document");

    const ids = fake.runs[0]?.inputIds[0] as bigint[];
    expect(ids).toHaveLength(8);
    expect(ids[0]).toBe(BigInt(clsId));
    expect(ids[7]).toBe(BigInt(sepId));
    expect(ids.slice(1, 7)).toEqual([11n, 12n, 13n, 14n, 15n, 16n]);
    expect(fake.runs[0]?.attentionMask[0]?.every((value) => value === 1n)).toBe(true);
  });

  it("returns an empty array for no texts without running the model", async () => {
    const fake = createFakeSession({ width: 768 });
    const embedder = await build(fake.session);

    await expect(embedder.embed([], "query")).resolves.toEqual([]);
    expect(fake.runs).toHaveLength(0);
  });

  it("rejects blank and over-long text with the index but not the text", async () => {
    const fake = createFakeSession({ width: 768 });
    const embedder = await build(fake.session, { maxCharacters: 20 });

    const blank = await embedder.embed(["fine", "   "], "document").catch((e: unknown) => e);
    expect(blank).toBeInstanceOf(EmbeddingInputError);
    expect((blank as EmbeddingInputError).index).toBe(1);
    expect((blank as EmbeddingInputError).problem).toBe("blank");

    const secret = "confidential sentence that is far too long";
    const tooLong = await embedder.embed([secret], "document").catch((e: unknown) => e);
    expect(tooLong).toBeInstanceOf(EmbeddingInputError);
    expect((tooLong as EmbeddingInputError).index).toBe(0);
    expect((tooLong as EmbeddingInputError).message).not.toContain("confidential");
    expect(fake.runs).toHaveLength(0);
  });

  it("rejects with the abort reason before running", async () => {
    const fake = createFakeSession({ width: 768 });
    const embedder = await build(fake.session);
    const controller = new AbortController();
    const reason = new Error("stop now");
    controller.abort(reason);

    await expect(embedder.embed(["hello"], "query", { signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(fake.runs).toHaveLength(0);
  });

  it("stops between batches when aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("cancelled");
    const fake = createFakeSession({
      width: 768,
      onRun: (index) => {
        if (index === 0) {
          controller.abort(reason);
        }
      },
    });
    const embedder = await build(fake.session, { batchSize: 1 });

    await expect(
      embedder.embed(["one", "two", "three"], "document", { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(fake.runs).toHaveLength(1);
  });

  it("reports missing files without leaking the directory", async () => {
    const fake = createFakeSession({ width: 768 });
    const error = await build(fake.session, { fileInspector: async () => undefined }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(EmbeddingModelUnavailableError);
    expect((error as EmbeddingModelUnavailableError).reason).toBe("missing-file");
    expect((error as Error).message).toContain("onnx/model_int8.onnx");
    expect((error as Error).message).not.toContain(secretDirectory);
  });

  it("reports size mismatches without leaking the directory", async () => {
    const fake = createFakeSession({ width: 768 });
    const error = await build(fake.session, {
      fileInspector: async (relativePath) =>
        relativePath === "tokenizer.json" ? { sizeBytes: 1 } : allFilesPresent(relativePath),
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmbeddingModelUnavailableError);
    expect((error as EmbeddingModelUnavailableError).reason).toBe("size-mismatch");
    expect((error as EmbeddingModelUnavailableError).relativePath).toBe("tokenizer.json");
    expect((error as Error).message).not.toContain(secretDirectory);
  });

  it("exposes a stable identity from the manifest", async () => {
    const fake = createFakeSession({ width: 768 });
    const embedder = await build(fake.session);
    const model = getGraniteEmbeddingModel("311m");

    expect(embedder.identity).toEqual({
      modelId: model.modelId,
      sourceRepository: model.sourceRepository,
      revision: model.revision,
      modelFileSha256: model.files.model.sha256,
      dimensions: 768,
      pooling: "cls",
      runtime: "onnxruntime-node@1.30.0",
    });
    expect(embedder.identity).toBe(embedder.identity);
  });

  it("releases the session on dispose and rejects later use", async () => {
    const released = { value: false };
    const fake = createFakeSession({ width: 768, released });
    const embedder = await build(fake.session);

    await embedder.dispose();

    expect(released.value).toBe(true);
    await expect(embedder.embed(["hello"], "query")).rejects.toThrow(/disposed/);
    await expect(embedder.embed([], "query")).rejects.toThrow(/disposed/);
  });

  it("serializes concurrent embed calls", async () => {
    const fake = createFakeSession({
      width: 768,
      onRun: () => new Promise((resolve) => setTimeout(resolve, 5)),
    });
    const embedder = await build(fake.session, { batchSize: 1 });

    const results = await Promise.all([
      embedder.embed(["one", "two"], "document"),
      embedder.embed(["three"], "query"),
      embedder.embed(["four", "five"], "document"),
    ]);

    expect(results.map((vectors) => vectors.length)).toEqual([2, 1, 2]);
    expect(fake.runs).toHaveLength(5);
    expect(fake.maxActive()).toBe(1);
  });

  it("keeps working after a failed call", async () => {
    const fake = createFakeSession({ width: 768 });
    const embedder = await build(fake.session);

    await expect(embedder.embed([" "], "document")).rejects.toBeInstanceOf(EmbeddingInputError);
    await expect(embedder.embed(["fine"], "document")).resolves.toHaveLength(1);
  });
});
