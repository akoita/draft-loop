import { afterEach, describe, expect, it } from "vitest";

import { createAuditEventReads, latestAuditEventSql } from "./audit-event-reads.js";
import { type JsonValue, openSqliteStorage, type SqliteStorage } from "./index.js";

const createdAt = "2026-10-15T10:00:00.000Z";

describe("targeted audit event reads", () => {
  const stores: SqliteStorage[] = [];

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((storage) => storage.close()));
  });

  let sequence = 0;
  async function seeded(): Promise<SqliteStorage> {
    const storage = openSqliteStorage(":memory:");
    stores.push(storage);
    for (const id of ["workspace-a", "workspace-b"]) {
      await storage.saveWorkspace({ id, state: "collecting", createdAt, updatedAt: createdAt });
    }
    return storage;
  }

  async function append(
    storage: SqliteStorage,
    event: { workspaceId?: string; eventType: string; entityType?: string; entityId: string },
    payload: JsonValue,
  ): Promise<void> {
    sequence += 1;
    await storage.appendAuditEvent({
      id: `event-${sequence}`,
      workspaceId: event.workspaceId ?? "workspace-a",
      eventType: event.eventType,
      entityType: event.entityType ?? "run",
      entityId: event.entityId,
      payload,
      createdAt,
    });
  }

  it("returns the newest event of one type for one entity, as the full trail would", async () => {
    const storage = await seeded();
    await append(storage, { eventType: "run.author-input", entityId: "run-a" }, { round: 1 });
    await append(storage, { eventType: "run-snapshot.appended", entityId: "run-a" }, { big: 1 });
    await append(storage, { eventType: "run.author-input", entityId: "run-b" }, { round: 9 });
    await append(storage, { eventType: "run.author-input", entityId: "run-a" }, { round: 2 });
    await append(storage, { eventType: "run.evidence-mode", entityId: "run-a" }, { mode: 1 });
    await append(
      storage,
      { workspaceId: "workspace-b", eventType: "run.author-input", entityId: "run-a" },
      { round: 7 },
    );
    await append(
      storage,
      { eventType: "run.author-input", entityType: "application", entityId: "run-a" },
      { round: 8 },
    );

    const query = {
      workspaceId: "workspace-a",
      eventType: "run.author-input",
      entityType: "run",
      entityId: "run-a",
    };
    const latest = await storage.auditEvents.findLatestAuditEvent(query);
    expect(latest?.payload).toEqual({ round: 2 });
    expect(latest).toEqual(
      (await storage.listAuditEvents("workspace-a")).findLast(
        (event) =>
          event.eventType === query.eventType &&
          event.entityType === query.entityType &&
          event.entityId === query.entityId,
      ),
    );
  });

  it("is undefined when nothing matches", async () => {
    const storage = await seeded();
    await append(storage, { eventType: "run.author-input", entityId: "run-a" }, { round: 1 });
    await expect(
      storage.auditEvents.findLatestAuditEvent({
        workspaceId: "workspace-a",
        eventType: "run.evidence-mode",
        entityType: "run",
        entityId: "run-a",
      }),
    ).resolves.toBeUndefined();
  });

  it("asks SQLite for one row and converts only that row", async () => {
    const prepared: string[] = [];
    const parameters: unknown[][] = [];
    let opened = 0;
    const reads = createAuditEventReads(
      {
        prepare: (sql) => {
          prepared.push(sql);
          return {
            get: (...values) => {
              parameters.push([...values]);
              return undefined;
            },
          };
        },
      },
      () => {
        opened += 1;
      },
    );
    await reads.findLatestAuditEvent({
      workspaceId: "w",
      eventType: "run.author-input",
      entityType: "run",
      entityId: "r",
    });
    expect(opened).toBe(1);
    expect(prepared).toEqual([latestAuditEventSql]);
    expect(latestAuditEventSql).toMatch(/ORDER BY sequence DESC LIMIT 1$/u);
    expect(parameters).toEqual([["w", "run.author-input", "run", "r"]]);
  });
});
