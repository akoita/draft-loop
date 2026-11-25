import type { FastifyInstance } from "fastify";

/**
 * IndexNow lets a site tell Bing and other engines that pages changed. The engine checks a
 * submission against a key file the site serves at `/<key>.txt`; the deploy that submits the
 * URLs reads the same key from the deployment's settings.
 */
const keyPattern = /^[A-Za-z0-9-]{8,128}$/u;

/** Reads `DRAFT_LOOP_INDEXNOW_KEY`: unset, or 8 to 128 letters, digits and dashes. */
export function readIndexNowKey(env: NodeJS.ProcessEnv): string | undefined {
  const key = (env.DRAFT_LOOP_INDEXNOW_KEY ?? "").trim();
  if (key === "") return undefined;
  if (!keyPattern.test(key)) {
    throw new Error("DRAFT_LOOP_INDEXNOW_KEY must be 8 to 128 letters, digits or dashes.");
  }
  return key;
}

/** Serves the key file at `/<key>.txt`; does nothing without a key. */
export function registerIndexNowKey(app: FastifyInstance, key: string | undefined): void {
  if (key === undefined) return;
  app.get(`/${key}.txt`, { schema: { hide: true } }, async (_request, reply) =>
    reply
      .header("cache-control", "public, max-age=3600")
      .type("text/plain; charset=utf-8")
      .send(key),
  );
}
