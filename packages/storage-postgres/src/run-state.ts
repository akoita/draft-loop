import { sensitiveKeyPattern } from "@draft-loop/storage/audit-trail";
import { StorageSecurityError, StorageValidationError } from "@draft-loop/storage/errors";
import { requireNonEmpty } from "@draft-loop/storage/history-records";
import type { SqlSession } from "./sql-client.js";

/**
 * The key-value port the orchestrator keeps run state in, as rows of one tenant. It refuses the
 * same credential-like keys as the local store, and a write is one upsert.
 */
export function createRunState(client: SqlSession) {
  return {
    get: async (key: string): Promise<string | undefined> => {
      requireNonEmpty(key, "key");
      const [row] = await client.query("SELECT value FROM run_state_entries WHERE key = $1", [key]);
      return row === undefined ? undefined : String(row.value);
    },
    set: async (key: string, value: string): Promise<void> => {
      requireNonEmpty(key, "key");
      if (sensitiveKeyPattern.test(key)) {
        throw new StorageSecurityError(
          "Sensitive provider or credential values are not persisted.",
        );
      }
      // Postgres text cannot hold NUL; refuse it rather than store something else.
      if (value.includes("\0")) {
        throw new StorageValidationError("Run state values must not contain NUL");
      }
      await client.query(
        `INSERT INTO run_state_entries (key, value) VALUES ($1, $2)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, value],
      );
    },
  };
}
