import { randomUUID } from "node:crypto";
import {
  type ConsentBasis,
  type ConsentEntry,
  type ConsentEntryInput,
  type ConsentKind,
  type ConsentLedger,
  type ConsentRecorder,
  type ConsentState,
  currentConsents,
  requireConsentEntryInput,
  requireConsentWorkspaceId,
} from "@draft-loop/storage/consent-ledger";
import type { SqlRow, SqlSession } from "./sql-client.js";

const entryColumns =
  "id, workspace_id, kind, action, basis, recorded_by, recorded_by_member_id, providers, note, recorded_at";

function timestamp(value: unknown): string {
  return (value instanceof Date ? value : new Date(String(value))).toISOString();
}

/** The table's checks hold the enums, so a row's values are the port's. */
function consentEntry(row: SqlRow): ConsentEntry {
  const recordedBy: ConsentRecorder =
    row.recorded_by === "member"
      ? { kind: "member", memberId: String(row.recorded_by_member_id) }
      : { kind: "owner" };
  const entry: ConsentEntry = {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    kind: String(row.kind) as ConsentKind,
    action: row.action === "withdrawn" ? "withdrawn" : "granted",
    basis: String(row.basis) as ConsentBasis,
    recordedBy,
    providers: (row.providers as readonly string[] | null) ?? [],
    recordedAt: timestamp(row.recorded_at),
  };
  return row.note === null || row.note === undefined ? entry : { ...entry, note: String(row.note) };
}

/**
 * The tenant's consent ledger on Postgres. Entries are only ever inserted, and a record's history
 * reads back in insertion order, so its latest entry of each kind is its current state.
 */
export function createConsentLedger(client: SqlSession): ConsentLedger {
  const history = async (workspaceId: string): Promise<readonly ConsentEntry[]> => {
    const rows = await client.query(
      `SELECT ${entryColumns} FROM consent_events WHERE workspace_id = $1 ORDER BY sequence`,
      [requireConsentWorkspaceId(workspaceId)],
    );
    return rows.map(consentEntry);
  };
  return {
    record: async (input: ConsentEntryInput): Promise<ConsentEntry> => {
      const entry = requireConsentEntryInput(input);
      const [row] = await client.query(
        `INSERT INTO consent_events
           (id, workspace_id, kind, action, basis, recorded_by, recorded_by_member_id, providers, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING ${entryColumns}`,
        [
          `consent-${randomUUID()}`,
          entry.workspaceId,
          entry.kind,
          entry.action,
          entry.basis,
          entry.recordedBy.kind,
          entry.recordedBy.kind === "member" ? entry.recordedBy.memberId : null,
          entry.providers ?? [],
          entry.note ?? null,
        ],
      );
      if (row === undefined) throw new Error("The consent entry was not recorded.");
      return consentEntry(row);
    },
    history,
    current: async (workspaceId: string): Promise<ConsentState> =>
      currentConsents(await history(workspaceId)),
  };
}
