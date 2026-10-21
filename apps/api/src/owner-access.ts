import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Phase 1 serves one person, the owner, and has no sign-up (ADR 0011, phase 1). Every route but
 * health requires the owner's bearer token until sign-in through the identity provider (D6)
 * replaces it in phase 2.
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
