import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createEmbeddingModelService } from "@draft-loop/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { embeddingModelReadiness, installBakedEmbeddingModel } from "./embedding-model.js";

type Models = NonNullable<Parameters<typeof createEmbeddingModelService>[0]["models"]>;

const contents: Record<string, string> = {
  "onnx/model_int8.onnx": "model-bytes-0123456789",
  "tokenizer.json": "{tokenizer}",
  "tokenizer_config.json": "{config}",
};

function manifestFile(path: string) {
  const content = contents[path] ?? "";
  return {
    path,
    sizeBytes: Buffer.byteLength(content),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

// A tiny stand-in for the pinned model, so the install's checks run without 350 MB of files.
const models: Models = () => ({
  tier: "311m",
  modelId: "example-org/fake-embedding-r2",
  sourceRepository: "example-org/fake-embedding-r2-ONNX",
  revision: "0123456789abcdef0123456789abcdef01234567",
  license: "Apache-2.0",
  nativeDimensions: 4,
  matryoshkaDimensions: [4],
  pooling: "cls",
  queryPrefix: "",
  documentPrefix: "",
  defaultMaxTokens: 512,
  maximumMaxTokens: 8192,
  files: {
    model: manifestFile("onnx/model_int8.onnx"),
    tokenizer: manifestFile("tokenizer.json"),
    tokenizerConfig: manifestFile("tokenizer_config.json"),
  },
});

let root = "";
let downloaded = "";
let modelRoot = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "draft-loop-worker-model-"));
  downloaded = join(root, "download");
  modelRoot = join(root, "models");
  for (const [path, content] of Object.entries(contents)) {
    await mkdir(dirname(join(downloaded, path)), { recursive: true });
    await writeFile(join(downloaded, path), content);
  }
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const service = () => createEmbeddingModelService({ modelRoot, models });

describe("the worker image's embedding model (#1806)", () => {
  it("installs the downloaded files into the model root, where the worker then finds it ready", async () => {
    const installed = await installBakedEmbeddingModel({
      from: downloaded,
      modelRoot,
      service: service(),
    });

    expect(installed).toMatchObject({ tier: "311m", state: "ready" });
    expect(await readFile(join(installed.modelDirectory, "tokenizer.json"), "utf8")).toBe(
      "{tokenizer}",
    );
    await expect(
      embeddingModelReadiness({ DRAFT_LOOP_EMBEDDING_MODEL_ROOT: modelRoot }, service()),
    ).resolves.toEqual({ tier: "311m", state: "ready" });
  });

  it("fails the build on a file that does not match the pinned checksum", async () => {
    await writeFile(join(downloaded, "tokenizer.json"), "{tokenizeR}");

    await expect(
      installBakedEmbeddingModel({ from: downloaded, modelRoot, service: service() }),
    ).rejects.toMatchObject({ reason: "checksum-mismatch" });
  });

  it("reports a worker without the model, whose critic then judges no coverage", async () => {
    await expect(
      embeddingModelReadiness({ DRAFT_LOOP_EMBEDDING_MODEL_ROOT: modelRoot }, service()),
    ).resolves.toEqual({ tier: "311m", state: "absent" });
  });
});
