import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { createFilesystemBlobStorage } from "@draft-loop/storage/blobs";
import { CandidateKnowledgeOperationUnsupportedError } from "@draft-loop/storage/run-knowledge-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openPostgresCandidateKnowledgeStore } from "./postgres-knowledge-store.js";
import type { PostgresStorage } from "./postgres-storage.js";
import { createTestSchema, type TestSchema } from "./test-schema.js";

/** Set by the CI `Server storage` job and by developers with a local server; skipped otherwise. */
const connectionString = process.env.DRAFT_LOOP_TEST_POSTGRES_URL;

const createdAt = "2026-10-21T10:00:00.000Z";
const content = new TextEncoder().encode(
  "# Experience\n\n## Engineer, Example Ledger (2020-2024)\n\nBuilt TypeScript tools.\n",
);
const checksum = createHash("sha256").update(content).digest("hex");
const salaryRule = {
  id: "salary",
  tier: "never-share",
  match: { kind: "heading-contains", text: "Compensation" },
} as const;

describe.runIf(connectionString !== undefined)("Postgres candidate knowledge store", () => {
  const url = connectionString ?? "";
  const blobs = createFilesystemBlobStorage();
  let schema: TestSchema;
  let storage: PostgresStorage;
  let blobRoot: string;
  let location: string;

  /** One synthetic file source with one version, as intake will leave it. */
  async function seedSource(target: PostgresStorage, options: { managed: boolean }) {
    await target.createCandidateKnowledgeStore({ schemaVersion: 1, id: "store-1", createdAt });
    await target.createCandidateKnowledgeBase({
      id: "ckb-1",
      displayName: "Career",
      description: "",
      isDefault: true,
      createdAt,
    });
    await target.createCandidateKnowledgeSource(
      {
        id: "source-1",
        knowledgeBaseId: "ckb-1",
        kind: "file",
        displayName: "career.md",
        createdAt,
      },
      {
        id: "version-1",
        mediaType: "text/markdown",
        checksum,
        sizeBytes: content.byteLength,
        createdAt,
      },
    );
    if (!options.managed) return;
    const reference = await blobs.put(location, content);
    await target.recordManagedCandidateKnowledgeSourceVersion({
      knowledgeBaseId: "ckb-1",
      sourceId: "source-1",
      versionId: "version-1",
      location: reference.location,
      recordedAt: createdAt,
    });
  }

  const open = () => openPostgresCandidateKnowledgeStore({ storage, blobs, storeId: "store-1" });

  beforeEach(async () => {
    schema = await createTestSchema(url, "knowledge");
    storage = await schema.open("tenant-a");
    blobRoot = await mkdtemp(join(tmpdir(), "draft-loop-knowledge-blobs-"));
    location = join(blobRoot, "store-1", "source-1", "version-1");
  });

  afterEach(async () => {
    await storage.close();
    await schema.drop();
    await rm(blobRoot, { recursive: true, force: true });
  });

  it("reports a source ready once the service holds its latest version's bytes", async () => {
    await seedSource(storage, { managed: true });
    const store = await open();

    const readiness = await store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-1");

    expect(store.descriptor).toEqual({ schemaVersion: 1, id: "store-1", createdAt });
    expect(readiness).toMatchObject({
      knowledgeBaseId: "ckb-1",
      state: "active",
      sources: [
        {
          sourceId: "source-1",
          latestVersionId: "version-1",
          status: "ready",
          reasons: [],
          lifecycleRevision: { versionId: "version-1", managed: true, originBoundAt: createdAt },
        },
      ],
    });
    expect(await store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-unknown")).toBeUndefined();
  });

  it("blocks a source whose bytes the service does not hold", async () => {
    await seedSource(storage, { managed: false });
    const store = await open();

    const readiness = await store.getCandidateKnowledgeBaseLifecycleReadiness("ckb-1");

    expect(readiness?.sources[0]).toMatchObject({
      status: "blocked",
      reasons: ["latest-version-unmanaged", "source-origin-unbound"],
    });
    expect(
      await store.readManagedCandidateKnowledgeSourceVersion("ckb-1", "source-1", "version-1"),
    ).toBeUndefined();
  });

  it("reads a version's bytes from blob storage and refuses changed bytes", async () => {
    await seedSource(storage, { managed: true });
    const store = await open();

    const read = await store.readManagedCandidateKnowledgeSourceVersion(
      "ckb-1",
      "source-1",
      "version-1",
    );
    await writeFile(location, "changed after recording\n");

    expect(read?.bytes).toEqual(content);
    expect(read?.metadata).toMatchObject({
      id: "version-1",
      sourceId: "source-1",
      knowledgeBaseId: "ckb-1",
      kind: "file",
      checksum,
      sizeBytes: content.byteLength,
    });
    await expect(
      store.readManagedCandidateKnowledgeSourceVersion("ckb-1", "source-1", "version-1"),
    ).rejects.toThrow("does not match its checksum");
  });

  it("stores sensitivity rules exactly as the local store does", async () => {
    await seedSource(storage, { managed: true });
    const local = openSqliteStorage(join(blobRoot, "local.sqlite"));
    try {
      await local.createCandidateKnowledgeBase({
        id: "ckb-1",
        displayName: "Career",
        description: "",
        isDefault: true,
        createdAt,
      });
      const input = { rules: { rules: [salaryRule] }, createdAt };

      const hosted = await storage.appendCandidateKnowledgeSourceSensitivityRules("ckb-1", input);
      const expected = await local.appendCandidateKnowledgeSourceSensitivityRules("ckb-1", input);

      expect(hosted).toEqual(expected);
      expect(await (await open()).getCandidateKnowledgeSourceSensitivityRules("ckb-1")).toEqual(
        expected,
      );
      await expect(
        storage.appendCandidateKnowledgeSourceSensitivityRules("ckb-1", {
          rules: { rules: [] },
          createdAt: "2026-10-20T10:00:00.000Z",
        }),
      ).rejects.toThrow("must not move backwards");
    } finally {
      await local.close();
    }
  });

  it("keeps one tenant's store, bytes and rules from another", async () => {
    await seedSource(storage, { managed: true });
    await storage.appendCandidateKnowledgeSourceSensitivityRules("ckb-1", {
      rules: { rules: [salaryRule] },
      createdAt,
    });
    const other = await schema.open("tenant-b");
    try {
      await expect(
        openPostgresCandidateKnowledgeStore({ storage: other, blobs, storeId: "store-1" }),
      ).rejects.toThrow("was not found");
      expect(
        await other.getManagedCandidateKnowledgeSourceVersion("ckb-1", "source-1", "version-1"),
      ).toBeUndefined();
      expect(await other.getCandidateKnowledgeSourceSensitivityRules("ckb-1")).toBeUndefined();
    } finally {
      await other.close();
    }
  });

  it("offers a run's operations only, and closing it leaves the storage open", async () => {
    await seedSource(storage, { managed: true });
    const store = await open();

    await expect(store.listCandidateKnowledgeSources("ckb-1")).rejects.toBeInstanceOf(
      CandidateKnowledgeOperationUnsupportedError,
    );
    await store.close();

    expect(await storage.getCandidateKnowledgeStore("store-1")).toBeDefined();
  });
});
