import { constants } from "node:zlib";

import compress from "@fastify/compress";
import type { FastifyInstance } from "fastify";

/** JSON smaller than this goes out as is: compressing it saves less than it costs. */
export const compressionThresholdBytes = 1024;

/**
 * Only JSON is compressed: `application/json` and the `+json` types. Event streams must flush
 * each event, zip and file downloads are sent byte for byte, and the web screen's files are
 * served from the Brotli and gzip copies the build writes beside them.
 */
const compressibleType = /^application\/(?:[\w.-]+\+)?json\s*(?:;|$)/iu;

/** Whether a response's content type is JSON; a reply without one is serialized as JSON. */
export function isCompressibleType(contentType: unknown): boolean {
  if (contentType === undefined) return true;
  return typeof contentType === "string" && compressibleType.test(contentType);
}

/**
 * Sends JSON above the threshold with Brotli or gzip when the client accepts it (#3258). Brotli
 * quality 4 keeps CPU low on Cloud Run while still shrinking review state many times over.
 * Request bodies are never decompressed: the body limit applies to what the client sends.
 * Register it before the routes, since it hooks each route as it is added.
 */
export async function registerResponseCompression(app: FastifyInstance): Promise<void> {
  await app.register(compress, {
    globalCompression: true,
    globalDecompression: false,
    encodings: ["br", "gzip"],
    threshold: compressionThresholdBytes,
    customTypes: compressibleType,
    brotliOptions: { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } },
  });
  // The plugin also compresses every type its MIME database calls compressible, such as
  // scripts, pages and `application/octet-stream` downloads. Its documented opt-out header keeps
  // them as they are; this application hook runs before the plugin's per-route one.
  app.addHook("onSend", async (request, reply) => {
    if (!isCompressibleType(reply.getHeader("content-type"))) {
      request.headers["x-no-compression"] = "1";
    }
  });
}
