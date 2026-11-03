import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHostedKnowledgeIntake, createHostedSensitivityRules } from "@draft-loop/application";
import { createWorkJournalService } from "@draft-loop/application/work-journal";
import { createWorkJournalPublisher } from "@draft-loop/application/work-journal-source";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import {
  createSqlClient,
  grantPostgresStorageAccess,
  migratePostgresStorage,
  openPostgresCandidateKnowledgeStore,
  openPostgresStorage,
  type PostgresStorage,
} from "@draft-loop/storage-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const runtimeRole = "draft_loop_test_app";

function runtimeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = runtimeRole;
  parsed.password = runtimeRole;
  return parsed.toString();
}

// Fictional project, repository and links only.
const note = {
  title: "Card payments for the Fernhill booking site",
  summary:
    "Added card payments to the booking flow with a hosted checkout page, webhook handling for paid and refunded bookings, and retries for failed deliveries.",
  period: { start: "2026-10-12", end: "2026-10-30" },
  project: { name: "Fernhill bookings", visibility: "private", repository: "fernhill/bookings" },
  technologies: ["TypeScript", "Stripe"],
  category: "payments",
  candidate_role: ["implemented"],
  links: [{ kind: "pull-request", url: "https://git.example.test/fernhill/bookings/pull/42" }],
};

describe.runIf(connectionString !== undefined)("work journal approval on Postgres", () => {
  const url = connectionString ?? "";
  const schema = `journal_${randomUUID().replaceAll("-", "")}`;
  const admin = createSqlClient({ connectionString: url, maxConnections: 1 });
  let storage: PostgresStorage;
  let blobRoot: string;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(`DO $$
      BEGIN
        CREATE ROLE ${runtimeRole} LOGIN PASSWORD '${runtimeRole}';
      EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;
      END $$`);
    await migratePostgresStorage({ connectionString: url, schema });
    await grantPostgresStorageAccess({ connectionString: url, schema }, runtimeRole);
    storage = await openPostgresStorage({
      connectionString: runtimeUrl(url),
      schema,
      tenantId: "tenant-a",
    });
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-journal-"));
  });

  afterAll(async () => {
    await storage?.close();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("turns an approved note into a work-journal source whose links stay never-share", async () => {
    const intake = createHostedKnowledgeIntake({
      records: storage,
      blobs: createFilesystemBlobStorage(),
      storeId: "knowledge",
      locate: (versionId) => join(blobRoot, "knowledge", versionId),
    });
    const rules = createHostedSensitivityRules({ records: storage, storeId: "knowledge" });
    const publish = createWorkJournalPublisher({
      intake,
      rules,
      setEvidenceKind: async (knowledgeBaseId, sourceId, kind) => {
        await storage.appendCandidateKnowledgeSourceEvidenceKindOverride(
          knowledgeBaseId,
          sourceId,
          {
            kind,
            createdAt: "2026-11-03T10:00:00.000Z",
          },
        );
      },
    });
    const journal = createWorkJournalService({
      store: storage.workJournalNotes,
      tenantId: "tenant-a",
      publish,
    });
    const base = await intake.createKnowledgeBase({ displayName: "Career" });
    await journal.setIntake("owner", true);
    const recorded = await journal.record("owner", note);
    const approved = await journal.review("owner", recorded.note_id ?? "", {
      action: "approve",
      knowledge_base_id: base.id,
    });
    expect(approved).toMatchObject({ status: "approved", approval: { tier: "sensitive" } });

    const again = await publish({
      workspaceId: "owner",
      note: approved,
      knowledgeBaseId: base.id,
      tier: "sensitive",
    });
    expect(again).toEqual({ sourceId: approved.approval?.source_id, status: "already-present" });

    const store = await openPostgresCandidateKnowledgeStore({
      storage,
      blobs: createFilesystemBlobStorage(),
      storeId: "knowledge",
    });
    try {
      expect(await store.listCandidateKnowledgeSourceEvidenceKindOverrides(base.id)).toEqual([
        expect.objectContaining({ sourceId: approved.approval?.source_id, kind: "work-journal" }),
      ]);
    } finally {
      await store.close();
    }
    const tiers = (await rules.list(base.id)).rules.map((rule) => [rule.id, rule.tier]);
    expect(tiers).toEqual([
      [`wj-${approved.id}`, "sensitive"],
      [`wj-${approved.id}-links`, "never-share"],
    ]);
  });
});
