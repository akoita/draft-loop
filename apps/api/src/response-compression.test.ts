import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { brotliCompressSync, brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { compressionThresholdBytes, registerResponseCompression } from "./response-compression.js";

const large = { items: Array.from({ length: 400 }, (_, index) => ({ index, text: "review" })) };
const small = { ok: true };
const events = `${'data: {"step":"draft"}\n\n'.repeat(200)}`;
const zipBytes = Buffer.alloc(4096, 7);

describe("response compression", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await registerResponseCompression(app);
    app.get("/large", async () => large);
    app.get("/small", async () => small);
    app.get("/problem", async (_request, reply) =>
      reply.type("application/problem+json").send(JSON.stringify(large)),
    );
    app.get("/events", async (_request, reply) => reply.type("text/event-stream").send(events));
    app.get("/archive", async (_request, reply) =>
      reply
        .type("application/zip")
        .header("content-disposition", 'attachment; filename="archive.zip"')
        .send(Readable.from([zipBytes])),
    );
    app.get("/file", async (_request, reply) =>
      reply.type("application/octet-stream").send(Buffer.alloc(4096, 1)),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("sends large JSON with Brotli when the client accepts it", async () => {
    const response = await app.inject({
      url: "/large",
      headers: { "accept-encoding": "br, gzip" },
    });
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers.vary).toMatch(/accept-encoding/iu);
    expect(response.rawPayload.length).toBeLessThan(JSON.stringify(large).length / 4);
    expect(JSON.parse(brotliDecompressSync(response.rawPayload).toString())).toEqual(large);
  });

  it("sends large JSON with gzip when that is all the client accepts", async () => {
    const response = await app.inject({ url: "/large", headers: { "accept-encoding": "gzip" } });
    expect(response.headers["content-encoding"]).toBe("gzip");
    expect(JSON.parse(gunzipSync(response.rawPayload).toString())).toEqual(large);
  });

  it("compresses the +json types too", async () => {
    const response = await app.inject({ url: "/problem", headers: { "accept-encoding": "br" } });
    expect(response.headers["content-encoding"]).toBe("br");
  });

  it("sends JSON as is to a client that accepts no encoding", async () => {
    const response = await app.inject({ url: "/large", headers: { "accept-encoding": "" } });
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.json()).toEqual(large);
  });

  it("leaves JSON under the threshold alone", async () => {
    expect(JSON.stringify(small).length).toBeLessThan(compressionThresholdBytes);
    const response = await app.inject({ url: "/small", headers: { "accept-encoding": "br" } });
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.json()).toEqual(small);
  });

  it("never compresses an event stream", async () => {
    const response = await app.inject({ url: "/events", headers: { "accept-encoding": "br" } });
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.body).toBe(events);
  });

  it("never compresses a zip download", async () => {
    const response = await app.inject({ url: "/archive", headers: { "accept-encoding": "br" } });
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.rawPayload.equals(zipBytes)).toBe(true);
  });

  it("never compresses a file download", async () => {
    const response = await app.inject({ url: "/file", headers: { "accept-encoding": "br" } });
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.rawPayload.length).toBe(4096);
  });

  it("does not decompress request bodies", async () => {
    const route = Fastify();
    await registerResponseCompression(route);
    route.post("/echo", async (request) => ({ received: typeof request.body }));
    const response = await route.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json", "content-encoding": "gzip" },
      payload: gzipSync(JSON.stringify(small)),
    });
    expect(response.statusCode).toBe(400);
    await route.close();
  });
});

describe("response compression in the hosted API", () => {
  const ownerToken = "owner-token-for-tests-0123456789abcdef";
  const script = `console.log(${JSON.stringify("x".repeat(4000))});`;
  let api: FastifyInstance;
  let webRoot: string;

  beforeAll(async () => {
    webRoot = await mkdtemp(join(tmpdir(), "draft-loop-compression-"));
    await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Home</title>");
    await writeFile(join(webRoot, "app.js"), script);
    await writeFile(join(webRoot, "app.js.br"), brotliCompressSync(script));
    await writeFile(join(webRoot, "plain.js"), script);
    api = await buildApi({ ownerToken, webRoot });
  });

  afterAll(async () => {
    await api.close();
    await rm(webRoot, { recursive: true, force: true });
  });

  it("compresses the API's JSON", async () => {
    const response = await api.inject({
      url: "/v1/openapi.json",
      headers: { authorization: `Bearer ${ownerToken}`, "accept-encoding": "br" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(JSON.parse(brotliDecompressSync(response.rawPayload).toString()).openapi).toBe("3.1.0");
  });

  it("serves the build's Brotli copy of a web file once, not compressed again", async () => {
    const response = await api.inject({ url: "/app.js", headers: { "accept-encoding": "br" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBe("br");
    expect(brotliDecompressSync(response.rawPayload).toString()).toBe(script);
  });

  it("leaves a web file without a compressed copy as it is", async () => {
    const response = await api.inject({ url: "/plain.js", headers: { "accept-encoding": "br" } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-encoding"]).toBeUndefined();
    expect(response.body).toBe(script);
  });
});
