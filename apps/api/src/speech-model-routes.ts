import { createReadStream } from "node:fs";
import {
  checkSpeechModelFile,
  type SpeechModel,
  type SpeechModelFileState,
  speechModelFile,
  speechModelFilePath,
  whisperBaseSpeechModel,
} from "@draft-loop/application/speech-model";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

/** Where the speech model's manifest and files are served; outside `/v1`, so public like the screen. */
export const speechModelPrefix = "/speech-models";

const manifestSchema = z
  .object({
    available: z.boolean().describe("Whether this server holds the pinned files and serves them."),
    model: z.string(),
    revision: z.string(),
    dtype: z.string(),
    license: z.string(),
    base: z.string().describe("The path the files are served under, ending in a slash."),
    files: z.array(z.object({ path: z.string(), sizeBytes: z.number(), sha256: z.string() })),
  })
  .meta({ id: "SpeechModelManifest" });

/**
 * Serves the pinned speech model to the web screen (#2199): a manifest, then each pinned file under
 * its revision, with a year-long immutable cache. A file is checked against its pinned SHA-256 once
 * per process before it is first served; a missing file answers 404 and a changed one 503, so a
 * browser never runs bytes other than the pin. Any other path answers 404.
 */
export function registerSpeechModelRoutes(
  app: FastifyInstance,
  options: { readonly root?: string | undefined; readonly model?: SpeechModel },
): void {
  const model = options.model ?? whisperBaseSpeechModel;
  const base = `${speechModelPrefix}/${model.id}/${model.revision}/`;
  const checked = new Map<string, Promise<SpeechModelFileState>>();
  const stateOf = (path: string): Promise<SpeechModelFileState> => {
    const file = speechModelFile(model, path);
    if (options.root === undefined || file === undefined) return Promise.resolve("absent");
    const existing = checked.get(path);
    if (existing !== undefined) return existing;
    const state = checkSpeechModelFile(options.root, model, file);
    checked.set(path, state);
    return state;
  };

  app.get(
    `${speechModelPrefix}/manifest.json`,
    {
      schema: {
        summary: "Describe the speech model this server serves",
        security: [],
        response: { 200: manifestSchema },
      },
    },
    async (_request, reply) => {
      const states = await Promise.all(model.files.map((file) => stateOf(file.path)));
      void reply.header("cache-control", "no-cache");
      return {
        available: states.every((state) => state === "ready"),
        model: model.id,
        revision: model.revision,
        dtype: model.dtype,
        license: model.license,
        base,
        files: model.files.map((file) => ({ ...file })),
      };
    },
  );

  app.get(`${base}*`, { schema: { hide: true } }, async (request, reply) => {
    const path = (request.params as { "*": string })["*"];
    const file = speechModelFile(model, path);
    const state = await stateOf(path);
    if (file === undefined || options.root === undefined || state === "absent") {
      return reply.code(404).send({
        error: {
          code: "speech_model_unavailable",
          message: "This server does not serve that file.",
        },
      });
    }
    if (state === "corrupt") {
      return reply.code(503).send({
        error: {
          code: "speech_model_corrupt",
          message: "The speech model on this server differs from its pin; reinstall it.",
        },
      });
    }
    return reply
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("content-length", String(file.sizeBytes))
      .type(path.endsWith(".json") ? "application/json" : "application/octet-stream")
      .send(createReadStream(speechModelFilePath(options.root, model, file)));
  });
}
