import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApi } from "./app.js";
import { ownerTokenProof } from "./owner-token-proof-routes.js";

const ownerToken = "owner-token-for-tests-0123456789abcdef";
const challenge = "a".repeat(64);

let app: FastifyInstance;

beforeEach(async () => {
  app = await buildApi({ ownerToken });
});

afterEach(async () => {
  await app.close();
});

describe("owner token proof", () => {
  it("answers the HMAC of the challenge without a credential, and never the token", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/proof",
      payload: { challenge },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ proof: ownerTokenProof(ownerToken, challenge) });
    expect(response.body).not.toContain(ownerToken);
    // The vector the desktop client's own computation is tested against.
    expect(ownerTokenProof(ownerToken, challenge)).toBe(
      "2b67acf4f712c7daf9a943d7ebb52c001afb0a9390b9b9fdadaa2a2d7498ba7d",
    );
  });

  it("gives another token a different proof", () => {
    expect(ownerTokenProof(`${ownerToken}x`, challenge)).not.toBe(
      ownerTokenProof(ownerToken, challenge),
    );
  });

  it.each([
    ["short", "abc"],
    ["upper case", "A".repeat(64)],
    ["missing", undefined],
  ])("refuses a %s challenge", async (_label, value) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/proof",
      payload: value === undefined ? {} : { challenge: value },
    });
    expect(response.statusCode).toBe(400);
  });
});
