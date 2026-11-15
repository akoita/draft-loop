import type { SqlSession } from "./sql-client.js";

/** The longest name a candidate record takes, in characters. */
export const recordNameMaxLength = 80;

export class RecordNameError extends Error {
  override readonly name = "RecordNameError";
}

/**
 * A record name as it is stored: trimmed, inner whitespace runs as one space, 1 to 80 characters,
 * no control characters. Anything a person would type as a name or a short sentence passes.
 */
export function normaliseRecordName(value: string): string {
  const name = value.replace(/\s+/gu, " ").trim();
  if (name.length === 0) throw new RecordNameError("A record name cannot be empty.");
  if (name.length > recordNameMaxLength) {
    throw new RecordNameError(`A record name has at most ${recordNameMaxLength} characters.`);
  }
  if (/\p{Cc}/u.test(name)) {
    throw new RecordNameError("A record name cannot hold control characters.");
  }
  return name;
}

/** One tenant's candidate record names (#2737). A record without a name is shown by its id. */
export interface RecordNames {
  /** Every named record of the tenant, by record id. */
  readonly list: () => Promise<ReadonlyMap<string, string>>;
  /** Names or renames a record and answers the stored name. */
  readonly set: (input: {
    readonly workspaceId: string;
    readonly name: string;
    readonly now: Date;
  }) => Promise<string>;
}

export function createRecordNames(client: SqlSession): RecordNames {
  return {
    list: async () => {
      const rows = await client.query("SELECT workspace_id, name FROM candidate_record_names");
      return new Map(rows.map((row) => [String(row.workspace_id), String(row.name)]));
    },
    set: async ({ workspaceId, name, now }) => {
      if (workspaceId.length < 1 || workspaceId.length > 256) {
        throw new RecordNameError("A workspace id must have 1 to 256 characters.");
      }
      const stored = normaliseRecordName(name);
      await client.query(
        `INSERT INTO candidate_record_names (workspace_id, name, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, workspace_id)
         DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`,
        [workspaceId, stored, now.toISOString()],
      );
      return stored;
    },
  };
}
