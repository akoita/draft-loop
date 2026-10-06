import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GraniteEmbeddingModel } from "@draft-loop/embeddings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEmbeddingModelService,
  defaultEmbeddingModelRoot,
  EmbeddingModelInstallError,
  embeddingModelDirectory,
} from "./embedding-model-install.js";

const encoder = new TextEncoder();
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const contents: Record<string, string> = {
  "onnx/model_int8.onnx": "model-bytes-0123456789",
  "tokenizer.json": "{tokenizer}",
  "tokenizer_config.json": "{config}",
};

function manifestFile(path: string) {
  const content = contents[path] ?? "";
  return { path, sizeBytes: encoder.encode(content).byteLength, sha256: sha256(content) };
}

const fakeModel: GraniteEmbeddingModel = {
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
};
const models = (): GraniteEmbeddingModel => fakeModel;

function urlFor(path: string): string {
  return `https://huggingface.co/${fakeModel.sourceRepository}/resolve/${fakeModel.revision}/${path}`;
}

function serveContents(overrides: Record<string, () => Response> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    for (const path of Object.keys(contents)) {
      if (url === urlFor(path)) {
        return overrides[path]?.() ?? new Response(contents[path]);
      }
    }
    return new Response("not found", { status: 404 });
  });
}

let root = "";
let modelRoot = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "draft-loop-embedding-install-"));
  modelRoot = join(root, "models");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function service(fetchImpl: typeof fetch, extra: { platform?: string; arch?: string } = {}) {
  return createEmbeddingModelService({
    modelRoot,
    fetch: fetchImpl,
    platform: "linux",
    arch: "x64",
    models,
    ...extra,
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function rootEntries(): Promise<string[]> {
  try {
    return await readdir(modelRoot);
  } catch {
    return [];
  }
}

const directory = () => embeddingModelDirectory(modelRoot, "311m", models);

describe("defaultEmbeddingModelRoot", () => {
  it("uses the per-platform user data directory", () => {
    expect(defaultEmbeddingModelRoot({ env: {}, platform: "linux", homedir: "/home/u" })).toBe(
      join("/home/u", ".local", "share", "draft-loop", "models"),
    );
    expect(
      defaultEmbeddingModelRoot({
        env: { XDG_DATA_HOME: "/xdg" },
        platform: "linux",
        homedir: "/home/u",
      }),
    ).toBe(join("/xdg", "draft-loop", "models"));
    expect(defaultEmbeddingModelRoot({ env: {}, platform: "darwin", homedir: "/Users/u" })).toBe(
      join("/Users/u", "Library", "Application Support", "DraftLoop", "models"),
    );
    expect(
      defaultEmbeddingModelRoot({
        env: { LOCALAPPDATA: "/local" },
        platform: "win32",
        homedir: "/Users/u",
      }),
    ).toBe(join("/local", "DraftLoop", "models"));
    expect(defaultEmbeddingModelRoot({ env: {}, platform: "win32", homedir: "/Users/u" })).toBe(
      join("/Users/u", "AppData", "Local", "DraftLoop", "models"),
    );
  });

  it("lets DRAFT_LOOP_EMBEDDING_MODEL_ROOT override every platform", () => {
    for (const platform of ["linux", "darwin", "win32"]) {
      expect(
        defaultEmbeddingModelRoot({
          env: { DRAFT_LOOP_EMBEDDING_MODEL_ROOT: "/custom/models" },
          platform,
          homedir: "/home/u",
        }),
      ).toBe("/custom/models");
    }
  });
});

describe("embedding model directory", () => {
  it("is <root>/<model name>/<revision> for the real manifest", () => {
    expect(embeddingModelDirectory("/m", "311m")).toBe(
      join(
        "/m",
        "granite-embedding-311m-multilingual-r2",
        "8f039f21d4181327268271bea4b11ddcc7eef88d",
      ),
    );
  });
});

describe("embedding model install", () => {
  it("plans without side effects", async () => {
    const fetchImpl = serveContents();
    const plan = service(fetchImpl).planInstall("311m");
    expect(plan.sourceUrl).toBe(
      `https://huggingface.co/${fakeModel.sourceRepository}/tree/${fakeModel.revision}`,
    );
    expect(plan.files.map((file) => file.path)).toEqual(Object.keys(contents));
    expect(plan.files[0]?.url).toBe(urlFor("onnx/model_int8.onnx"));
    expect(plan.totalSizeBytes).toBe(
      Object.values(contents).reduce((sum, value) => sum + value.length, 0),
    );
    expect(plan.license).toBe("Apache-2.0");
    expect(plan.destination).toBe(directory());
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(modelRoot)).toBe(false);
  });

  it("reports absent without touching the network", async () => {
    const fetchImpl = serveContents();
    const status = await service(fetchImpl).status("311m");
    expect(status).toMatchObject({
      state: "absent",
      modelId: fakeModel.modelId,
      revision: fakeModel.revision,
      license: "Apache-2.0",
      modelDirectory: directory(),
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("downloads, verifies, and installs into the expected layout", async () => {
    const fetchImpl = serveContents();
    const progress: string[] = [];
    const status = await service(fetchImpl).install("311m", {
      onProgress: ({ file, receivedBytes, totalBytes }) =>
        progress.push(`${file}:${receivedBytes}/${totalBytes}`),
    });
    expect(status.state).toBe("ready");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const [path, content] of Object.entries(contents)) {
      expect(await readFile(join(directory(), path), "utf8")).toBe(content);
    }
    expect(progress.at(-1)).toMatch(/^tokenizer_config\.json:\d+\/\d+$/);
    expect(await rootEntries()).toEqual(["fake-embedding-r2"]);
  });

  it("is idempotent once ready", async () => {
    const fetchImpl = serveContents();
    await service(fetchImpl).install("311m");
    fetchImpl.mockClear();
    const status = await service(fetchImpl).install("311m");
    expect(status.state).toBe("ready");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a checksum mismatch and leaves nothing behind", async () => {
    const fetchImpl = serveContents({
      "tokenizer.json": () => new Response("{tokenizeX}"),
    });
    const failure = await service(fetchImpl)
      .install("311m")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EmbeddingModelInstallError);
    expect((failure as EmbeddingModelInstallError).reason).toBe("checksum-mismatch");
    expect(await exists(directory())).toBe(false);
    expect((await rootEntries()).filter((entry) => entry.startsWith(".staging"))).toEqual([]);
  });

  it("rejects a truncated body", async () => {
    const fetchImpl = serveContents({ "tokenizer.json": () => new Response("{token") });
    await expect(service(fetchImpl).install("311m")).rejects.toMatchObject({
      reason: "size-mismatch",
    });
    expect(await exists(directory())).toBe(false);
    expect(await rootEntries()).toEqual([]);
  });

  it("aborts an oversize body", async () => {
    const fetchImpl = serveContents({
      "onnx/model_int8.onnx": () => new Response(`${contents["onnx/model_int8.onnx"]}-extra`),
    });
    await expect(service(fetchImpl).install("311m")).rejects.toMatchObject({
      reason: "size-mismatch",
    });
    expect(await rootEntries()).toEqual([]);
  });

  it("fails on a non-2xx response", async () => {
    const fetchImpl = serveContents({
      "onnx/model_int8.onnx": () => new Response("nope", { status: 404 }),
    });
    const failure = await service(fetchImpl)
      .install("311m")
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: "http-error" });
    expect((failure as Error).message).toContain("404");
    expect(await rootEntries()).toEqual([]);
  });

  it("cancels mid-download and cleans up", async () => {
    const controller = new AbortController();
    const fetchImpl = serveContents({
      "onnx/model_int8.onnx": () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(encoder.encode("model-"));
              // never closes: the abort signal must end the transfer
            },
          }),
        ),
    });
    const pending = service(fetchImpl).install("311m", {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(pending).rejects.toMatchObject({ reason: "cancelled" });
    expect(await exists(directory())).toBe(false);
    expect(await rootEntries()).toEqual([]);
  });

  it("refuses an unsupported platform before any network call", async () => {
    const fetchImpl = serveContents();
    const unsupported = service(fetchImpl, { platform: "darwin", arch: "x64" });
    expect((await unsupported.status("311m")).state).toBe("unsupported-platform");
    await expect(unsupported.install("311m")).rejects.toMatchObject({
      reason: "unsupported-platform",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await exists(modelRoot)).toBe(false);
  });

  it("reports installing while a staging directory exists", async () => {
    await mkdir(join(modelRoot, ".staging-311m-abc"), { recursive: true });
    expect((await service(serveContents()).status("311m")).state).toBe("installing");
    expect((await service(serveContents()).status("97m")).state).toBe("absent");
  });

  it("clears stale staging directories when installing", async () => {
    await mkdir(join(modelRoot, ".staging-311m-stale"), { recursive: true });
    await service(serveContents()).install("311m");
    expect(await rootEntries()).toEqual(["fake-embedding-r2"]);
  });
});

describe("offline import", () => {
  async function writeSource(skip?: string): Promise<string> {
    const source = join(root, "source");
    for (const [path, content] of Object.entries(contents)) {
      if (path === skip) continue;
      await mkdir(join(source, path, ".."), { recursive: true });
      await writeFile(join(source, path), content);
    }
    return source;
  }

  it("installs from a local directory without any network call", async () => {
    const fetchImpl = serveContents();
    const status = await service(fetchImpl).install("311m", { from: await writeSource() });
    expect(status.state).toBe("ready");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readFile(join(directory(), "tokenizer.json"), "utf8")).toBe("{tokenizer}");
  });

  it("fails with source-missing when a file is absent", async () => {
    const failure = await service(serveContents())
      .install("311m", { from: await writeSource("tokenizer.json") })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ reason: "source-missing" });
    expect((failure as Error).message).not.toContain(root);
    expect(await rootEntries()).toEqual([]);
  });

  it("rejects imported files that fail the checksum", async () => {
    const source = await writeSource();
    await writeFile(join(source, "tokenizer.json"), "{tokenizeX}");
    await expect(service(serveContents()).install("311m", { from: source })).rejects.toMatchObject({
      reason: "checksum-mismatch",
    });
    expect(await rootEntries()).toEqual([]);
  });
});

describe("corrupt installs", () => {
  async function installThenDamage(damage: (path: string) => Promise<void>) {
    const fetchImpl = serveContents();
    await service(fetchImpl).install("311m");
    await damage(join(directory(), "tokenizer.json"));
    fetchImpl.mockClear();
    return fetchImpl;
  }

  it("detects a truncated file by size and repairs it on install", async () => {
    const fetchImpl = await installThenDamage((path) => writeFile(path, "{"));
    expect((await service(fetchImpl).status("311m")).state).toBe("corrupt");
    expect((await service(fetchImpl).install("311m")).state).toBe("ready");
    expect(await readFile(join(directory(), "tokenizer.json"), "utf8")).toBe("{tokenizer}");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("detects a missing file", async () => {
    const fetchImpl = await installThenDamage((path) => rm(path));
    expect((await service(fetchImpl).status("311m")).state).toBe("corrupt");
  });

  it("detects same-size corruption only with sha256 verification", async () => {
    const fetchImpl = await installThenDamage((path) => writeFile(path, "{tokenizeX}"));
    const subject = service(fetchImpl);
    expect((await subject.status("311m")).state).toBe("ready");
    expect((await subject.status("311m", { verify: "sha256" })).state).toBe("corrupt");
  });
});

describe("embedding model removal", () => {
  it("deletes the revision directory and stale staging", async () => {
    const subject = service(serveContents());
    await subject.install("311m");
    await mkdir(join(modelRoot, ".staging-311m-old"), { recursive: true });
    await writeFile(join(modelRoot, "keep.txt"), "unrelated");
    const status = await subject.remove("311m");
    expect(status.state).toBe("absent");
    expect(await rootEntries()).toEqual(["keep.txt"]);
  });

  it("is a no-op when nothing is installed", async () => {
    expect((await service(serveContents()).remove("311m")).state).toBe("absent");
  });

  it("never deletes outside the model root", async () => {
    const outside = join(root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "precious.txt"), "keep");
    const hostile = createEmbeddingModelService({
      modelRoot,
      platform: "linux",
      arch: "x64",
      models: () => ({ ...fakeModel, modelId: "org/..", revision: ".." }),
    });
    await expect(hostile.remove("311m")).rejects.toBeInstanceOf(EmbeddingModelInstallError);
    expect(await exists(join(outside, "precious.txt"))).toBe(true);
    expect(await exists(root)).toBe(true);
  });
});
