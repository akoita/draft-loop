/**
 * Connection pool sizes for the hosted runtimes. Every API instance, worker execution and
 * Keycloak share one Cloud SQL instance whose `max_connections` is small (25 on staging's
 * db-f1-micro), so each pool is capped explicitly instead of taking a driver's default of 10.
 */
export class PoolSizeError extends Error {
  override readonly name = "PoolSizeError";
}

const largestPool = 50;

/** Reads a whole-number pool size from 1 to 50, or the runtime's fallback when unset. */
export function readPoolSize(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name] ?? "";
  if (raw === "") return fallback;
  const size = Number(raw);
  if (!Number.isInteger(size) || size < 1 || size > largestPool) {
    throw new PoolSizeError(
      `${name} must be a whole number of connections from 1 to ${largestPool}.`,
    );
  }
  return size;
}
