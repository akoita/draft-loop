import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type SpeechModel, whisperBaseSpeechModel } from "@draft-loop/application/speech-model";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterEach, describe, expect, it } from "vitest";

import { registerSpeechModelRoutes } from "./speech-model-routes.js";

const bytes = (text: string) => Buffer.from(text);
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
// An invented two-file model with the pinned shape; the real weights are never read in tests.
const config = bytes('{"model_type":"whisper"}');
const weights = bytes("fictional weights");
const model: SpeechModel = {
  ...whisperBaseSpeechModel,
  files: [
    { path: "config.json", sizeBytes: config.length, sha256: sha(config) },
    { path: "onnx/encoder_model_quantized.onnx", sizeBytes: weights.length, sha256: sha(weights) },
  ],
};
const base = `/speech-models/whisper-base/${model.revision}/`;

let app: FastifyInstance;
let root: string | undefined;
afterEach(async () => {
  await app.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function place(files: Record<string, Buffer>): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "speech-routes-"));
  for (const [path, data] of Object.entries(files)) {
    const target = join(folder, model.id, model.revision, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  return folder;
}

async function build(folder: string | undefined) {
  app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerSpeechModelRoutes(app, { root: folder, model });
  await app.ready();
}

describe("speech model routes", () => {
  it("serves the manifest and each pinned file with an immutable cache", async () => {
    root = await place({ "config.json": config, "onnx/encoder_model_quantized.onnx": weights });
    await build(root);
    const manifest = await app.inject({ url: "/speech-models/manifest.json" });
    expect(manifest.json()).toMatchObject({ available: true, model: "whisper-base", base });
    const file = await app.inject({ url: `${base}onnx/encoder_model_quantized.onnx` });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload).toEqual(weights);
    expect(file.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("refuses a changed file, a missing one and any path outside the pin", async () => {
    root = await place({ "config.json": bytes('{"model_type":"other"}') });
    await build(root);
    expect((await app.inject({ url: `${base}config.json` })).statusCode).toBe(503);
    expect((await app.inject({ url: `${base}onnx/encoder_model_quantized.onnx` })).statusCode).toBe(
      404,
    );
    expect((await app.inject({ url: `${base}../../etc/passwd` })).statusCode).toBe(404);
    expect((await app.inject({ url: "/speech-models/manifest.json" })).json().available).toBe(
      false,
    );
  });

  it("reports the model unavailable when the server has no folder for it", async () => {
    await build(undefined);
    expect((await app.inject({ url: "/speech-models/manifest.json" })).json().available).toBe(
      false,
    );
    expect((await app.inject({ url: `${base}config.json` })).statusCode).toBe(404);
  });
});
