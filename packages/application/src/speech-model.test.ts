import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  checkSpeechModelFile,
  installSpeechModel,
  type SpeechModel,
  SpeechModelInstallError,
  speechModelFile,
  speechModelFilePath,
  whisperBaseSpeechModel,
} from "./speech-model.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

// A tiny invented model with the pinned shape, so no test downloads the real weights.
const config = bytes('{"model_type":"whisper"}');
const weights = bytes("fictional weights");
const model: SpeechModel = {
  ...whisperBaseSpeechModel,
  files: [
    { path: "config.json", sizeBytes: config.byteLength, sha256: sha(config) },
    {
      path: "onnx/encoder_model_quantized.onnx",
      sizeBytes: weights.byteLength,
      sha256: sha(weights),
    },
  ],
};
const served: Record<string, Uint8Array> = {
  "config.json": config,
  "onnx/encoder_model_quantized.onnx": weights,
};
const fakeFetch = (overrides: Record<string, Uint8Array> = {}) =>
  (async (url: string) => {
    const path = url.split(`/resolve/${model.revision}/`)[1] ?? "";
    const body = overrides[path] ?? served[path];
    return body === undefined
      ? new Response("missing", { status: 404 })
      : new Response(Buffer.from(body), { status: 200 });
  }) as unknown as typeof fetch;

let root: string;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

describe("the pinned speech model", () => {
  it("pins whisper base files with sizes and lowercase SHA-256", () => {
    expect(whisperBaseSpeechModel.revision).toMatch(/^[0-9a-f]{40}$/u);
    for (const file of whisperBaseSpeechModel.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(file.sizeBytes).toBeGreaterThan(0);
    }
    expect(speechModelFile(whisperBaseSpeechModel, "tokenizer.json")).toBeDefined();
    expect(speechModelFile(whisperBaseSpeechModel, "../secrets.json")).toBeUndefined();
  });

  it("installs each file after checking it, and skips files already in place", async () => {
    root = await mkdtemp(join(tmpdir(), "speech-model-"));
    const lines: string[] = [];
    await installSpeechModel(root, model, { fetch: fakeFetch(), log: (line) => lines.push(line) });
    expect(lines).toHaveLength(2);
    const [first] = model.files;
    if (first === undefined) throw new Error("fixture");
    expect(await readFile(speechModelFilePath(root, model, first))).toEqual(Buffer.from(config));
    expect(await checkSpeechModelFile(root, model, first)).toBe("ready");
    await installSpeechModel(root, model, { fetch: fakeFetch(), log: (line) => lines.push(line) });
    expect(lines).toHaveLength(2);
  });

  it("refuses a download that differs from the pin and writes nothing", async () => {
    root = await mkdtemp(join(tmpdir(), "speech-model-"));
    await expect(
      installSpeechModel(root, model, { fetch: fakeFetch({ "config.json": bytes('{"x":1}') }) }),
    ).rejects.toBeInstanceOf(SpeechModelInstallError);
    const [first] = model.files;
    if (first === undefined) throw new Error("fixture");
    expect(await checkSpeechModelFile(root, model, first)).toBe("absent");
  });

  it("reports a changed file on disk as corrupt", async () => {
    root = await mkdtemp(join(tmpdir(), "speech-model-"));
    await installSpeechModel(root, model, { fetch: fakeFetch() });
    const [first] = model.files;
    if (first === undefined) throw new Error("fixture");
    await writeFile(speechModelFilePath(root, model, first), bytes('{"model_type":"WHISPER"}'));
    expect(await checkSpeechModelFile(root, model, first)).toBe("corrupt");
  });
});
