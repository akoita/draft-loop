import { isAbsolute, join } from "node:path";
import type { BlobStoragePort } from "@draft-loop/storage";
import type { FastifyInstance } from "fastify";

/** The runtime role the Postgres flow tests connect as, with no superuser rights. */
export const runtimeRole = "draft_loop_test_app";

export function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

/**
 * Filesystem blobs that also take the tenant's relative keys, as Cloud Storage does, by placing
 * them under `root`; references keep the key the caller gave.
 */
export function tenantKeyBlobs(root: string, blobs: BlobStoragePort): BlobStoragePort {
  const path = (location: string) => (isAbsolute(location) ? location : join(root, location));
  return {
    put: async (location, content) => ({
      ...(await blobs.put(path(location), content)),
      location,
    }),
    get: (reference) => blobs.get({ ...reference, location: path(reference.location) }),
    exists: (reference) => blobs.exists({ ...reference, location: path(reference.location) }),
    delete: (reference) => blobs.delete({ ...reference, location: path(reference.location) }),
  };
}

/** `fetch` over the API in process, so the web client sends exactly what a browser would. */
export function injectFetch(api: FastifyInstance): typeof fetch {
  return async (input, init = {}) => {
    const url = new URL(String(input), "http://api.test");
    const body = init.body;
    const response = await api.inject({
      method: (init.method ?? "GET") as "GET",
      url: `${url.pathname}${url.search}`,
      headers: init.headers as Record<string, string>,
      ...(body === undefined || body === null
        ? {}
        : {
            payload:
              body instanceof Blob ? Buffer.from(await body.arrayBuffer()) : (body as string),
          }),
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers))
      if (value !== undefined) headers.set(name, String(value));
    // A 204 or 304 answer carries no body, and Response refuses one, even when empty.
    const empty = response.statusCode === 204 || response.statusCode === 304;
    return new Response(empty ? null : new Uint8Array(response.rawPayload), {
      status: response.statusCode,
      headers,
    });
  };
}
