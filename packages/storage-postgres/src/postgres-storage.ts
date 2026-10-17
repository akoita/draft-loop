import type { AuditEvent, AuditEventInput } from "@draft-loop/storage";
import { createApplications } from "./applications.js";
import { appendAuditEventRow, createAuditEventReads, listAuditEventRows } from "./audit-trail.js";
import { createKnowledgeBaseRecords } from "./knowledge-bases.js";
import { createLexicalIndex } from "./lexical-index.js";
import { migratePostgres } from "./migrations.js";
import { createRunHistory } from "./run-history.js";
import { createSqlClient, type SqlClientOptions } from "./sql-client.js";
import { createVersionedRecords } from "./versioned-records.js";
import { createWorkspaceRecords } from "./workspace-records.js";

export type PostgresStorageOptions = SqlClientOptions;

/**
 * Opens the Postgres implementation of the storage ports, applying pending migrations first.
 * Ports land one group at a time; each group passes the shared conformance suite before it ships.
 */
export async function openPostgresStorage(options: PostgresStorageOptions) {
  const client = createSqlClient(options);
  try {
    await migratePostgres(client);
  } catch (error) {
    await client.close();
    throw error;
  }
  return {
    ...createWorkspaceRecords(client),
    ...createRunHistory(client),
    ...createVersionedRecords(client),
    ...createKnowledgeBaseRecords(client),
    ...createLexicalIndex(client),
    applications: createApplications(client),
    appendAuditEvent: (input: AuditEventInput): Promise<AuditEvent> =>
      client.transaction((executor) => appendAuditEventRow(executor, input)),
    listAuditEvents: (workspaceId: string): Promise<readonly AuditEvent[]> =>
      listAuditEventRows(client, workspaceId),
    auditEvents: createAuditEventReads(client),
    close: () => client.close(),
  };
}

export type PostgresStorage = Awaited<ReturnType<typeof openPostgresStorage>>;
