import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Phase 1 serves one person, the owner, and has no sign-up (ADR 0011, phase 1). In owner mode, the
 * default, every route but health requires the owner's bearer token. Sign-in mode accepts the
 * identity provider's tokens instead (D6, `oidc-sign-in.ts`) and keeps the owner token as the
 * operator's credential.
 */
export const ownerTokenMinimumLength = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Whether an `Authorization` header carries exactly the owner's token, compared in constant time. */
export function isOwnerAuthorization(header: string | undefined, ownerToken: string): boolean {
  if (header === undefined) return false;
  const match = /^Bearer ([^\s]+)$/u.exec(header);
  if (match?.[1] === undefined) return false;
  // Hash both sides so the comparison takes the same time whatever the presented length.
  return timingSafeEqual(digest(match[1]), digest(ownerToken));
}
