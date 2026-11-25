import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { readIndexNowKey } from "./indexnow.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const origin = "https://draftloop.example";
const key = "0123456789abcdef0123456789abcdef";

describe("reading the IndexNow key", () => {
  it("accepts no key or a well-formed one", () => {
    expect(readIndexNowKey({})).toBeUndefined();
    expect(readIndexNowKey({ DRAFT_LOOP_INDEXNOW_KEY: ` ${key} ` })).toBe(key);
  });

  it("refuses a key engines would reject", () => {
    expect(() => readIndexNowKey({ DRAFT_LOOP_INDEXNOW_KEY: "short" })).toThrow(/8 to 128/);
    expect(() => readIndexNowKey({ DRAFT_LOOP_INDEXNOW_KEY: "../etc/passwd!" })).toThrow();
  });
});

describe("the IndexNow key file", () => {
  let indexed: FastifyInstance;
  let unindexed: FastifyInstance;

  beforeAll(async () => {
    indexed = await buildApi({
      ownerToken,
      publicSite: { indexing: true, origin, indexNowKey: key },
    });
    unindexed = await buildApi({
      ownerToken,
      publicSite: { indexing: false, origin, indexNowKey: key },
    });
  });

  afterAll(async () => {
    await indexed.close();
    await unindexed.close();
  });

  it("serves the key at /<key>.txt while indexing is on", async () => {
    const response = await indexed.inject({ method: "GET", url: `/${key}.txt` });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^text\/plain/);
    expect(response.body).toBe(key);
  });

  it("serves no key file while indexing is off", async () => {
    const response = await unindexed.inject({ method: "GET", url: `/${key}.txt` });
    expect(response.statusCode).not.toBe(200);
    expect(response.body).not.toBe(key);
  });
});
