import { createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

/**
 * How a client checks that a server holds the owner token before it hands that token over
 * (threat model S-021, #2148). The client sends a fresh random challenge; the server answers an
 * HMAC of it keyed by the owner token, which the client recomputes with its remembered token. A
 * different process on the same address cannot answer without the token, and the answer reveals
 * nothing about it. The desktop client computes the same value (`apps/desktop-client`).
 */
export const ownerTokenProofPath = "/v1/auth/proof";

export const ownerTokenProofLabel = "draft-loop owner token proof v1\n";

const proofRequestSchema = z
  .object({
    challenge: z
      .string()
      .regex(/^[0-9a-f]{64}$/u)
      .describe("32 random bytes as lower-case hex, fresh for each check."),
  })
  .strict()
  .meta({ id: "OwnerTokenProofRequest" });

const proofSchema = z
  .object({
    proof: z
      .string()
      .describe("HMAC-SHA256 of the label and the challenge, keyed by the owner token, as hex."),
  })
  .meta({ id: "OwnerTokenProof" });

export function ownerTokenProof(ownerToken: string, challenge: string): string {
  return createHmac("sha256", ownerToken)
    .update(ownerTokenProofLabel + challenge)
    .digest("hex");
}

export function registerOwnerTokenProofRoutes(app: FastifyInstance, ownerToken: string): void {
  app.withTypeProvider<ZodTypeProvider>().post(
    ownerTokenProofPath,
    {
      schema: {
        summary: "Prove this server holds the owner token, without either side sending it",
        security: [],
        body: proofRequestSchema,
        response: { 200: proofSchema },
      },
    },
    async (request) => ({ proof: ownerTokenProof(ownerToken, request.body.challenge) }),
  );
}
