import type { SqlClient } from "./sql-client.js";

/** What a claim found: the key is now this caller's, already answered, still running, or taken. */
export type IdempotencyClaim =
  | { readonly state: "claimed" }
  | { readonly state: "completed"; readonly resultJson: string }
  | { readonly state: "running" }
  | { readonly state: "conflict" };

export interface IdempotencyClaimInput {
  readonly scope: string;
  readonly key: string;
  /** SHA-256 of the request, in lower-case hex. */
  readonly fingerprint: string;
  readonly at: Date;
  /** How long the claimer may run before another caller may take the key over. */
  readonly leaseMs: number;
  /** How long the key, and the result once saved, are kept. */
  readonly ttlMs: number;
}

export interface IdempotencyKeyRef {
  readonly scope: string;
  readonly key: string;
  readonly fingerprint: string;
}

/**
 * The tenant's idempotency keys on Postgres. A key is claimed in one statement, so of two
 * concurrent callers exactly one runs the command. Times come from the caller's clock.
 */
export function createIdempotencyKeys(client: SqlClient) {
  return {
    claim: async (input: IdempotencyClaimInput): Promise<IdempotencyClaim> => {
      const at = input.at.toISOString();
      const leaseUntil = new Date(input.at.getTime() + input.leaseMs).toISOString();
      const expiresAt = new Date(input.at.getTime() + input.ttlMs).toISOString();
      return client.transaction(async (executor) => {
        // An expired key, or a running one whose lease ran out, is taken over as new.
        const claimed = await executor.query(
          `INSERT INTO idempotency_keys (scope, key, fingerprint, lease_until, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (tenant_id, scope, key) DO UPDATE
             SET fingerprint = EXCLUDED.fingerprint, result_json = NULL,
                 lease_until = EXCLUDED.lease_until, expires_at = EXCLUDED.expires_at
             WHERE idempotency_keys.expires_at <= $6
                OR (idempotency_keys.result_json IS NULL AND idempotency_keys.lease_until <= $6)
           RETURNING 1`,
          [input.scope, input.key, input.fingerprint, leaseUntil, expiresAt, at],
        );
        if (claimed.length > 0) return { state: "claimed" };
        const [row] = await executor.query(
          "SELECT fingerprint, result_json FROM idempotency_keys WHERE scope = $1 AND key = $2",
          [input.scope, input.key],
        );
        // The row cannot vanish inside this transaction unless a sweep removed it; claim again.
        if (row === undefined) return { state: "running" };
        if (row.fingerprint !== input.fingerprint) return { state: "conflict" };
        return row.result_json === null
          ? { state: "running" }
          : { state: "completed", resultJson: String(row.result_json) };
      });
    },

    /** Saves the claimer's result; resolves to false when the claim was lost to a takeover. */
    complete: async (ref: IdempotencyKeyRef, resultJson: string): Promise<boolean> => {
      const rows = await client.query(
        `UPDATE idempotency_keys SET result_json = $4, lease_until = NULL
          WHERE scope = $1 AND key = $2 AND fingerprint = $3 AND result_json IS NULL
          RETURNING 1`,
        [ref.scope, ref.key, ref.fingerprint, resultJson],
      );
      return rows.length > 0;
    },

    /** Gives up a running claim after the command failed, so the client can retry the key. */
    release: async (ref: IdempotencyKeyRef): Promise<void> => {
      await client.query(
        `DELETE FROM idempotency_keys
          WHERE scope = $1 AND key = $2 AND fingerprint = $3 AND result_json IS NULL`,
        [ref.scope, ref.key, ref.fingerprint],
      );
    },

    /** Removes at most `limit` expired keys and resolves to how many it removed. */
    sweep: async (at: Date, limit: number): Promise<number> => {
      const rows = await client.query(
        `DELETE FROM idempotency_keys WHERE (tenant_id, scope, key) IN (
           SELECT tenant_id, scope, key FROM idempotency_keys
            WHERE expires_at <= $1 ORDER BY expires_at LIMIT $2
         ) RETURNING 1`,
        [at.toISOString(), limit],
      );
      return rows.length;
    },
  };
}

export type PostgresIdempotencyKeys = ReturnType<typeof createIdempotencyKeys>;
