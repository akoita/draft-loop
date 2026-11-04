import { describe, expect, it } from "vitest";

import { ownerTokenProof, type ProofFetch, serverHoldsToken } from "./token-proof.js";

const token = "owner-token-for-tests-0123456789abcdef";
const origin = "http://127.0.0.1:8080";

/** A server on the address that holds `held`, or answers `answer` as it likes. */
function serverHolding(
  held: string | undefined,
  answer?: unknown,
): ProofFetch & { bodies: string[] } {
  const bodies: string[] = [];
  const fetchImpl = async (url: string, init: Parameters<ProofFetch>[1]) => {
    expect(url).toBe(`${origin}/v1/auth/proof`);
    bodies.push(init.body);
    if (answer !== undefined) return { ok: true, json: async () => answer };
    if (held === undefined) return { ok: false, json: async () => ({}) };
    const { challenge } = JSON.parse(init.body) as { challenge: string };
    return { ok: true, json: async () => ({ proof: ownerTokenProof(held, challenge) }) };
  };
  return Object.assign(fetchImpl, { bodies });
}

describe("server token proof", () => {
  it("computes the same proof as the API", () => {
    // The vector in apps/api/src/owner-token-proof-routes.test.ts.
    expect(ownerTokenProof(token, "a".repeat(64))).toBe(
      "2b67acf4f712c7daf9a943d7ebb52c001afb0a9390b9b9fdadaa2a2d7498ba7d",
    );
  });

  it("trusts the server that holds the token, and never sends the token", async () => {
    const server = serverHolding(token);
    expect(await serverHoldsToken(origin, token, server)).toBe(true);
    expect(server.bodies.join("")).not.toContain(token);
  });

  it("uses a fresh challenge each time", async () => {
    const server = serverHolding(token);
    await serverHoldsToken(origin, token, server);
    await serverHoldsToken(origin, token, server);
    expect(server.bodies[0]).not.toBe(server.bodies[1]);
  });

  it.each([
    ["holds another token", serverHolding("another-token-0123456789abcdefghijkl")],
    ["has no proof route", serverHolding(undefined)],
    ["replays a fixed answer", serverHolding(undefined, { proof: "0".repeat(64) })],
    ["answers garbage", serverHolding(undefined, { proof: 42 })],
  ])("does not trust a server that %s", async (_label, server) => {
    expect(await serverHoldsToken(origin, token, server)).toBe(false);
  });

  it("does not trust a server that cannot be reached", async () => {
    const unreachable: ProofFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await serverHoldsToken(origin, token, unreachable)).toBe(false);
  });
});
