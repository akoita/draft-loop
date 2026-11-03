import { createHash } from "node:crypto";

/**
 * Each server gets its own persistent storage partition, so its cookies, cache and storage never
 * mix with another server's and can be cleared on their own.
 */
export function partitionFor(origin: string): string {
  const digest = createHash("sha256").update(origin).digest("hex").slice(0, 24);
  return `persist:server-${digest}`;
}
