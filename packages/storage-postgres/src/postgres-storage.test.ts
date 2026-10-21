import { randomUUID } from "node:crypto";
import { auditEventChecksum } from "@draft-loop/storage/audit-trail";
import {
  describeApplicationsConformance,
  describeCandidateKnowledgeRetrievalConformance,
  describeCandidateKnowledgeVectorConformance,
  describeHistoryRecordsConformance,
  describeWorkspaceSettingsConformance,
} from "@draft-loop/storage/conformance";
import { StorageValidationError } from "@draft-loop/storage/errors";
import { describe, expect, it } from "vitest";
import { postgresMigrations } from "./migrations.js";
import { migratePostgresStorage, openPostgresStorage } from "./postgres-storage.js";
import { createSqlClient } from "./sql-client.js";
import { createTestSchema, openIsolated, runtimeRoleUrl } from "./test-schema.js";

/**
 * Set by the Postgres CI job and by developers with a local server. Without it these suites are
 * skipped, so the workspace gate runs where no database is available.
 */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

describe.runIf(connectionString !== undefined)("Postgres storage", () => {
  const url = connectionString ?? "";

  // Every history and versioned-record group, as SQLite runs them.
  describeHistoryRecordsConformance("Postgres", () => openIsolated(url));
  describeApplicationsConformance("Postgres", () => openIsolated(url));
  describeCandidateKnowledgeRetrievalConformance("Postgres", () => openIsolated(url));
  describeCandidateKnowledgeVectorConformance("Postgres", () => openIsolated(url));
  describeWorkspaceSettingsConformance("Postgres", async () => {
    const { storage, close } = await openIsolated(url);
    return {
      storage: {
        settings: storage.workspaceSettings,
        workspaces: ["workspaces/first", "workspaces/second"],
      },
      close,
    };
  });

  it("chains concurrent writes to one workspace into a single verifiable sequence", async () => {
    const { storage, close } = await openIsolated(url);
    try {
      await storage.saveWorkspace({
        id: "workspace-1",
        state: "collecting",
        createdAt: "2026-10-17T10:00:00.000Z",
        updatedAt: "2026-10-17T10:00:00.000Z",
      });
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          storage.saveContextSnapshot({
            id: `context-${index}`,
            workspaceId: "workspace-1",
            schemaVersion: 1,
            createdAt: "2026-10-17T10:01:00.000Z",
            payload: { index },
          }),
        ),
      );
      const events = await storage.listAuditEvents("workspace-1");
      expect(events).toHaveLength(9);
      let previous: string | null = null;
      for (const event of events) {
        expect(event.previousEventChecksum).toBe(previous);
        expect(event.eventChecksum).toBe(
          auditEventChecksum({
            createdAt: event.createdAt,
            entityId: event.entityId,
            entityType: event.entityType,
            eventType: event.eventType,
            id: event.id,
            payloadChecksum: event.payloadChecksum,
            previousEventChecksum: event.previousEventChecksum,
            workspaceId: event.workspaceId,
          }),
        );
        previous = event.eventChecksum;
      }
    } finally {
      await close();
    }
  });

  it("numbers concurrent appends to one knowledge source one after another", async () => {
    const { storage, close } = await openIsolated(url);
    try {
      const at = "2026-10-17T10:00:00.000Z";
      await storage.ensureDefaultCandidateKnowledgeBase({
        id: "ckb-1",
        displayName: "Knowledge",
        createdAt: at,
      });
      await storage.createCandidateKnowledgeSource(
        {
          id: "source-1",
          knowledgeBaseId: "ckb-1",
          kind: "file",
          displayName: "cv.md",
          createdAt: at,
        },
        {
          id: "version-0",
          mediaType: "text/markdown",
          checksum: "0".repeat(64),
          sizeBytes: 1,
          createdAt: at,
        },
      );
      await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          storage.appendCandidateKnowledgeSourceVersion("ckb-1", "source-1", {
            id: `version-${index + 1}`,
            mediaType: "text/markdown",
            checksum: String(index + 1).repeat(64),
            sizeBytes: 1,
            createdAt: at,
          }),
        ),
      );
      const versions = await storage.listCandidateKnowledgeSourceVersions("ckb-1", "source-1");
      expect(versions.map((version) => version.version)).toEqual([1, 2, 3, 4, 5, 6]);
      for (const [index, version] of versions.entries()) {
        expect(version.parentVersionId).toBe(index === 0 ? null : versions[index - 1]?.id);
      }
    } finally {
      await close();
    }
  });

  it("reports tampered audit payloads and run snapshots", async () => {
    const { schema, admin, open, drop } = await createTestSchema(url, "tamper");
    const storage = await open("tenant-a");
    try {
      const at = "2026-10-17T10:00:00.000Z";
      await storage.saveWorkspace({
        id: "workspace-1",
        state: "drafting",
        createdAt: at,
        updatedAt: at,
      });
      await storage.saveContextSnapshot({
        id: "context-1",
        workspaceId: "workspace-1",
        schemaVersion: 1,
        createdAt: at,
        payload: { job: "fixture" },
      });
      const snapshot = await storage.saveRunSnapshot({
        workspaceId: "workspace-1",
        runId: "run-1",
        contextSnapshotId: "context-1",
        state: "drafting",
        round: 1,
        currentStep: "author",
        budget: { maxRounds: 2 },
        artifactId: null,
        approval: "pending",
        totalCostUsd: 0,
        startedAt: at,
        updatedAt: at,
        lastError: null,
        payload: { step: 1 },
      });
      await expect(storage.auditEvents.verifyAuditChain("workspace-1")).resolves.toMatchObject({
        ok: true,
        eventCount: 3,
      });

      // Bypass the immutability triggers, as a direct database edit would.
      await admin.transaction(async (executor) => {
        await executor.query("SET LOCAL session_replication_role = replica");
        await executor.query(
          `UPDATE ${schema}.run_snapshots SET payload_json = '{"step":2}' WHERE id = $1`,
          [snapshot.id],
        );
        await executor.query(
          `UPDATE ${schema}.audit_events SET payload_json = '{"job":"changed"}' WHERE entity_type = 'context-snapshot'`,
        );
      });
      const result = await storage.auditEvents.verifyAuditChain("workspace-1");
      expect(result.ok).toBe(false);
      expect(result.problems.map((problem) => problem.code).sort()).toEqual([
        "payload-checksum",
        "snapshot-checksum",
      ]);
      await expect(
        storage.auditEvents.findLatestAuditEvent({
          workspaceId: "workspace-1",
          eventType: "run-snapshot.appended",
          entityType: "run-snapshot",
          entityId: "run-1",
        }),
      ).resolves.toMatchObject({ id: `${snapshot.id}:audit` });
    } finally {
      await storage.close();
      await drop();
    }
  });

  it("applies each migration once when several migrators run on the same schema", async () => {
    const schema = `migrations_${randomUUID().replaceAll("-", "")}`;
    const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    try {
      await Promise.all(
        Array.from({ length: 3 }, () => migratePostgresStorage({ connectionString: url, schema })),
      );
      const rows = await admin.query(`SELECT version FROM ${schema}.schema_migrations`);
      expect(rows.map((row) => Number(row.version)).sort((left, right) => left - right)).toEqual(
        postgresMigrations.map((migration) => migration.version),
      );
    } finally {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.close();
    }
  });

  it("keeps each tenant's rows invisible and unwritable to every other tenant", async () => {
    const { schema, admin, open, drop } = await createTestSchema(url, "tenants");
    const tenantA = await open("tenant-a");
    const tenantB = await open("tenant-b");
    const at = "2026-10-17T10:00:00.000Z";
    try {
      await tenantA.saveWorkspace({
        id: "workspace-1",
        state: "collecting",
        createdAt: at,
        updatedAt: at,
      });
      await tenantA.ensureDefaultCandidateKnowledgeBase({
        id: "ckb-1",
        displayName: "A",
        createdAt: at,
      });
      await expect(tenantB.getWorkspace("workspace-1")).resolves.toBeUndefined();
      await expect(tenantB.listCandidateKnowledgeBases()).resolves.toEqual([]);
      await expect(tenantB.listAuditEvents("workspace-1")).resolves.toEqual([]);

      // The same ids are free in another tenant, including its own default knowledge base.
      await tenantB.saveWorkspace({
        id: "workspace-1",
        state: "drafting",
        createdAt: at,
        updatedAt: at,
      });
      await tenantB.ensureDefaultCandidateKnowledgeBase({
        id: "ckb-1",
        displayName: "B",
        createdAt: at,
      });
      await expect(tenantA.getWorkspace("workspace-1")).resolves.toMatchObject({
        state: "collecting",
      });
      await expect(tenantA.auditEvents.verifyAuditChain("workspace-1")).resolves.toMatchObject({
        ok: true,
      });

      // Raw SQL as the runtime role cannot reach across either: reads are filtered and writes refused.
      const runtime = createSqlClient({
        connectionString: runtimeRoleUrl(url),
        schema,
        tenantId: "tenant-b",
        maxConnections: 1,
      });
      try {
        await expect(
          runtime.query("SELECT count(*) AS count FROM workspaces WHERE tenant_id = 'tenant-a'"),
        ).resolves.toEqual([{ count: "0" }]);
        await expect(
          runtime.query(
            "UPDATE workspaces SET state = 'drafting' WHERE tenant_id = 'tenant-a' RETURNING id",
          ),
        ).resolves.toEqual([]);
        await expect(
          runtime.query(
            "INSERT INTO workspaces (tenant_id, id, state, created_at, updated_at) VALUES ('tenant-a', 'workspace-2', 'collecting', $1, $1)",
            [at],
          ),
        ).rejects.toThrow(/row-level security/u);
      } finally {
        await runtime.close();
      }
      const [counts] = await admin.query(
        "SELECT count(*) FILTER (WHERE tenant_id = 'tenant-a') AS a, count(*) FILTER (WHERE tenant_id = 'tenant-b') AS b FROM workspaces",
      );
      expect(counts).toEqual({ a: "1", b: "1" });
    } finally {
      await tenantA.close();
      await tenantB.close();
      await drop();
    }
  });

  it("keeps each tenant's workspace settings to that tenant", async () => {
    const { open, drop } = await createTestSchema(url, "settings");
    const tenantA = await open("tenant-a");
    const tenantB = await open("tenant-b");
    try {
      await tenantA.workspaceSettings.write("workspaces/one", "workspace.json", "a\n");

      await expect(
        tenantB.workspaceSettings.read("workspaces/one", "workspace.json"),
      ).resolves.toBeUndefined();
      await expect(
        tenantB.workspaceSettings.remove("workspaces/one", "workspace.json"),
      ).resolves.toBe(false);
      await tenantB.workspaceSettings.write("workspaces/one", "workspace.json", "b\n");
      await expect(
        tenantA.workspaceSettings.read("workspaces/one", "workspace.json"),
      ).resolves.toBe("a\n");
    } finally {
      await tenantA.close();
      await tenantB.close();
      await drop();
    }
  });

  it("refuses workspace settings it cannot store faithfully", async () => {
    const { storage, close } = await openIsolated(url);
    try {
      await expect(
        storage.workspaceSettings.write("workspaces/one", "workspace.json", "a\u0000b"),
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(storage.workspaceSettings.read("", "workspace.json")).rejects.toBeInstanceOf(
        StorageValidationError,
      );
      await expect(
        storage.workspaceSettings.read("workspaces/one", "other.json" as "workspace.json"),
      ).rejects.toBeInstanceOf(StorageValidationError);
    } finally {
      await close();
    }
  });

  it("refuses to open as a role that bypasses row-level security", async () => {
    const { schema, drop } = await createTestSchema(url, "bypass");
    try {
      await expect(
        openPostgresStorage({ connectionString: url, schema, tenantId: "tenant-a" }),
      ).rejects.toThrow(/row-level security/u);
    } finally {
      await drop();
    }
  });
});
