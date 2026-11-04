import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Checks that a server holds the remembered owner token before the client hands it over (threat
 * model S-021, #2148). The client sends a fresh challenge to `POST /v1/auth/proof`; the server
 * answers an HMAC of it keyed by its owner token (`apps/api/src/owner-token-proof-routes.ts`).
 * Another process answering on the same address cannot compute it without the token.
 */

export const ownerTokenProofLabel = "draft-loop owner token proof v1\n";

export const tokenProofTimeoutMs = 5_000;

export type ProofFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    redirect: "error";
  },
) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;

export function ownerTokenProof(token: string, challenge: string): string {
  return createHmac("sha256", token)
    .update(ownerTokenProofLabel + challenge)
    .digest("hex");
}

/** True only when the server at `origin` answers the proof for `token`; false on any failure. */
export async function serverHoldsToken(
  origin: string,
  token: string,
  fetchImpl: ProofFetch,
  timeoutMs: number = tokenProofTimeoutMs,
  challenge: string = randomBytes(32).toString("hex"),
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${origin}/v1/auth/proof`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge }),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    const proof =
      typeof body === "object" && body !== null && "proof" in body ? body.proof : undefined;
    if (typeof proof !== "string" || !/^[0-9a-f]{64}$/u.test(proof)) return false;
    return timingSafeEqual(
      Buffer.from(proof, "hex"),
      Buffer.from(ownerTokenProof(token, challenge), "hex"),
    );
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
