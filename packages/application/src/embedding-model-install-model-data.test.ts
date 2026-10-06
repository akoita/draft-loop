import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GraniteEmbeddingModel } from "@draft-loop/embeddings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmbeddingModelService } from "./embedding-model-install.js";

const encoder = new TextEncoder();
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const contents: Record<string, string> = {
  "onnx/model.onnx": "graph-bytes",
  "onnx/model.onnx_data": "external-weights-0123456789",
  "tokenizer.json": "{tokenizer}",
  "tokenizer_config.json": "{config}",
};

function manifestFile(path: string) {
  const content = contents[path] ?? "";
  return { path, sizeBytes: encoder.encode(content).byteLength, sha256: sha256(content) };
}

const externalDataModel: GraniteEmbeddingModel = {
  tier: "eg2-text",
  modelId: "example-org/fake-external-data",
  sourceRepository: "example-org/fake-external-data-ONNX",
  revision: "0123456789abcdef0123456789abcdef01234567",
  license: "Apache-2.0",
  nativeDimensions: 4,
  matryoshkaDimensions: [4],
  pooling: "mean",
  queryPrefix: "",
  documentPrefix: "",
  defaultMaxTokens: 512,
  maximumMaxTokens: 8192,
  files: {
    model: manifestFile("onnx/model.onnx"),
    modelData: manifestFile("onnx/model.onnx_data"),
    tokenizer: manifestFile("tokenizer.json"),
    tokenizerConfig: manifestFile("tokenizer_config.json"),
  },
};

function serve(corrupt: readonly string[] = []) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const [path, content] of Object.entries(contents)) {
      if (url.endsWith(`/${path}`)) {
        return new Response(corrupt.includes(path) ? content.replace(/.$/u, "!") : content);
      }
    }
    return new Response("not found", { status: 404 });
  });
}

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "draft-loop-embedding-model-data-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function service(fetchImpl: typeof fetch) {
  return createEmbeddingModelService({
    modelRoot: join(root, "models"),
    fetch: fetchImpl,
    platform: "linux",
    arch: "x64",
    models: () => externalDataModel,
  });
}

describe("embedding model with an external data file", () => {
  it("plans, installs, and verifies the data file next to the graph", async () => {
    const embeddings = service(serve());

    const plan = embeddings.planInstall("eg2-text");
    expect(plan.files.map((file) => file.path)).toEqual([
      "onnx/model.onnx",
      "onnx/model.onnx_data",
      "tokenizer.json",
      "tokenizer_config.json",
    ]);
    expect(plan.totalSizeBytes).toBe(
      Object.values(contents).reduce((sum, value) => sum + encoder.encode(value).byteLength, 0),
    );

    const installed = await embeddings.install("eg2-text");
    expect(installed.state).toBe("ready");
    expect(await readdir(join(installed.modelDirectory, "onnx"))).toEqual([
      "model.onnx",
      "model.onnx_data",
    ]);
    expect(await readFile(join(installed.modelDirectory, "onnx/model.onnx_data"), "utf8")).toBe(
      contents["onnx/model.onnx_data"],
    );
    expect((await embeddings.status("eg2-text", { verify: "sha256" })).state).toBe("ready");
  });

  it("rejects a data file that fails its checksum and leaves nothing installed", async () => {
    const embeddings = service(serve(["onnx/model.onnx_data"]));

    await expect(embeddings.install("eg2-text")).rejects.toMatchObject({
      reason: "checksum-mismatch",
    });
    expect((await embeddings.status("eg2-text")).state).toBe("absent");
  });
});
