import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CanonicalCandidateProfile,
  type CanonicalCandidateProfileInput,
  canonicalCandidateProfileSchema,
  type OpportunityBrief,
  type WritingPolicyInput,
} from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  type ArtifactVersionInput,
  type CandidateKnowledgeBaseInput,
  type CandidateKnowledgeSourceInput,
  type CandidateKnowledgeSourceVersionInput,
  type ContextSnapshotInput,
  candidateKnowledgeRetentionClasses,
  type DecisionRecordInput,
  type EvidenceChunkRecord,
  type EvidenceSourceRecord,
  type ExecutionRecordInput,
  type ExportRecordInput,
  type FindingRecordInput,
  openSqliteStorage,
  type RoundRecordInput,
  type RunRecordInput,
  SqliteStorage,
  StorageConflictError,
  StorageSecurityError,
  StorageValidationError,
  type WorkspaceRecord,
} from "./index.js";

const workspace: WorkspaceRecord = {
  id: "workspace-1",
  state: "collecting",
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
};

const opportunityBrief = (overrides: Partial<OpportunityBrief> = {}): OpportunityBrief => ({
  schemaVersion: 1,
  id: "brief-1",
  version: 1,
  priorVersion: null,
  status: "draft",
  createdAt: "2026-08-12T10:00:00.000Z",
  reviewedAt: null,
  sources: [
    {
      id: "opportunity-source-1",
      classification: "job-posting",
      status: "available",
      provenance: {
        kind: "approved-url",
        originalUrl: "https://example.com/private-role",
        capturedAt: "2026-08-12T09:59:00.000Z",
        contentChecksum: "d".repeat(64),
      },
    },
  ],
  role: null,
  employer: null,
  responsibilities: [],
  requirements: [],
  priorities: [],
  candidateInstructions: {
    tone: null,
    applicationGoal: null,
    forbiddenLanguage: [],
    focusAreas: [],
  },
  issues: [],
  ...overrides,
});

const writingPolicy = (
  content: string,
  overrides: Partial<WritingPolicyInput> = {},
): WritingPolicyInput => ({
  content,
  checksum: createHash("sha256").update(content, "utf8").digest("hex"),
  version: "policy-1",
  ...overrides,
});

const canonicalCandidateProfile = (
  overrides: Partial<CanonicalCandidateProfileInput> = {},
): CanonicalCandidateProfile =>
  canonicalCandidateProfileSchema.parse({
    id: "profile-canonical-1",
    version: 1,
    parentVersion: null,
    status: "draft",
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    candidateKnowledgeSelection: {
      capturedAt: "2026-08-12T09:00:00.000Z",
      entries: [
        {
          storeId: "store-z",
          knowledgeBaseId: "knowledge-z",
          sources: [
            {
              sourceId: "source-z",
              versionId: "version-z",
              lifecycleRevision: {
                knowledgeBaseState: "active",
                knowledgeBaseArchivedAt: null,
                versionId: "version-z",
                version: 1,
                createdAt: "2026-08-12T08:00:00.000Z",
                managed: true,
                originBoundAt: "2026-08-12T08:00:00.000Z",
                observation: null,
                retirement: null,
                provenanceFetchedAt: null,
                directory: null,
              },
            },
          ],
        },
      ],
    },
    facts: [
      {
        id: "fact-01",
        category: "identity",
        field: "name",
        value: "Candidate",
        provenance: [
          {
            storeId: "store-z",
            knowledgeBaseId: "knowledge-z",
            sourceId: "source-z",
            versionId: "version-z",
            kind: "candidate-provided",
          },
        ],
      },
    ],
    issues: [],
    ...overrides,
  });

const contextSnapshot = (payload: ContextSnapshotInput["payload"]): ContextSnapshotInput => ({
  id: "context-1",
  workspaceId: workspace.id,
  schemaVersion: 1,
  createdAt: "2026-08-12T10:01:00.000Z",
  payload,
});

const source: EvidenceSourceRecord = {
  id: "source-1",
  workspaceId: workspace.id,
  path: "/local/evidence/resume.md",
  mediaType: "text/markdown",
  checksum: "a".repeat(64),
  createdAt: "2026-08-12T10:02:00.000Z",
};

const knowledgeBase = (
  overrides: Partial<CandidateKnowledgeBaseInput> = {},
): CandidateKnowledgeBaseInput => ({
  id: "ckb-1",
  displayName: "Career evidence",
  description: "Sanitized professional material",
  isDefault: true,
  createdAt: "2026-08-12T09:00:00.000Z",
  ...overrides,
});

const knowledgeSource = (
  overrides: Partial<CandidateKnowledgeSourceInput> = {},
): CandidateKnowledgeSourceInput => ({
  id: "ckb-source-1",
  knowledgeBaseId: "ckb-1",
  kind: "file",
  displayName: "Career notes.md",
  createdAt: "2026-08-12T09:10:00.000Z",
  ...overrides,
});

const knowledgeSourceVersion = (
  overrides: Partial<CandidateKnowledgeSourceVersionInput> = {},
): CandidateKnowledgeSourceVersionInput => ({
  id: "ckb-source-version-1",
  mediaType: "text/markdown",
  checksum: "d".repeat(64),
  sizeBytes: 128,
  createdAt: "2026-08-12T09:11:00.000Z",
  ...overrides,
});

const chunk = (id: string, text: string, ordinal: number): EvidenceChunkRecord => ({
  id,
  workspaceId: workspace.id,
  sourceId: source.id,
  ordinal,
  lineStart: ordinal + 1,
  lineEnd: ordinal + 1,
  checksum: `${String.fromCharCode(98 + ordinal)}${"0".repeat(63)}`,
  text,
  createdAt: "2026-08-12T10:03:00.000Z",
});

const artifact = (
  payload: ArtifactVersionInput["payload"],
  overrides: Partial<ArtifactVersionInput> = {},
): ArtifactVersionInput => ({
  id: "artifact-1",
  workspaceId: workspace.id,
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-12T10:04:00.000Z",
  payload,
  ...overrides,
});

const run = (artifactId: string | null = "artifact-1"): RunRecordInput => ({
  id: "run-1",
  workspaceId: workspace.id,
  contextSnapshotId: "context-1",
  state: "drafting",
  round: 1,
  currentStep: "author",
  budget: { maxRounds: 3, maxCostUsd: 1 },
  artifactId,
  approval: "pending",
  totalCostUsd: 0.01,
  startedAt: "2026-08-12T10:10:00.000Z",
  updatedAt: "2026-08-12T10:10:01.000Z",
  lastError: null,
  payload: { stateReason: "fixture" },
});

const round = (): RoundRecordInput => ({
  id: "round-1",
  workspaceId: workspace.id,
  runId: "run-1",
  number: 1,
  state: "drafting",
  startedAt: "2026-08-12T10:10:00.000Z",
  completedAt: null,
  evaluation: null,
  payload: { source: "fixture" },
});

const execution = (): ExecutionRecordInput => ({
  id: "execution-1",
  workspaceId: workspace.id,
  runId: "run-1",
  roundId: "round-1",
  contextSnapshotId: "context-1",
  artifactId: "artifact-1",
  attempt: 1,
  step: "author",
  status: "completed",
  provider: "anthropic",
  modelId: "author-test",
  providerRequestId: "provider-request-1",
  outputChecksum: "b".repeat(64),
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
  estimatedUsd: 0.01,
  startedAt: "2026-08-12T10:10:02.000Z",
  completedAt: "2026-08-12T10:10:03.000Z",
  errorCode: null,
  output: { artifactVersion: 1 },
  payload: { purpose: "author" },
});

const finding = (): FindingRecordInput => ({
  id: "finding-1",
  workspaceId: workspace.id,
  runId: "run-1",
  roundId: "round-1",
  executionId: "execution-1",
  artifactId: "artifact-1",
  code: "uncovered-requirement",
  category: "coverage",
  severity: "warning",
  message: "A requirement needs stronger evidence.",
  claimId: null,
  sectionId: null,
  requirementId: "requirement-1",
  createdAt: "2026-08-12T10:10:04.000Z",
  payload: { userVisible: true },
});

const decision = (): DecisionRecordInput => ({
  id: "decision-1",
  workspaceId: workspace.id,
  runId: "run-1",
  roundId: "round-1",
  artifactId: "artifact-1",
  type: "approve",
  rationale: "The user approved the current artifact.",
  actor: "user",
  createdAt: "2026-08-12T10:10:05.000Z",
  payload: { visible: true },
});

const exportRecord = (): ExportRecordInput => ({
  id: "export-1",
  workspaceId: workspace.id,
  runId: "run-1",
  artifactId: "artifact-1",
  format: "markdown",
  status: "completed",
  outputPath: "/local/exports/cv.md",
  outputChecksum: "c".repeat(64),
  createdAt: "2026-08-12T10:10:06.000Z",
  payload: { approved: true },
});

async function seedHistory(storage: SqliteStorage): Promise<void> {
  await storage.saveWorkspace(workspace);
  await storage.saveContextSnapshot(contextSnapshot({ job: "fixture" }));
  await storage.saveArtifactVersion(artifact({ version: "one" }));
  await storage.saveRun(run());
  await storage.saveRound(round());
  await storage.saveExecution(execution());
  await storage.saveFinding(finding());
  await storage.saveDecision(decision());
  await storage.saveExport(exportRecord());
}

interface RawSqliteDatabase {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => {
    readonly get: (...parameters: readonly unknown[]) => Record<string, unknown> | undefined;
    readonly all: (...parameters: readonly unknown[]) => readonly Record<string, unknown>[];
  };
  readonly close: () => void;
}

interface RawSqliteConstructor {
  new (filename: string): RawSqliteDatabase;
}

function openRawDatabase(filename: string): RawSqliteDatabase {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as {
    readonly default?: unknown;
  };
  const Constructor = loaded.default ?? loaded;
  return new (Constructor as RawSqliteConstructor)(filename);
}

function queryRawDatabase(filename: string, sql: string): readonly Record<string, unknown>[] {
  const database = openRawDatabase(filename);
  try {
    return database.prepare(sql).all();
  } finally {
    database.close();
  }
}

function removeMigrationTwo(filename: string): void {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as {
    readonly default?: unknown;
  };
  const Constructor = loaded.default ?? loaded;
  const database = new (Constructor as RawSqliteConstructor)(filename);
  database.exec(
    "PRAGMA foreign_keys = OFF; DROP TABLE candidate_knowledge_source_url_provenance; DROP TABLE candidate_knowledge_source_retirements; DROP TABLE candidate_knowledge_source_refresh_observations; DROP TABLE candidate_knowledge_source_origin_bindings; DROP TABLE candidate_knowledge_managed_write_events; DROP TABLE candidate_knowledge_managed_write_operations; DROP TABLE candidate_knowledge_managed_source_versions; DROP TABLE candidate_knowledge_source_versions; DROP TABLE candidate_knowledge_sources; DROP TABLE candidate_knowledge_bases; DROP TABLE run_snapshots; DROP TABLE exports; DROP TABLE decisions; DROP TABLE findings; DROP TABLE executions; DROP TABLE rounds; DROP TABLE runs; DELETE FROM schema_migrations WHERE version IN (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16);",
  );
  database.close();
}

function removeMigrationFour(filename: string): void {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as {
    readonly default?: unknown;
  };
  const Constructor = loaded.default ?? loaded;
  const database = new (Constructor as RawSqliteConstructor)(filename);
  database.exec(
    "DROP TABLE candidate_knowledge_source_url_provenance; DROP TABLE candidate_knowledge_source_retirements; DROP TABLE candidate_knowledge_source_refresh_observations; DROP TABLE candidate_knowledge_source_origin_bindings; DROP TABLE candidate_knowledge_managed_write_events; DROP TABLE candidate_knowledge_managed_write_operations; DROP TABLE candidate_knowledge_managed_source_versions; DROP TABLE candidate_knowledge_source_versions; DROP TABLE candidate_knowledge_sources; DROP TABLE candidate_knowledge_bases; DELETE FROM schema_migrations WHERE version IN (4, 5, 6, 7, 8, 9, 10, 11, 12, 16);",
  );
  database.close();
}

function removeMigrationFive(filename: string): void {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as {
    readonly default?: unknown;
  };
  const Constructor = loaded.default ?? loaded;
  const database = new (Constructor as RawSqliteConstructor)(filename);
  database.exec(
    "DROP TABLE candidate_knowledge_source_url_provenance; DROP TABLE candidate_knowledge_source_retirements; DROP TABLE candidate_knowledge_source_refresh_observations; DROP TABLE candidate_knowledge_source_origin_bindings; DROP TABLE candidate_knowledge_managed_write_events; DROP TABLE candidate_knowledge_managed_write_operations; DROP TABLE candidate_knowledge_managed_source_versions; DROP TABLE candidate_knowledge_source_versions; DROP TABLE candidate_knowledge_sources; DELETE FROM schema_migrations WHERE version IN (5, 6, 7, 8, 9, 10, 11, 12, 16);",
  );
  database.close();
}

function removeMigrationSix(filename: string): void {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as {
    readonly default?: unknown;
  };
  const Constructor = loaded.default ?? loaded;
  const database = new (Constructor as RawSqliteConstructor)(filename);
  database.exec(
    "DROP TABLE candidate_knowledge_source_url_provenance; DROP TABLE candidate_knowledge_source_retirements; DROP TABLE candidate_knowledge_source_refresh_observations; DROP TABLE candidate_knowledge_source_origin_bindings; DROP TABLE candidate_knowledge_managed_write_events; DROP TABLE candidate_knowledge_managed_write_operations; DROP TABLE candidate_knowledge_managed_source_versions; DELETE FROM schema_migrations WHERE version IN (6, 7, 8, 9, 10, 11, 12, 16);",
  );
  database.close();
}

function removeMigrationSeven(filename: string): void {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as {
    readonly default?: unknown;
  };
  const Constructor = loaded.default ?? loaded;
  const database = new (Constructor as RawSqliteConstructor)(filename);
  database.exec(
    "DROP TABLE candidate_knowledge_source_url_provenance; DROP TABLE candidate_knowledge_source_retirements; DROP TABLE candidate_knowledge_source_refresh_observations; DROP TABLE candidate_knowledge_source_origin_bindings; DROP TABLE candidate_knowledge_managed_write_events; DROP TABLE candidate_knowledge_managed_write_operations; DELETE FROM schema_migrations WHERE version IN (7, 8, 9, 10, 11, 12, 16);",
  );
  database.close();
}

function restoreLegacyArtifactHistory(filename: string): void {
  const loaded = createRequire(import.meta.url)("better-sqlite3") as {
    readonly default?: unknown;
  };
  const Constructor = loaded.default ?? loaded;
  const database = new (Constructor as RawSqliteConstructor)(filename);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    PRAGMA legacy_alter_table = ON;
    DROP TRIGGER artifact_versions_immutable_update;
    DROP TRIGGER artifact_versions_immutable_delete;
    ALTER TABLE artifact_versions RENAME TO artifact_versions_current;
    CREATE TABLE artifact_versions (
      id TEXT PRIMARY KEY NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      version INTEGER NOT NULL,
      parent_version_id TEXT REFERENCES artifact_versions(id),
      created_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_checksum TEXT NOT NULL,
      UNIQUE (workspace_id, version)
    );
    INSERT INTO artifact_versions (
      id, workspace_id, version, parent_version_id, created_at, payload_json, payload_checksum
    )
    SELECT id, workspace_id, version, parent_version_id, created_at, payload_json, payload_checksum
    FROM artifact_versions_current;
    DROP TABLE artifact_versions_current;
    CREATE TRIGGER artifact_versions_immutable_update
      BEFORE UPDATE ON artifact_versions
      BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
    CREATE TRIGGER artifact_versions_immutable_delete
      BEFORE DELETE ON artifact_versions
      BEGIN SELECT RAISE(ABORT, 'artifact versions are immutable'); END;
    DELETE FROM schema_migrations WHERE version = 26;
  `);
  database.close();
}

describe("SQLite storage", () => {
  it("applies migrations idempotently and rejects sensitive key persistence", async () => {
    const storage = openSqliteStorage(":memory:");

    expect(storage.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    storage.migrate();
    expect(storage.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);

    await storage.set("ui.language", "en");
    await expect(storage.get("ui.language")).resolves.toBe("en");
    await expect(storage.set("provider.apiKey", "not-persisted")).rejects.toThrow(
      StorageSecurityError,
    );
    await expect(storage.get("provider.apiKey")).resolves.toBeUndefined();
    await storage.saveWorkspace(workspace);
    await expect(
      storage.saveContextSnapshot(contextSnapshot({ apiKey: "not-persisted" })),
    ).rejects.toThrow(StorageSecurityError);
    await storage.close();
  });

  it("persists immutable opportunity brief versions across restart with content-free audits", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-opportunity-storage-"));
    const filename = join(directory, "history.sqlite");
    const first = openSqliteStorage(filename);
    await first.saveWorkspace(workspace);
    const versionOne = opportunityBrief();
    const versionTwo = opportunityBrief({
      version: 2,
      priorVersion: 1,
      createdAt: "2026-08-12T10:01:00.000Z",
      role: { value: "Private role title", sourceIds: ["opportunity-source-1"] },
    });

    const savedOne = await first.saveOpportunityBrief(workspace.id, versionOne);
    const savedTwo = await first.saveOpportunityBrief(workspace.id, versionTwo);
    await expect(first.saveOpportunityBrief(workspace.id, versionTwo)).resolves.toEqual(savedTwo);
    expect(savedOne.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(await first.listOpportunityBriefVersions(workspace.id, versionOne.id)).toEqual([
      savedOne,
      savedTwo,
    ]);
    expect(await first.getLatestOpportunityBrief(workspace.id, versionOne.id)).toEqual(savedTwo);

    const auditEvents = (await first.listAuditEvents(workspace.id)).filter(
      (event) => event.eventType === "opportunity-brief-version.appended",
    );
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents[1]?.payload).toEqual({
      checksum: savedTwo.checksum,
      schemaVersion: 1,
      status: "draft",
      version: 2,
    });
    expect(JSON.stringify(auditEvents)).not.toContain("Private role title");
    expect(JSON.stringify(auditEvents)).not.toContain("https://example.com/private-role");
    await first.close();

    const reopened = openSqliteStorage(filename);
    await expect(reopened.getOpportunityBrief(workspace.id, versionOne.id, 1)).resolves.toEqual(
      savedOne,
    );
    await expect(reopened.getLatestOpportunityBrief(workspace.id, versionOne.id)).resolves.toEqual(
      savedTwo,
    );
    await reopened.close();

    const raw = openRawDatabase(filename);
    expect(() =>
      raw.exec("UPDATE opportunity_brief_versions SET status = 'reviewed' WHERE version = 1"),
    ).toThrow(/immutable/iu);
    expect(() => raw.exec("DELETE FROM opportunity_brief_versions WHERE version = 1")).toThrow(
      /immutable/iu,
    );
    raw.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists append-only writing policy history with canonical payloads and lineage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-writing-policy-storage-"));
    const filename = join(directory, "history.sqlite");
    const first = openSqliteStorage(filename);
    await first.saveWorkspace(workspace);

    const policyOne = writingPolicy("PRIVATE workspace policy one", {
      version: "policy-1",
      preferences: {
        pageTarget: "one-page",
        sectionOrder: ["Summary", "Experience"],
        emphasisAreas: ["Evidence"],
      },
      lineage: { kind: "workspace" },
    });
    const savedOne = await first.saveWritingPolicyVersion(workspace.id, policyOne, {
      createdAt: "2026-08-12T10:01:00.000Z",
      priorChecksum: null,
    });
    expect(savedOne).toMatchObject({
      workspaceId: workspace.id,
      version: "policy-1",
      schemaVersion: 1,
      priorChecksum: null,
      policy: {
        content: "PRIVATE workspace policy one",
        schemaVersion: 1,
        lineage: { kind: "workspace" },
      },
    });
    expect(savedOne.checksum).toBe(policyOne.checksum);
    expect(savedOne.payloadChecksum).toMatch(/^[a-f0-9]{64}$/u);

    const policyTwo = writingPolicy("PRIVATE workspace policy two", {
      version: "policy-2",
      lineage: { kind: "workspace" },
    });
    const savedTwo = await first.saveWritingPolicyVersion({
      workspaceId: workspace.id,
      policy: policyTwo,
      createdAt: "2026-08-12T10:02:00.000Z",
    });
    expect(savedTwo.priorChecksum).toBe(savedOne.checksum);
    await expect(
      first.saveWritingPolicyVersion(workspace.id, policyTwo, {
        createdAt: "2026-08-12T10:02:00.000Z",
      }),
    ).resolves.toEqual(savedTwo);
    expect(await first.getWritingPolicyVersion(workspace.id, savedOne.checksum)).toEqual(savedOne);
    expect(await first.getLatestWritingPolicyVersion(workspace.id)).toEqual(savedTwo);
    expect(await first.listWritingPolicyVersions(workspace.id)).toEqual([savedOne, savedTwo]);

    await expect(
      first.saveWritingPolicyVersion(
        workspace.id,
        writingPolicy("PRIVATE branch from an older policy", { version: "policy-branch" }),
        { createdAt: "2026-08-12T10:03:00.000Z", priorChecksum: savedOne.checksum },
      ),
    ).rejects.toThrow("The writing policy parent version must be the current leaf.");
    await expect(
      first.saveWritingPolicyVersion(
        workspace.id,
        writingPolicy("PRIVATE same-time child", { version: "policy-same-time" }),
        { createdAt: "2026-08-12T10:02:00.000Z", priorChecksum: savedTwo.checksum },
      ),
    ).rejects.toThrow("The writing policy timestamp must be later than its parent version.");
    expect(await first.getLatestWritingPolicyVersion(workspace.id)).toEqual(savedTwo);
    expect(await first.listWritingPolicyVersions(workspace.id)).toEqual([savedOne, savedTwo]);

    await expect(
      first.saveWritingPolicyVersion(
        workspace.id,
        writingPolicy("PRIVATE workspace policy one", { version: "policy-conflict" }),
      ),
    ).rejects.toThrow("The writing policy version is immutable.");
    await expect(
      first.saveWritingPolicyVersion(
        workspace.id,
        writingPolicy("PRIVATE policy with reused display version", { version: "policy-2" }),
      ),
    ).rejects.toThrow("The writing policy display version is already bound.");

    const auditEvents = (await first.listAuditEvents(workspace.id)).filter(
      (event) => event.eventType === "writing-policy-version.appended",
    );
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents[1]?.payload).toEqual({
      checksum: savedTwo.checksum,
      version: "policy-2",
      schemaVersion: 1,
      priorChecksum: savedOne.checksum,
      payloadChecksum: savedTwo.payloadChecksum,
    });
    expect(JSON.stringify(auditEvents)).not.toContain("PRIVATE workspace policy");
    await first.close();

    const reopened = openSqliteStorage(filename);
    await expect(reopened.getLatestWritingPolicyVersion(workspace.id)).resolves.toEqual(savedTwo);
    await reopened.close();

    const raw = openRawDatabase(filename);
    expect(() =>
      raw.exec(
        "UPDATE writing_policy_versions SET version = 'mutated' WHERE policy_checksum = '" +
          savedOne.checksum +
          "'",
      ),
    ).toThrow(/immutable/iu);
    expect(() =>
      raw.exec(
        `DELETE FROM writing_policy_versions WHERE policy_checksum = '${savedOne.checksum}'`,
      ),
    ).toThrow(/immutable/iu);
    raw.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("persists an immutable canonical candidate profile chain across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-canonical-profile-storage-"));
    const filename = join(directory, "history.sqlite");
    const first = openSqliteStorage(filename);
    await first.saveWorkspace(workspace);

    const profileOne = canonicalCandidateProfile();
    const savedOne = await first.saveCanonicalCandidateProfile(workspace.id, profileOne);
    const profileTwo = canonicalCandidateProfile({
      version: 2,
      parentVersion: 1,
      createdAt: "2026-08-12T10:01:00.000Z",
      updatedAt: "2026-08-12T10:01:00.000Z",
      facts: [
        ...profileOne.facts,
        {
          id: "fact-02",
          category: "role",
          subjectId: "career-1",
          field: "title",
          value: "Engineer",
          provenance: [...(profileOne.facts[0]?.provenance ?? [])],
        },
      ] as unknown as CanonicalCandidateProfileInput["facts"],
    });
    const savedTwo = await first.saveCanonicalCandidateProfile(workspace.id, profileTwo);

    expect(savedOne.workspaceId).toBe(workspace.id);
    expect(savedOne.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.isFrozen(savedOne.profile)).toBe(true);
    expect(Object.isFrozen(savedOne.profile.facts)).toBe(true);
    await expect(first.saveCanonicalCandidateProfile(workspace.id, profileTwo)).resolves.toEqual(
      savedTwo,
    );
    await expect(
      first.getCanonicalCandidateProfile(workspace.id, profileOne.id, 1),
    ).resolves.toEqual(savedOne);
    await expect(
      first.getLatestCanonicalCandidateProfile(workspace.id, profileOne.id),
    ).resolves.toEqual(savedTwo);
    await expect(
      first.listCanonicalCandidateProfileVersions(workspace.id, profileOne.id),
    ).resolves.toEqual([savedOne, savedTwo]);

    const raw = openRawDatabase(filename);
    expect(() =>
      raw.exec(
        `UPDATE canonical_candidate_profile_versions SET status = 'reviewed' WHERE profile_id = '${profileOne.id}' AND version = 1`,
      ),
    ).toThrow(/immutable/iu);
    expect(() =>
      raw.exec(
        `DELETE FROM canonical_candidate_profile_versions WHERE profile_id = '${profileOne.id}' AND version = 1`,
      ),
    ).toThrow(/immutable/iu);
    raw.close();
    await first.close();

    const reopened = openSqliteStorage(filename);
    await expect(
      reopened.getLatestCanonicalCandidateProfile(workspace.id, profileOne.id),
    ).resolves.toEqual(savedTwo);
    expect(JSON.parse(JSON.stringify(savedTwo.profile))).toEqual(savedTwo.profile);
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("enforces canonical profile workspace isolation, linear lineage, and timestamps", async () => {
    const storage = openSqliteStorage(":memory:");
    const otherWorkspace: WorkspaceRecord = { ...workspace, id: "workspace-2" };
    await storage.saveWorkspace(workspace);
    await storage.saveWorkspace(otherWorkspace);
    const root = canonicalCandidateProfile();
    const otherProfile = canonicalCandidateProfile({ id: "profile-canonical-2" });
    await expect(storage.saveCanonicalCandidateProfile("missing-workspace", root)).rejects.toThrow(
      "The canonical candidate profile workspace was not found.",
    );
    await storage.saveCanonicalCandidateProfile(workspace.id, root);
    await storage.saveCanonicalCandidateProfile(otherWorkspace.id, root);
    await storage.saveCanonicalCandidateProfile(workspace.id, otherProfile);
    expect(
      await storage.listCanonicalCandidateProfileVersions(otherWorkspace.id, root.id),
    ).toHaveLength(1);
    expect(await storage.listCanonicalCandidateProfileVersions(workspace.id, root.id)).toHaveLength(
      1,
    );

    await expect(
      storage.saveCanonicalCandidateProfile(
        workspace.id,
        canonicalCandidateProfile({ version: 3, parentVersion: 2 }),
      ),
    ).rejects.toThrow(/immediate predecessor|append after the current leaf/i);

    const timestampRoot = canonicalCandidateProfile({ id: "profile-timestamp" });
    await storage.saveCanonicalCandidateProfile(workspace.id, timestampRoot);
    await expect(
      storage.saveCanonicalCandidateProfile(
        workspace.id,
        canonicalCandidateProfile({
          id: timestampRoot.id,
          version: 2,
          parentVersion: 1,
          createdAt: "2026-08-12T09:59:59.000Z",
          updatedAt: "2026-08-12T10:00:00.000Z",
        }),
      ),
    ).rejects.toThrow("The canonical candidate profile timestamp precedes its parent version.");
    await storage.close();
  });

  it("fails closed on corrupted canonical profile payloads and identity metadata", async () => {
    const payloadDirectory = await mkdtemp(join(tmpdir(), "draft-loop-canonical-profile-payload-"));
    const payloadFilename = join(payloadDirectory, "history.sqlite");
    const payloadStorage = openSqliteStorage(payloadFilename);
    await payloadStorage.saveWorkspace(workspace);
    const payloadSaved = await payloadStorage.saveCanonicalCandidateProfile(
      workspace.id,
      canonicalCandidateProfile({ id: "profile-payload" }),
    );
    await payloadStorage.close();

    const payloadRaw = openRawDatabase(payloadFilename);
    payloadRaw.exec("DROP TRIGGER canonical_candidate_profile_versions_immutable_update");
    payloadRaw.exec(
      `UPDATE canonical_candidate_profile_versions SET payload_json = payload_json || ' ' WHERE profile_id = '${payloadSaved.profile.id}'`,
    );
    payloadRaw.close();
    const payloadReopened = openSqliteStorage(payloadFilename);
    await expect(
      payloadReopened.getCanonicalCandidateProfile(
        workspace.id,
        payloadSaved.profile.id,
        payloadSaved.profile.version,
      ),
    ).rejects.toThrow("The stored canonical candidate profile payload is not canonical.");
    await payloadReopened.close();
    await rm(payloadDirectory, { recursive: true, force: true });

    const checksumDirectory = await mkdtemp(
      join(tmpdir(), "draft-loop-canonical-profile-checksum-"),
    );
    const checksumFilename = join(checksumDirectory, "history.sqlite");
    const checksumStorage = openSqliteStorage(checksumFilename);
    await checksumStorage.saveWorkspace(workspace);
    const checksumSaved = await checksumStorage.saveCanonicalCandidateProfile(
      workspace.id,
      canonicalCandidateProfile({ id: "profile-checksum" }),
    );
    await checksumStorage.close();
    const checksumRaw = openRawDatabase(checksumFilename);
    checksumRaw.exec("DROP TRIGGER canonical_candidate_profile_versions_immutable_update");
    checksumRaw.exec(
      `UPDATE canonical_candidate_profile_versions SET payload_checksum = '${"0".repeat(64)}' WHERE profile_id = '${checksumSaved.profile.id}'`,
    );
    checksumRaw.close();
    const checksumReopened = openSqliteStorage(checksumFilename);
    await expect(
      checksumReopened.getCanonicalCandidateProfile(
        workspace.id,
        checksumSaved.profile.id,
        checksumSaved.profile.version,
      ),
    ).rejects.toThrow("The stored canonical candidate profile checksum is invalid.");
    await checksumReopened.close();
    await rm(checksumDirectory, { recursive: true, force: true });

    const identityDirectory = await mkdtemp(
      join(tmpdir(), "draft-loop-canonical-profile-identity-"),
    );
    const identityFilename = join(identityDirectory, "history.sqlite");
    const identityStorage = openSqliteStorage(identityFilename);
    await identityStorage.saveWorkspace(workspace);
    const identitySaved = await identityStorage.saveCanonicalCandidateProfile(
      workspace.id,
      canonicalCandidateProfile({ id: "profile-identity" }),
    );
    await identityStorage.close();
    const identityRaw = openRawDatabase(identityFilename);
    identityRaw.exec("DROP TRIGGER canonical_candidate_profile_versions_immutable_update");
    identityRaw.exec(
      `UPDATE canonical_candidate_profile_versions SET profile_id = 'profile-moved' WHERE profile_id = '${identitySaved.profile.id}'`,
    );
    identityRaw.close();
    const identityReopened = openSqliteStorage(identityFilename);
    await expect(
      identityReopened.getCanonicalCandidateProfile(workspace.id, "profile-moved", 1),
    ).rejects.toThrow("The stored canonical candidate profile metadata is inconsistent.");
    await identityReopened.close();
    await rm(identityDirectory, { recursive: true, force: true });
  });

  it("fails closed on duplicate saves when profile lineage is corrupted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-canonical-profile-lineage-"));
    const filename = join(directory, "history.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.saveWorkspace(workspace);
    const root = canonicalCandidateProfile({ id: "profile-lineage" });
    await storage.saveCanonicalCandidateProfile(workspace.id, root);
    const child = canonicalCandidateProfile({
      id: root.id,
      version: 2,
      parentVersion: 1,
      createdAt: "2026-08-12T10:01:00.000Z",
      updatedAt: "2026-08-12T10:01:00.000Z",
    });
    const savedChild = await storage.saveCanonicalCandidateProfile(workspace.id, child);
    await storage.close();

    const corrupted = openRawDatabase(filename);
    corrupted.exec("DROP TRIGGER canonical_candidate_profile_versions_immutable_delete");
    corrupted.exec("PRAGMA foreign_keys = OFF");
    corrupted.exec(
      `DELETE FROM canonical_candidate_profile_versions WHERE workspace_id = '${workspace.id}' AND profile_id = '${root.id}' AND version = 1`,
    );
    corrupted.close();

    const reopened = openSqliteStorage(filename);
    const expectedError =
      "The canonical candidate profile history is not a contiguous append-only chain.";
    await expect(
      reopened.getCanonicalCandidateProfile(workspace.id, root.id, savedChild.profile.version),
    ).rejects.toThrow(expectedError);
    await expect(
      reopened.getLatestCanonicalCandidateProfile(workspace.id, root.id),
    ).rejects.toThrow(expectedError);
    await expect(
      reopened.listCanonicalCandidateProfileVersions(workspace.id, root.id),
    ).rejects.toThrow(expectedError);
    await expect(
      reopened.saveCanonicalCandidateProfile(workspace.id, savedChild.profile),
    ).rejects.toThrow(expectedError);
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects malformed writing policy inputs and detects corrupted persisted payloads", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-writing-policy-corruption-"));
    const filename = join(directory, "history.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.saveWorkspace(workspace);
    const saved = await storage.saveWritingPolicyVersion(
      workspace.id,
      writingPolicy("Stored policy", { version: "policy-corruption" }),
      { createdAt: "2026-08-12T10:01:00.000Z" },
    );
    await expect(
      storage.saveWritingPolicyVersion(workspace.id, {
        ...writingPolicy("Stored policy", { version: "policy-corruption" }),
        checksum: "0".repeat(64),
      }),
    ).rejects.toThrow(StorageValidationError);
    await storage.close();

    const corrupted = openRawDatabase(filename);
    corrupted.exec("DROP TRIGGER writing_policy_versions_immutable_update;");
    corrupted.exec(
      "UPDATE writing_policy_versions SET payload_checksum = '" +
        "0".repeat(64) +
        "' WHERE policy_checksum = '" +
        saved.checksum +
        "'",
    );
    corrupted.close();

    const reopened = openSqliteStorage(filename);
    await expect(reopened.getWritingPolicyVersion(workspace.id, saved.checksum)).rejects.toThrow(
      "The stored writing policy payload checksum is invalid.",
    );
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("fails closed when persisted policy history has multiple current leaves", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-writing-policy-leaves-"));
    const filename = join(directory, "history.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.saveWorkspace(workspace);
    const first = await storage.saveWritingPolicyVersion(
      workspace.id,
      writingPolicy("Leaf policy one", { version: "leaf-1" }),
      { createdAt: "2026-08-12T10:01:00.000Z" },
    );
    const second = await storage.saveWritingPolicyVersion(
      workspace.id,
      writingPolicy("Leaf policy two", { version: "leaf-2" }),
      { createdAt: "2026-08-12T10:02:00.000Z" },
    );
    await storage.close();

    const corrupted = openRawDatabase(filename);
    corrupted.exec("DROP TRIGGER writing_policy_versions_immutable_update;");
    corrupted.exec(
      `UPDATE writing_policy_versions SET prior_checksum = NULL WHERE policy_checksum = '${second.checksum}'`,
    );
    corrupted.close();

    const reopened = openSqliteStorage(filename);
    await expect(reopened.getLatestWritingPolicyVersion(workspace.id)).rejects.toThrow(
      "The writing policy history has multiple current leaves.",
    );
    await expect(reopened.listWritingPolicyVersions(workspace.id)).rejects.toThrow(
      "The writing policy history has multiple current leaves.",
    );
    await expect(
      reopened.saveWritingPolicyVersion(
        workspace.id,
        writingPolicy("Leaf policy three", { version: "leaf-3" }),
        { createdAt: "2026-08-12T10:03:00.000Z", priorChecksum: first.checksum },
      ),
    ).rejects.toThrow("The writing policy history has multiple current leaves.");
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("upgrades a v22 database with empty policy history and preserves legacy policy snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-writing-policy-migration-"));
    const filename = join(directory, "history.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.saveWorkspace(workspace);
    const legacyPayload = {
      job: "legacy fixture",
      writingPolicy: {
        content: "Legacy policy snapshot",
        checksum: "a".repeat(64),
        version: "sha256:legacy-policy",
      },
    };
    const legacySnapshot = await initial.saveContextSnapshot(contextSnapshot(legacyPayload));
    await initial.close();

    const legacy = openRawDatabase(filename);
    legacy.exec(
      "DROP TABLE writing_policy_versions; DELETE FROM schema_migrations WHERE version = 23;",
    );
    legacy.close();

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions().at(-1)).toBe(26);
    expect(await upgraded.getContextSnapshot(legacySnapshot.id)).toEqual(legacySnapshot);
    expect(await upgraded.getLatestWritingPolicyVersion(workspace.id)).toBeUndefined();
    expect(
      queryRawDatabase(filename, "SELECT COUNT(*) AS count FROM writing_policy_versions"),
    ).toEqual([{ count: 0 }]);
    expect(
      queryRawDatabase(
        filename,
        "SELECT COUNT(*) AS count FROM canonical_candidate_profile_versions",
      ),
    ).toEqual([{ count: 0 }]);
    upgraded.migrate();
    expect(upgraded.appliedMigrationVersions().at(-1)).toBe(26);
    await upgraded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("enforces opportunity workspace, lineage, timestamps, transitions, and isolation", async () => {
    const storage = openSqliteStorage(":memory:");
    const otherWorkspace: WorkspaceRecord = { ...workspace, id: "workspace-2" };
    await storage.saveWorkspace(workspace);
    await storage.saveWorkspace(otherWorkspace);
    const versionOne = opportunityBrief();
    const versionTwo = opportunityBrief({
      version: 2,
      priorVersion: 1,
      createdAt: "2026-08-12T10:01:00.000Z",
    });

    await expect(storage.saveOpportunityBrief("missing-workspace", versionOne)).rejects.toThrow(
      "The opportunity workspace was not found.",
    );
    await expect(storage.saveOpportunityBrief(workspace.id, versionTwo)).rejects.toThrow(
      "The opportunity brief parent version is missing.",
    );
    await storage.saveOpportunityBrief(workspace.id, versionOne);
    await expect(
      storage.saveOpportunityBrief(
        workspace.id,
        opportunityBrief({
          role: { value: "Conflicting title", sourceIds: ["opportunity-source-1"] },
        }),
      ),
    ).rejects.toThrow("The opportunity brief version is immutable.");
    await expect(
      storage.saveOpportunityBrief(
        workspace.id,
        opportunityBrief({
          version: 2,
          priorVersion: 1,
          createdAt: "2026-08-12T09:59:59.000Z",
        }),
      ),
    ).rejects.toThrow("The opportunity brief timestamp precedes its parent version.");

    const reviewed = opportunityBrief({
      version: 2,
      priorVersion: 1,
      status: "reviewed",
      createdAt: "2026-08-12T10:02:00.000Z",
      reviewedAt: "2026-08-12T10:02:00.000Z",
      role: { value: "Role", sourceIds: ["opportunity-source-1"] },
      employer: { value: "Employer", sourceIds: ["opportunity-source-1"] },
      requirements: [
        {
          id: "requirement-1",
          text: "Requirement",
          priority: "critical",
          sourceIds: ["opportunity-source-1"],
        },
      ],
    });
    await storage.saveOpportunityBrief(workspace.id, reviewed);
    await expect(
      storage.saveOpportunityBrief(workspace.id, {
        ...reviewed,
        version: 3,
        priorVersion: 2,
        createdAt: "2026-08-12T10:03:00.000Z",
        reviewedAt: "2026-08-12T10:03:00.000Z",
      }),
    ).rejects.toThrow("A reviewed opportunity brief cannot transition directly to reviewed.");

    await storage.saveOpportunityBrief(otherWorkspace.id, versionOne);
    expect(
      await storage.listOpportunityBriefVersions(otherWorkspace.id, versionOne.id),
    ).toHaveLength(1);
    expect(await storage.listOpportunityBriefVersions(workspace.id, versionOne.id)).toHaveLength(2);
    await storage.close();
  });

  it("migrates v21 opportunity storage and rejects corrupted rows after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-opportunity-migration-"));
    const filename = join(directory, "history.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.saveWorkspace(workspace);
    await initial.close();

    const legacy = openRawDatabase(filename);
    legacy.exec(
      "DROP TABLE opportunity_brief_versions; DELETE FROM schema_migrations WHERE version = 22;",
    );
    legacy.close();

    const migrated = openSqliteStorage(filename);
    expect(migrated.appliedMigrationVersions().at(-1)).toBe(26);
    expect(await migrated.getWorkspace(workspace.id)).toEqual(workspace);
    const saved = await migrated.saveOpportunityBrief(workspace.id, opportunityBrief());
    await migrated.close();

    const corrupted = openRawDatabase(filename);
    corrupted.exec(
      "DROP TRIGGER opportunity_brief_versions_immutable_update; UPDATE opportunity_brief_versions SET created_at = '2026-08-12T10:01:00.000Z';",
    );
    corrupted.close();

    const reopened = openSqliteStorage(filename);
    await expect(reopened.getOpportunityBrief(workspace.id, saved.brief.id, 1)).rejects.toThrow(
      "The stored opportunity brief metadata is inconsistent.",
    );
    await reopened.close();

    const checksumCorrupted = openRawDatabase(filename);
    checksumCorrupted.exec(
      "UPDATE opportunity_brief_versions SET created_at = '2026-08-12T10:00:00.000Z', payload_checksum = '0000000000000000000000000000000000000000000000000000000000000000';",
    );
    checksumCorrupted.close();

    const checksumReopened = openSqliteStorage(filename);
    await expect(
      checksumReopened.getOpportunityBrief(workspace.id, saved.brief.id, 1),
    ).rejects.toThrow("The stored opportunity brief checksum is invalid.");
    await checksumReopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates v12 to v13 without backfilling directory membership", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-directory-migration-"));
    const filename = join(directory, "knowledge.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await initial.close();

    const legacy = openRawDatabase(filename);
    legacy.exec(
      "PRAGMA foreign_keys = OFF; DROP TABLE candidate_knowledge_directory_members; DROP TABLE candidate_knowledge_directory_bindings; DELETE FROM schema_migrations WHERE version = 13;",
    );
    legacy.close();

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    const raw = openRawDatabase(filename);
    expect(
      raw
        .prepare(
          "SELECT COUNT(*) AS count FROM candidate_knowledge_directory_bindings UNION ALL SELECT COUNT(*) FROM candidate_knowledge_directory_members",
        )
        .all(),
    ).toEqual([{ count: 0 }, { count: 0 }]);
    raw.close();
    await upgraded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates a v13 directory binding to a revision-one current-root projection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-root-revision-migration-"));
    const filename = join(directory, "knowledge.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await initial.close();

    const legacy = openRawDatabase(filename);
    legacy.exec(
      `PRAGMA foreign_keys = OFF;
       DROP VIEW candidate_knowledge_directory_current_roots;
       DROP TRIGGER candidate_knowledge_directory_bindings_create_root_revision;
       DROP TRIGGER candidate_knowledge_directory_root_revisions_require_valid_insert;
       DROP TRIGGER candidate_knowledge_directory_root_revisions_immutable_update;
       DROP TRIGGER candidate_knowledge_directory_root_revisions_immutable_delete;
       DROP TABLE candidate_knowledge_directory_root_revisions;
       DELETE FROM schema_migrations WHERE version = 14;
       INSERT INTO candidate_knowledge_directory_bindings
         (id, candidate_knowledge_base_id, root_path, bound_at)
       VALUES ('legacy-directory', 'ckb-1', '/legacy/selected', '2026-08-12T09:30:00.000Z');`,
    );
    legacy.close();

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    expect(
      queryRawDatabase(
        filename,
        `SELECT directory_id, candidate_knowledge_base_id, revision, root_path, bound_at
         FROM candidate_knowledge_directory_root_revisions`,
      ),
    ).toEqual([
      {
        directory_id: "legacy-directory",
        candidate_knowledge_base_id: "ckb-1",
        revision: 1,
        root_path: "/legacy/selected",
        bound_at: "2026-08-12T09:30:00.000Z",
      },
    ]);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await upgraded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("rejects a tampered revision-one root baseline during graph validation", async () => {
    for (const [field, value] of [
      ["root_path", "/legacy/tampered"],
      ["bound_at", "2026-08-12T09:31:00.000Z"],
    ] as const) {
      const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-root-baseline-corruption-"));
      const filename = join(directory, "knowledge.sqlite");
      const initial = openSqliteStorage(filename);
      await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
      await initial.close();

      const corrupted = openRawDatabase(filename);
      corrupted.exec(
        `PRAGMA foreign_keys = OFF;
         INSERT INTO candidate_knowledge_directory_bindings
           (id, candidate_knowledge_base_id, root_path, bound_at)
         VALUES ('baseline-directory', 'ckb-1', '/legacy/selected', '2026-08-12T09:30:00.000Z');
         DROP TRIGGER candidate_knowledge_directory_root_revisions_immutable_update;
         UPDATE candidate_knowledge_directory_root_revisions
         SET ${field} = '${value}'
         WHERE directory_id = 'baseline-directory' AND revision = 1;`,
      );
      corrupted.close();

      const reopened = openSqliteStorage(filename);
      expect(() => reopened.validateCandidateKnowledgeSourceGraph()).toThrow(
        /revision-one root baseline/i,
      );
      await reopened.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("upgrades a persisted v1 database without losing workspace history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-migration-"));
    const filename = join(directory, "workspace.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.saveWorkspace(workspace);
    const legacyContext = await initial.saveContextSnapshot(contextSnapshot({ job: "fixture" }));
    await initial.close();

    removeMigrationTwo(filename);
    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await expect(upgraded.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    const migratedContext = await upgraded.getContextSnapshot(legacyContext.id);
    expect(migratedContext).toEqual(legacyContext);
    expect(migratedContext?.payload).not.toHaveProperty("candidateKnowledgeSelection");
    upgraded.migrate();
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await upgraded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates v25 artifact history without losing dependent rows or lineage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-artifact-history-migration-"));
    const filename = join(directory, "workspace.sqlite");
    const backupFilename = join(directory, "workspace-backup.sqlite");
    const initial = openSqliteStorage(filename);
    await seedHistory(initial);
    const child = await initial.saveArtifactVersion(
      artifact(
        { value: "child" },
        {
          id: "artifact-child",
          version: 2,
          parentVersionId: "artifact-1",
          createdAt: "2026-08-12T10:04:01.000Z",
        },
      ),
    );
    const rootArtifact = await initial.getArtifactVersion("artifact-1");
    if (rootArtifact === undefined) throw new Error("The fixture did not produce a root artifact.");
    await initial.close();

    restoreLegacyArtifactHistory(filename);

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await expect(upgraded.getArtifactVersion(rootArtifact.id)).resolves.toEqual(rootArtifact);
    await expect(upgraded.getArtifactVersion(child.id)).resolves.toEqual(child);
    await expect(upgraded.getRun("run-1")).resolves.toMatchObject(run());
    await expect(upgraded.getRound("round-1")).resolves.toMatchObject(round());
    await expect(upgraded.getExecution("execution-1")).resolves.toMatchObject(execution());
    await expect(upgraded.listFindings("run-1")).resolves.toHaveLength(1);
    await expect(upgraded.listDecisions("run-1")).resolves.toHaveLength(1);
    await expect(upgraded.listExports("run-1")).resolves.toHaveLength(1);

    const raw = openRawDatabase(filename);
    expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      raw
        .prepare("PRAGMA index_list(artifact_versions)")
        .all()
        .some((index) => index.unique === 1 && index.origin === "u"),
    ).toBe(false);
    expect(() =>
      raw.exec("UPDATE artifact_versions SET payload_json = '{}' WHERE id = 'artifact-1'"),
    ).toThrow(/immutable/i);
    expect(() => raw.exec("DELETE FROM artifact_versions WHERE id = 'artifact-1'")).toThrow(
      /immutable/i,
    );
    raw.close();

    await upgraded.backup(backupFilename);
    await upgraded.close();

    const reopened = openSqliteStorage(backupFilename);
    await expect(reopened.getArtifactVersion(child.id)).resolves.toEqual(child);
    await expect(reopened.getRun("run-1")).resolves.toMatchObject(run());
    await expect(reopened.listFindings("run-1")).resolves.toHaveLength(1);
    await expect(reopened.listDecisions("run-1")).resolves.toHaveLength(1);
    await expect(reopened.listExports("run-1")).resolves.toHaveLength(1);
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("upgrades a populated v3 database with candidate knowledge-base storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-migration-"));
    const filename = join(directory, "workspace.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.saveWorkspace(workspace);
    await initial.close();

    removeMigrationFour(filename);
    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await expect(upgraded.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    await expect(
      upgraded.ensureDefaultCandidateKnowledgeBase(knowledgeBase()),
    ).resolves.toMatchObject({ id: "ckb-1", isDefault: true, state: "active" });
    await upgraded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("upgrades a populated v4 database with candidate knowledge-source storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-source-migration-"));
    const filename = join(directory, "workspace.sqlite");
    const initial = openSqliteStorage(filename);
    const savedKnowledgeBase = await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await initial.close();

    removeMigrationFive(filename);
    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await expect(upgraded.getCandidateKnowledgeBase(savedKnowledgeBase.id)).resolves.toEqual(
      savedKnowledgeBase,
    );
    await expect(
      upgraded.createCandidateKnowledgeSource(knowledgeSource(), knowledgeSourceVersion()),
    ).resolves.toMatchObject({ created: true, version: { version: 1, parentVersionId: null } });
    await upgraded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("upgrades populated v5 source metadata as unmanaged and can materialize it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-managed-migration-"));
    const filename = join(directory, "knowledge.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    const legacy = await initial.createCandidateKnowledgeSource(
      knowledgeSource(),
      knowledgeSourceVersion(),
    );
    await initial.close();

    removeMigrationSix(filename);
    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await expect(
      upgraded.isCandidateKnowledgeSourceVersionManaged("ckb-1", "ckb-source-1", legacy.version.id),
    ).resolves.toBe(false);
    await expect(
      (async () => {
        const version = knowledgeSourceVersion({
          id: "ignored-materialization-id",
          createdAt: "2026-08-12T09:12:00.000Z",
        });
        await upgraded.prepareManagedCandidateKnowledgeWrite({
          operationId: "materialize-operation",
          knowledgeBaseId: "ckb-1",
          sourceId: "ckb-source-1",
          requestedVersionId: version.id,
          kind: "append",
          createdAt: version.createdAt,
        });
        await upgraded.recordManagedCandidateKnowledgeWriteEvent(
          "materialize-operation",
          "targeted",
          legacy.version.id,
          version.createdAt,
        );
        await upgraded.recordManagedCandidateKnowledgeWriteEvent(
          "materialize-operation",
          "published",
          legacy.version.id,
          version.createdAt,
        );
        return upgraded.commitManagedCandidateKnowledgeWrite({
          kind: "append",
          operationId: "materialize-operation",
          version,
        });
      })(),
    ).resolves.toEqual({ ...legacy, created: false });
    await expect(
      upgraded.isCandidateKnowledgeSourceVersionManaged("ckb-1", "ckb-source-1", legacy.version.id),
    ).resolves.toBe(true);
    expect(upgraded.listManagedCandidateKnowledgeSourceVersions()).toMatchObject([
      { id: legacy.version.id, sourceId: legacy.source.id, kind: "file" },
    ]);
    await upgraded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("upgrades v6 managed markers without retroactively claiming journal ownership", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-journal-migration-"));
    const filename = join(directory, "knowledge.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    const managed = await initial.createCandidateKnowledgeSource(
      knowledgeSource(),
      knowledgeSourceVersion(),
    );
    await initial.close();

    const legacyDatabase = openRawDatabase(filename);
    legacyDatabase.exec(
      "INSERT INTO candidate_knowledge_managed_source_versions(version_id) VALUES ('ckb-source-version-1')",
    );
    legacyDatabase.close();

    removeMigrationSeven(filename);
    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await expect(
      upgraded.isCandidateKnowledgeSourceVersionManaged(
        managed.source.knowledgeBaseId,
        managed.source.id,
        managed.version.id,
      ),
    ).resolves.toBe(true);
    upgraded.validateCandidateKnowledgeSourceGraph();
    upgraded.migrate();
    await upgraded.close();

    const database = openRawDatabase(filename);
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM candidate_knowledge_managed_write_operations")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM candidate_knowledge_managed_write_events")
        .get(),
    ).toEqual({ count: 0 });
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates a v8 origin binding to guarded v9 rebinding", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-origin-rebind-migration-"));
    const filename = join(directory, "knowledge.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    const version = knowledgeSourceVersion({
      createdAt: "2026-08-12T09:11:00.000Z",
    });
    await initial.prepareManagedCandidateKnowledgeWrite({
      operationId: "origin-rebind-migration-create",
      knowledgeBaseId: "ckb-1",
      sourceId: "ckb-source-1",
      requestedVersionId: version.id,
      kind: "create",
      createdAt: version.createdAt,
    });
    await initial.recordManagedCandidateKnowledgeWriteEvent(
      "origin-rebind-migration-create",
      "targeted",
      version.id,
      version.createdAt,
    );
    await initial.recordManagedCandidateKnowledgeWriteEvent(
      "origin-rebind-migration-create",
      "published",
      version.id,
      version.createdAt,
    );
    await initial.commitManagedCandidateKnowledgeWrite({
      kind: "create",
      operationId: "origin-rebind-migration-create",
      source: knowledgeSource(),
      version,
      originPath: "/candidate.md",
    });
    await initial.close();

    const legacy = openRawDatabase(filename);
    legacy.exec(
      "DROP TRIGGER candidate_knowledge_source_origin_bindings_guarded_update; DELETE FROM schema_migrations WHERE version = 9; CREATE TRIGGER candidate_knowledge_source_origin_bindings_immutable_update BEFORE UPDATE ON candidate_knowledge_source_origin_bindings BEGIN SELECT RAISE(ABORT, 'candidate knowledge source origin bindings are immutable'); END;",
    );
    legacy.close();

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await expect(
      upgraded.getCandidateKnowledgeSourceOriginBinding("ckb-1", "ckb-source-1"),
    ).resolves.toEqual({
      sourceId: "ckb-source-1",
      originPath: "/candidate.md",
      boundAt: version.createdAt,
    });
    await upgraded.close();

    const guarded = openRawDatabase(filename);
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_origin_bindings SET source_id = 'other-source' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_origin_bindings SET origin_path = '/older.md', bound_at = '2026-08-12T09:10:00.000Z' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    guarded.exec(
      "DROP TRIGGER candidate_knowledge_sources_immutable_update; UPDATE candidate_knowledge_sources SET kind = 'url' WHERE id = 'ckb-source-1'",
    );
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_origin_bindings SET origin_path = '/unmanaged.md', bound_at = '2026-08-12T09:12:00.000Z' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    guarded.exec("UPDATE candidate_knowledge_sources SET kind = 'file' WHERE id = 'ckb-source-1'");
    guarded.close();

    const rebound = openSqliteStorage(filename);
    await expect(
      rebound.rebindCandidateKnowledgeSourceOrigin(
        "ckb-1",
        "ckb-source-1",
        "/replacement.md",
        "2026-08-12T09:12:00.000Z",
      ),
    ).resolves.toEqual({
      sourceId: "ckb-source-1",
      originPath: "/replacement.md",
      boundAt: "2026-08-12T09:12:00.000Z",
    });
    await rebound.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates v9 to empty v10 refresh observations and preserves new state across reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-refresh-state-migration-"));
    const filename = join(directory, "knowledge.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    const source = await initial.createCandidateKnowledgeSource(
      knowledgeSource(),
      knowledgeSourceVersion({ createdAt: "2026-08-12T09:11:00.000Z" }),
    );
    await initial.createCandidateKnowledgeSource(
      knowledgeSource({ id: "other-source" }),
      knowledgeSourceVersion({ id: "other-version" }),
    );
    await initial.close();

    const legacy = openRawDatabase(filename);
    legacy.exec(
      "DROP TABLE candidate_knowledge_source_refresh_observations; DELETE FROM schema_migrations WHERE version = 10",
    );
    legacy.close();

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await expect(
      upgraded.getCandidateKnowledgeSourceRefreshObservation("ckb-1", "ckb-source-1"),
    ).resolves.toBeUndefined();
    const observation = await upgraded.upsertCandidateKnowledgeSourceRefreshObservation(
      "ckb-1",
      "ckb-source-1",
      {
        observedVersionId: source.version.id,
        status: "current",
        checkedAt: "2026-08-12T09:12:00.000Z",
      },
    );
    expect(observation).toEqual({
      sourceId: "ckb-source-1",
      observedVersionId: source.version.id,
      status: "current",
      checkedAt: "2026-08-12T09:12:00.000Z",
      lastRefreshedVersionId: null,
      lastRefreshedAt: null,
      stale: false,
    });
    await expect(
      upgraded.getCandidateKnowledgeBaseLifecycleReadiness("ckb-1"),
    ).resolves.toMatchObject({
      knowledgeBaseId: "ckb-1",
      state: "active",
      sources: [
        {
          sourceId: "ckb-source-1",
          latestVersionId: source.version.id,
          status: "blocked",
          reasons: ["latest-version-unmanaged", "source-origin-unbound"],
        },
        {
          sourceId: "other-source",
          latestVersionId: "other-version",
          status: "blocked",
          reasons: ["latest-version-unmanaged", "source-origin-unbound"],
        },
      ],
    });
    await upgraded.close();

    const reopened = openSqliteStorage(filename);
    await expect(
      reopened.getCandidateKnowledgeSourceRefreshObservation("ckb-1", "ckb-source-1"),
    ).resolves.toEqual(observation);
    await reopened.close();

    const guarded = openRawDatabase(filename);
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_refresh_observations SET source_id = 'other-source' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_refresh_observations SET observed_version_id = 'other-version' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_refresh_observations SET status = 'invalid' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_refresh_observations SET last_refreshed_version_id = 'ckb-source-version-1' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_refresh_observations SET last_refreshed_version_id = 'ckb-source-version-1', last_refreshed_at = '2026-08-12T09:13:00.000Z' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "INSERT INTO candidate_knowledge_source_refresh_observations (source_id, observed_version_id, status, checked_at, last_refreshed_version_id, last_refreshed_at) VALUES ('other-source', 'other-version', 'missing', '2026-08-12T09:13:00.000Z', 'other-version', '2026-08-12T09:13:00.000Z')",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_refresh_observations SET checked_at = '2026-08-12T09:11:00.000Z' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "DELETE FROM candidate_knowledge_source_refresh_observations WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    guarded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates v10 to immutable source retirements and preserves them across reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-source-retirement-migration-"));
    const filename = join(directory, "knowledge.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await initial.createCandidateKnowledgeSource(
      knowledgeSource(),
      knowledgeSourceVersion({ createdAt: "2026-08-12T09:11:00.000Z" }),
    );
    await initial.close();

    const legacy = openRawDatabase(filename);
    legacy.exec(
      "DROP TABLE candidate_knowledge_source_retirements; DELETE FROM schema_migrations WHERE version = 11",
    );
    legacy.close();

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    await expect(
      upgraded.getCandidateKnowledgeSourceRetirement("ckb-1", "ckb-source-1"),
    ).resolves.toBeUndefined();
    const retirement = await upgraded.retireCandidateKnowledgeSource("ckb-1", "ckb-source-1", {
      retiredAt: "2026-08-12T09:12:00.000Z",
      reason: "user-requested",
    });
    expect(retirement).toEqual({
      sourceId: "ckb-source-1",
      retiredAt: "2026-08-12T09:12:00.000Z",
      reason: "user-requested",
    });
    await upgraded.close();

    const reopened = openSqliteStorage(filename);
    await expect(
      reopened.getCandidateKnowledgeSourceRetirement("ckb-1", "ckb-source-1"),
    ).resolves.toEqual(retirement);
    await reopened.close();
    const guarded = openRawDatabase(filename);
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_retirements SET retired_at = '2026-08-12T09:10:00.000Z' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "UPDATE candidate_knowledge_source_retirements SET reason = 'imported' WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    expect(() =>
      guarded.exec(
        "DELETE FROM candidate_knowledge_source_retirements WHERE source_id = 'ckb-source-1'",
      ),
    ).toThrow();
    guarded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates v11 managed markers to URL provenance and preserves it across reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-url-provenance-migration-"));
    const filename = join(directory, "knowledge.sqlite");
    const initial = openSqliteStorage(filename);
    await initial.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await initial.createCandidateKnowledgeSource(
      knowledgeSource({ id: "url-source", kind: "url" }),
      knowledgeSourceVersion({ id: "url-version", createdAt: "2026-08-12T09:11:00.000Z" }),
    );
    await initial.close();

    const legacy = openRawDatabase(filename);
    legacy.exec(
      "DROP TABLE candidate_knowledge_source_url_provenance; DELETE FROM schema_migrations WHERE version = 12",
    );
    legacy.close();

    const upgraded = openSqliteStorage(filename);
    expect(upgraded.appliedMigrationVersions()).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    ]);
    const raw = openRawDatabase(filename);
    expect(() =>
      raw.exec(
        "INSERT INTO candidate_knowledge_source_url_provenance (version_id, source_id, original_url, final_url, fetched_at, kind) VALUES ('url-version', 'url-source', 'https://example.com/source', 'https://example.com/final', '2026-08-12T09:11:00.000Z', 'generic')",
      ),
    ).toThrow();
    raw.exec(
      "INSERT INTO candidate_knowledge_managed_source_versions(version_id) VALUES ('url-version'); INSERT INTO candidate_knowledge_source_url_provenance (version_id, source_id, original_url, final_url, fetched_at, kind) VALUES ('url-version', 'url-source', 'https://example.com/source', 'https://example.com/final', '2026-08-12T09:11:00.000Z', 'generic')",
    );
    raw.close();
    expect(() => upgraded.validateCandidateKnowledgeSourceGraph()).not.toThrow();
    await expect(
      upgraded.getCandidateKnowledgeBaseLifecycleReadiness("ckb-1"),
    ).resolves.toMatchObject({
      sources: [
        {
          sourceId: "url-source",
          latestVersionId: "url-version",
          status: "ready",
          reasons: [],
          lifecycleRevision: {
            managed: true,
            provenanceFetchedAt: "2026-08-12T09:11:00.000Z",
          },
        },
      ],
    });
    await expect(
      upgraded.getCandidateKnowledgeSourceUrlProvenance("ckb-1", "url-source", "url-version"),
    ).resolves.toEqual({
      sourceId: "url-source",
      versionId: "url-version",
      originalUrl: "https://example.com/source",
      finalUrl: "https://example.com/final",
      fetchedAt: "2026-08-12T09:11:00.000Z",
      kind: "generic",
    });
    await upgraded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("validates scoped retirement markers, idempotence, and active-write guards", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-ckb-source-retirement-guards-"));
    const filename = join(directory, "knowledge.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await storage.createCandidateKnowledgeBase(knowledgeBase({ id: "ckb-2", isDefault: false }));
    const active = await storage.createCandidateKnowledgeSource(
      knowledgeSource(),
      knowledgeSourceVersion({ createdAt: "2026-08-12T09:11:00.000Z" }),
    );
    const archived = await storage.createCandidateKnowledgeSource(
      knowledgeSource({ id: "archived-source", knowledgeBaseId: "ckb-2" }),
      knowledgeSourceVersion({ id: "archived-version", createdAt: "2026-08-12T09:11:00.000Z" }),
    );

    await expect(
      storage.getCandidateKnowledgeSourceRetirement("ckb-1", active.source.id),
    ).resolves.toBeUndefined();
    await expect(
      storage.retireCandidateKnowledgeSource("ckb-2", active.source.id, {
        retiredAt: "2026-08-12T09:12:00.000Z",
        reason: "user-requested",
      }),
    ).rejects.toThrow(/not found in candidate knowledge base/i);
    await expect(
      storage.retireCandidateKnowledgeSource("ckb-1", active.source.id, {
        retiredAt: "not-a-time",
        reason: "user-requested",
      }),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.retireCandidateKnowledgeSource("ckb-1", active.source.id, {
        retiredAt: "2026-08-12T09:12:00.000Z",
        reason: "imported" as never,
      }),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.retireCandidateKnowledgeSource("ckb-1", active.source.id, {
        retiredAt: "2026-08-12T09:09:00.000Z",
        reason: "user-requested",
      }),
    ).rejects.toThrow(/must not precede/i);

    const retirement = await storage.retireCandidateKnowledgeSource("ckb-1", active.source.id, {
      retiredAt: "2026-08-12T09:12:00.000Z",
      reason: "user-requested",
    });
    await expect(
      storage.retireCandidateKnowledgeSource("ckb-1", active.source.id, retirement),
    ).resolves.toEqual(retirement);
    await expect(
      storage.retireCandidateKnowledgeSource("ckb-1", active.source.id, {
        retiredAt: "2026-08-12T09:13:00.000Z",
        reason: "user-requested",
      }),
    ).rejects.toThrow(/conflicts/i);
    await expect(
      storage.appendCandidateKnowledgeSourceVersion(
        "ckb-1",
        active.source.id,
        knowledgeSourceVersion({
          id: "retired-append",
          createdAt: "2026-08-12T09:13:00.000Z",
        }),
      ),
    ).rejects.toThrow(/retired/i);
    await expect(
      storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", active.source.id, {
        observedVersionId: active.version.id,
        status: "current",
        checkedAt: "2026-08-12T09:14:00.000Z",
      }),
    ).rejects.toThrow(/retired/i);
    await storage.archiveCandidateKnowledgeBase("ckb-2", "2026-08-12T09:20:00.000Z");
    await storage.close();

    const guarded = openRawDatabase(filename);
    expect(() =>
      guarded.exec(
        `INSERT INTO candidate_knowledge_source_retirements (source_id, retired_at, reason)
         VALUES ('${archived.source.id}', '2026-08-12T09:21:00.000Z', 'user-requested')`,
      ),
    ).toThrow();
    guarded.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("guards refresh observation scope, timestamps, lineage, and deletion", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    const first = await storage.createCandidateKnowledgeSource(
      knowledgeSource(),
      knowledgeSourceVersion({ createdAt: "2026-08-12T09:11:00.000Z" }),
    );
    await storage.createCandidateKnowledgeSource(
      knowledgeSource({ id: "other-source" }),
      knowledgeSourceVersion({ id: "other-version" }),
    );
    const base = {
      observedVersionId: first.version.id,
      status: "current" as const,
      checkedAt: "2026-08-12T09:12:00.000Z",
    };
    await storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, base);
    await storage.appendCandidateKnowledgeSourceVersion(
      "ckb-1",
      first.source.id,
      knowledgeSourceVersion({
        id: "first-version-2",
        checksum: "e".repeat(64),
        sizeBytes: 129,
        createdAt: "2026-08-12T09:13:00.000Z",
      }),
    );
    await expect(
      storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, {
        observedVersionId: first.version.id,
        status: "missing",
        checkedAt: "2026-08-12T09:14:00.000Z",
        lastRefreshedVersionId: "first-version-2",
        lastRefreshedAt: "2026-08-12T09:14:00.000Z",
      }),
    ).rejects.toThrow(/success must observe/i);
    await expect(
      storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, {
        ...base,
        observedVersionId: "other-version",
      }),
    ).rejects.toThrow(/observed version does not belong/i);
    await expect(
      storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, {
        ...base,
        status: "invalid" as "current",
      }),
    ).rejects.toThrow(/unsupported.*status/i);
    await expect(
      storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, {
        ...base,
        checkedAt: "not-a-time",
      }),
    ).rejects.toThrow(/valid ISO timestamp/i);
    await expect(
      storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, {
        ...base,
        lastRefreshedVersionId: first.version.id,
      }),
    ).rejects.toThrow(/paired/i);
    await expect(
      storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, {
        ...base,
        checkedAt: "2026-08-12T09:10:00.000Z",
      }),
    ).rejects.toThrow(/must not precede/i);

    await storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, {
      ...base,
      lastRefreshedVersionId: first.version.id,
      lastRefreshedAt: "2026-08-12T09:12:00.000Z",
    });
    await expect(
      storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, {
        ...base,
        checkedAt: "2026-08-12T09:13:00.000Z",
        lastRefreshedVersionId: first.version.id,
        lastRefreshedAt: "2026-08-12T09:13:00.000Z",
      }),
    ).rejects.toThrow(/cannot change the time/i);
    await expect(
      storage.upsertCandidateKnowledgeSourceRefreshObservation("ckb-1", first.source.id, {
        ...base,
        checkedAt: "2026-08-12T09:13:00.000Z",
        lastRefreshedVersionId: null,
        lastRefreshedAt: null,
      }),
    ).rejects.toThrow(/drop/i);
    await storage.close();
  });

  it("manages one default and additional candidate knowledge-base lifecycles", async () => {
    const storage = openSqliteStorage(":memory:");
    const defaultInput = knowledgeBase();
    const firstDefault = await storage.ensureDefaultCandidateKnowledgeBase(defaultInput);
    const repeatedDefault = await storage.ensureDefaultCandidateKnowledgeBase({
      id: "ignored-default-id",
      displayName: "Ignored after initialization",
      createdAt: "2026-08-12T09:01:00.000Z",
    });
    expect(repeatedDefault).toEqual(firstDefault);

    await expect(
      storage.createCandidateKnowledgeBase(
        knowledgeBase({ id: "second-default", displayName: "Second", isDefault: true }),
      ),
    ).rejects.toThrow(/default candidate knowledge base already exists/i);

    const additional = await storage.createCandidateKnowledgeBase(
      knowledgeBase({ id: "ckb-2", displayName: "  Public projects  ", isDefault: false }),
    );
    expect(additional).toMatchObject({
      id: "ckb-2",
      displayName: "Public projects",
      description: "Sanitized professional material",
      state: "active",
      isDefault: false,
      archivedAt: null,
    });
    await expect(storage.createCandidateKnowledgeBase(knowledgeBase())).rejects.toThrow(
      StorageConflictError,
    );

    const renamed = await storage.renameCandidateKnowledgeBase(
      additional.id,
      "  Selected public work  ",
      "2026-08-12T09:02:00.000Z",
    );
    expect(renamed).toMatchObject({
      displayName: "Selected public work",
      state: "active",
      updatedAt: "2026-08-12T09:02:00.000Z",
    });

    const archived = await storage.archiveCandidateKnowledgeBase(
      additional.id,
      "2026-08-12T09:03:00.000Z",
    );
    expect(archived).toMatchObject({
      state: "archived",
      archivedAt: "2026-08-12T09:03:00.000Z",
      updatedAt: "2026-08-12T09:03:00.000Z",
    });
    await expect(
      storage.archiveCandidateKnowledgeBase(additional.id, "2026-08-12T09:03:00.000Z"),
    ).rejects.toThrow(/already archived/i);
    const renamedArchived = await storage.renameCandidateKnowledgeBase(
      additional.id,
      "Archived public work",
      "2026-08-12T09:04:00.000Z",
    );
    expect(renamedArchived).toEqual({
      ...archived,
      displayName: "Archived public work",
      updatedAt: "2026-08-12T09:04:00.000Z",
    });
    expect(renamedArchived).toMatchObject({
      state: "archived",
      archivedAt: "2026-08-12T09:03:00.000Z",
    });
    await expect(
      storage.archiveCandidateKnowledgeBase(firstDefault.id, "2026-08-12T09:04:00.000Z"),
    ).rejects.toThrow(/default candidate knowledge base cannot be archived/i);

    await expect(storage.listCandidateKnowledgeBases()).resolves.toEqual([
      firstDefault,
      renamedArchived,
    ]);
    await storage.close();
  });

  it("validates candidate knowledge-base inputs and lifecycle timestamps", async () => {
    const storage = openSqliteStorage(":memory:");
    await expect(storage.createCandidateKnowledgeBase(knowledgeBase({ id: " " }))).rejects.toThrow(
      StorageValidationError,
    );
    await expect(
      storage.createCandidateKnowledgeBase(knowledgeBase({ displayName: " " })),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.createCandidateKnowledgeBase(knowledgeBase({ createdAt: "not-a-time" })),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.createCandidateKnowledgeBase(knowledgeBase({ createdAt: "2026-08-12" })),
    ).rejects.toThrow(/valid ISO timestamp/i);
    await expect(storage.getCandidateKnowledgeBase("missing")).resolves.toBeUndefined();
    await expect(
      storage.renameCandidateKnowledgeBase("missing", "Name", "2026-08-12T09:02:00.000Z"),
    ).rejects.toThrow(StorageValidationError);

    await storage.createCandidateKnowledgeBase(knowledgeBase({ id: "ckb-2", isDefault: false }));
    await expect(
      storage.renameCandidateKnowledgeBase("ckb-2", "Name", "2026-08-12T08:59:00.000Z"),
    ).rejects.toThrow(/must not precede/i);
    await expect(
      storage.archiveCandidateKnowledgeBase("ckb-2", "2026-08-12T08:59:00.000Z"),
    ).rejects.toThrow(/must not precede/i);
    await storage.close();
  });

  it("creates and appends immutable candidate knowledge-source versions", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());

    const first = await storage.createCandidateKnowledgeSource(
      knowledgeSource({ displayName: "  Career notes.md  " }),
      knowledgeSourceVersion(),
    );
    expect(first).toEqual({
      created: true,
      source: knowledgeSource(),
      version: {
        ...knowledgeSourceVersion(),
        sourceId: "ckb-source-1",
        version: 1,
        parentVersionId: null,
      },
    });

    const duplicate = await storage.appendCandidateKnowledgeSourceVersion(
      "ckb-1",
      "ckb-source-1",
      knowledgeSourceVersion({ id: "ignored-version-id", createdAt: "2026-08-12T09:12:00.000Z" }),
    );
    expect(duplicate).toEqual({ ...first, created: false });

    await expect(
      storage.appendCandidateKnowledgeSourceVersion(
        "ckb-1",
        "ckb-source-1",
        knowledgeSourceVersion({
          id: "conflicting-integrity-metadata",
          sizeBytes: 999,
          createdAt: "2026-08-12T09:12:00.000Z",
        }),
      ),
    ).rejects.toThrow(StorageConflictError);

    const second = await storage.appendCandidateKnowledgeSourceVersion(
      "ckb-1",
      "ckb-source-1",
      knowledgeSourceVersion({
        id: "ckb-source-version-2",
        checksum: "e".repeat(64),
        sizeBytes: 256,
        createdAt: "2026-08-12T09:13:00.000Z",
      }),
    );
    expect(second).toMatchObject({
      created: true,
      version: {
        id: "ckb-source-version-2",
        sourceId: "ckb-source-1",
        version: 2,
        parentVersionId: "ckb-source-version-1",
      },
    });
    await expect(storage.listCandidateKnowledgeSources("ckb-1")).resolves.toEqual([
      knowledgeSource(),
    ]);
    await expect(
      storage.listCandidateKnowledgeSourceVersions("ckb-1", "ckb-source-1"),
    ).resolves.toEqual([first.version, second.version]);
    storage.validateCandidateKnowledgeSourceGraph();
    await storage.close();
  });

  it("writes managed markers through the journal and requires file-kind sources", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    const firstVersion = knowledgeSourceVersion();
    await storage.prepareManagedCandidateKnowledgeWrite({
      operationId: "create-operation",
      knowledgeBaseId: "ckb-1",
      sourceId: "ckb-source-1",
      requestedVersionId: firstVersion.id,
      kind: "create",
      createdAt: firstVersion.createdAt,
    });
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "create-operation",
      "targeted",
      firstVersion.id,
      firstVersion.createdAt,
    );
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "create-operation",
      "published",
      firstVersion.id,
      firstVersion.createdAt,
    );
    const first = await storage.commitManagedCandidateKnowledgeWrite({
      kind: "create",
      operationId: "create-operation",
      source: knowledgeSource(),
      version: firstVersion,
      originPath: "/candidate.md",
    });
    await expect(
      storage.isCandidateKnowledgeSourceVersionManaged("ckb-1", "ckb-source-1", first.version.id),
    ).resolves.toBe(true);
    await expect(
      (async () => {
        const version = knowledgeSourceVersion({
          id: "ignored-managed-id",
          createdAt: "2026-08-12T09:12:00.000Z",
        });
        await storage.prepareManagedCandidateKnowledgeWrite({
          operationId: "noop-operation",
          knowledgeBaseId: "ckb-1",
          sourceId: "ckb-source-1",
          requestedVersionId: version.id,
          kind: "append",
          createdAt: version.createdAt,
        });
        return storage.recordManagedCandidateKnowledgeWriteNoop("noop-operation", version);
      })(),
    ).resolves.toEqual({ ...first, created: false });
    const urlVersion = knowledgeSourceVersion({ id: "url-version" });
    await storage.prepareManagedCandidateKnowledgeWrite({
      operationId: "url-operation",
      knowledgeBaseId: "ckb-1",
      sourceId: "url-source",
      requestedVersionId: urlVersion.id,
      kind: "create",
      createdAt: urlVersion.createdAt,
    });
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "url-operation",
      "targeted",
      urlVersion.id,
      urlVersion.createdAt,
    );
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "url-operation",
      "published",
      urlVersion.id,
      urlVersion.createdAt,
    );
    await expect(
      storage.commitManagedCandidateKnowledgeWrite({
        kind: "create",
        operationId: "url-operation",
        source: knowledgeSource({ id: "url-source", kind: "url" }),
        version: urlVersion,
        urlProvenance: {
          originalUrl: "https://example.com/url-source",
          finalUrl: "https://example.com/url-source",
          fetchedAt: urlVersion.createdAt,
          kind: "generic",
        },
      }),
    ).resolves.toMatchObject({ source: { id: "url-source", kind: "url" }, created: true });
    await expect(storage.getCandidateKnowledgeSource("ckb-1", "url-source")).resolves.toMatchObject(
      { id: "url-source", kind: "url" },
    );

    await storage.createCandidateKnowledgeSource(
      knowledgeSource({ id: "occupying-source", displayName: "Occupying source" }),
      knowledgeSourceVersion({ id: "occupied-managed-version", checksum: "e".repeat(64) }),
    );
    const occupiedVersion = knowledgeSourceVersion({
      id: "occupied-managed-version",
      checksum: "f".repeat(64),
    });
    await storage.prepareManagedCandidateKnowledgeWrite({
      operationId: "occupied-operation",
      knowledgeBaseId: "ckb-1",
      sourceId: "rolled-back-managed-source",
      requestedVersionId: occupiedVersion.id,
      kind: "create",
      createdAt: occupiedVersion.createdAt,
    });
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "occupied-operation",
      "targeted",
      occupiedVersion.id,
      occupiedVersion.createdAt,
    );
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "occupied-operation",
      "published",
      occupiedVersion.id,
      occupiedVersion.createdAt,
    );
    await expect(
      storage.commitManagedCandidateKnowledgeWrite({
        kind: "create",
        operationId: "occupied-operation",
        source: knowledgeSource({
          id: "rolled-back-managed-source",
          displayName: "Rolled back",
        }),
        version: occupiedVersion,
        originPath: "/occupied.md",
      }),
    ).rejects.toThrow();
    await expect(
      storage.getCandidateKnowledgeSource("ckb-1", "rolled-back-managed-source"),
    ).resolves.toBeUndefined();
    await storage.close();
  });

  it("lists owned journal phases and terminalizes prepared intents safely", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await storage.prepareManagedCandidateKnowledgeWrite({
      operationId: "owned-operation",
      knowledgeBaseId: "ckb-1",
      sourceId: "owned-source",
      requestedVersionId: "owned-version",
      kind: "create",
      createdAt: "2026-08-12T09:10:00.000Z",
      ownerGeneration: 7,
      requestedMediaType: "text/markdown",
      requestedChecksum: "a".repeat(64),
      requestedSizeBytes: 12,
    });
    await expect(storage.listManagedCandidateKnowledgeWriteOperations()).resolves.toEqual([
      {
        operationId: "owned-operation",
        knowledgeBaseId: "ckb-1",
        sourceId: "owned-source",
        requestedVersionId: "owned-version",
        kind: "create",
        createdAt: "2026-08-12T09:10:00.000Z",
        ownerKind: "draft-loop",
        ownerSchemaVersion: 1,
        ownerGeneration: 7,
        requestedMediaType: "text/markdown",
        requestedChecksum: "a".repeat(64),
        requestedSizeBytes: 12,
        latestPhase: "prepared",
        latestEventCreatedAt: null,
        targetVersionId: null,
        stagingIdentity: null,
        recoveryClaim: null,
      },
    ]);
    await storage.recordManagedCandidateKnowledgeWriteStagingIdentity(
      "owned-operation",
      { device: 11, inode: 22, createdAt: "2026-08-12T09:10:01.000Z" },
      7,
    );
    await expect(storage.listManagedCandidateKnowledgeWriteOperations()).resolves.toMatchObject([
      {
        operationId: "owned-operation",
        stagingIdentity: { device: 11, inode: 22, createdAt: "2026-08-12T09:10:01.000Z" },
      },
    ]);
    await expect(
      storage.recordManagedCandidateKnowledgeWriteStagingIdentity(
        "owned-operation",
        { device: 11, inode: 22, createdAt: "2026-08-12T09:10:02.000Z" },
        7,
      ),
    ).rejects.toThrow(/already recorded/i);
    await storage.terminalizePreparedManagedCandidateKnowledgeWrite(
      "owned-operation",
      "aborted",
      "owned-version",
      "2026-08-12T09:11:00.000Z",
      7,
    );
    await expect(storage.listManagedCandidateKnowledgeWriteOperations()).resolves.toMatchObject([
      { operationId: "owned-operation", latestPhase: "aborted", targetVersionId: "owned-version" },
    ]);
    await expect(
      storage.terminalizePreparedManagedCandidateKnowledgeWrite(
        "owned-operation",
        "aborted",
        "owned-version",
        "2026-08-12T09:12:00.000Z",
        6,
      ),
    ).resolves.toBeUndefined();
    await expect(
      storage.terminalizePreparedManagedCandidateKnowledgeWrite(
        "owned-operation",
        "completed",
        "owned-version",
        "2026-08-12T09:13:00.000Z",
        7,
      ),
    ).rejects.toThrow(/not committed/i);
    await storage.close();
  });

  it("rebinds only an existing managed file origin without moving time backward", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    const version = knowledgeSourceVersion();
    await storage.prepareManagedCandidateKnowledgeWrite({
      operationId: "rebind-create-operation",
      knowledgeBaseId: "ckb-1",
      sourceId: "ckb-source-1",
      requestedVersionId: version.id,
      kind: "create",
      createdAt: version.createdAt,
    });
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "rebind-create-operation",
      "targeted",
      version.id,
      version.createdAt,
    );
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "rebind-create-operation",
      "published",
      version.id,
      version.createdAt,
    );
    await storage.commitManagedCandidateKnowledgeWrite({
      kind: "create",
      operationId: "rebind-create-operation",
      source: knowledgeSource(),
      version,
      originPath: "/candidate.md",
    });

    await expect(
      storage.rebindCandidateKnowledgeSourceOrigin(
        "ckb-1",
        "ckb-source-1",
        "/candidate.md",
        "2026-08-12T08:00:00.000Z",
      ),
    ).resolves.toEqual({
      sourceId: "ckb-source-1",
      originPath: "/candidate.md",
      boundAt: version.createdAt,
    });
    await expect(
      storage.rebindCandidateKnowledgeSourceOrigin(
        "ckb-1",
        "ckb-source-1",
        "/replacement.md",
        version.createdAt,
      ),
    ).resolves.toEqual({
      sourceId: "ckb-source-1",
      originPath: "/replacement.md",
      boundAt: version.createdAt,
    });
    await expect(
      storage.rebindCandidateKnowledgeSourceOrigin(
        "ckb-1",
        "ckb-source-1",
        "/another.md",
        "2026-08-12T09:10:59.999Z",
      ),
    ).rejects.toThrow(/must not precede its current boundAt/i);
    await expect(
      storage.rebindCandidateKnowledgeSourceOrigin(
        "ckb-1",
        "ckb-source-1",
        "/replacement.md",
        "not-a-time",
      ),
    ).rejects.toThrow(StorageValidationError);
    await storage.close();
  });

  it("does not let a distinct prepared operation commit another operation's publication", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await storage.createCandidateKnowledgeSource(knowledgeSource(), knowledgeSourceVersion());
    await storage.prepareManagedCandidateKnowledgeWrite({
      operationId: "operation-a",
      knowledgeBaseId: "ckb-1",
      sourceId: "ckb-source-1",
      requestedVersionId: "journal-version-a",
      kind: "append",
      createdAt: "2026-08-12T09:12:00.000Z",
    });
    await storage.prepareManagedCandidateKnowledgeWrite({
      operationId: "operation-b",
      knowledgeBaseId: "ckb-1",
      sourceId: "ckb-source-1",
      requestedVersionId: "journal-version-b",
      kind: "append",
      createdAt: "2026-08-12T09:12:00.000Z",
    });
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "operation-a",
      "targeted",
      "journal-version-a",
      "2026-08-12T09:12:00.000Z",
    );
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "operation-a",
      "published",
      "journal-version-a",
      "2026-08-12T09:12:00.000Z",
    );

    await expect(
      storage.commitManagedCandidateKnowledgeWrite({
        kind: "append",
        operationId: "operation-b",
        version: knowledgeSourceVersion({
          id: "journal-version-b",
          checksum: "e".repeat(64),
          createdAt: "2026-08-12T09:12:00.000Z",
        }),
      }),
    ).rejects.toThrow(/prepared|published/i);
    await expect(
      storage.isCandidateKnowledgeSourceVersionManaged(
        "ckb-1",
        "ckb-source-1",
        "journal-version-b",
      ),
    ).resolves.toBe(false);
    await expect(
      storage.listCandidateKnowledgeSourceVersions("ckb-1", "ckb-source-1"),
    ).resolves.toHaveLength(1);
    await storage.close();
  });

  it("enforces candidate knowledge-source scope and active knowledge bases", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await storage.createCandidateKnowledgeBase(knowledgeBase({ id: "ckb-2", isDefault: false }));
    await storage.createCandidateKnowledgeSource(knowledgeSource(), knowledgeSourceVersion());
    const archivedSource = await storage.createCandidateKnowledgeSource(
      knowledgeSource({
        id: "ckb-source-2",
        knowledgeBaseId: "ckb-2",
        displayName: "Archived source",
      }),
      knowledgeSourceVersion({ id: "archived-source-version" }),
    );

    await expect(
      storage.getCandidateKnowledgeSource("ckb-2", "ckb-source-1"),
    ).resolves.toBeUndefined();
    await expect(
      storage.listCandidateKnowledgeSourceVersions("ckb-2", "ckb-source-1"),
    ).rejects.toThrow(/not found in candidate knowledge base ckb-2/i);
    await expect(
      storage.appendCandidateKnowledgeSourceVersion(
        "ckb-2",
        "ckb-source-1",
        knowledgeSourceVersion({ id: "cross-scope", checksum: "e".repeat(64) }),
      ),
    ).rejects.toThrow(/not found in candidate knowledge base ckb-2/i);

    await storage.archiveCandidateKnowledgeBase("ckb-2", "2026-08-12T09:20:00.000Z");
    await expect(storage.getCandidateKnowledgeSource("ckb-2", "ckb-source-2")).resolves.toEqual(
      archivedSource.source,
    );
    await expect(storage.listCandidateKnowledgeSources("ckb-2")).resolves.toEqual([
      archivedSource.source,
    ]);
    await expect(
      storage.listCandidateKnowledgeSourceVersions("ckb-2", "ckb-source-2"),
    ).resolves.toEqual([archivedSource.version]);
    await expect(
      storage.appendCandidateKnowledgeSourceVersion(
        "ckb-2",
        "ckb-source-2",
        knowledgeSourceVersion({
          id: "archived-append",
          checksum: "e".repeat(64),
          createdAt: "2026-08-12T09:21:00.000Z",
        }),
      ),
    ).rejects.toThrow(/archived/i);
    await expect(
      storage.createCandidateKnowledgeSource(
        knowledgeSource({ id: "archived-source", knowledgeBaseId: "ckb-2" }),
        knowledgeSourceVersion({ id: "archived-version" }),
      ),
    ).rejects.toThrow(/archived/i);
    await expect(
      storage.createCandidateKnowledgeSource(
        knowledgeSource({ id: "missing-source", knowledgeBaseId: "missing" }),
        knowledgeSourceVersion({ id: "missing-version" }),
      ),
    ).rejects.toThrow(/was not found/i);
    await storage.close();
  });

  it("validates source metadata and rolls back failed source-version appends", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await expect(
      storage.createCandidateKnowledgeSource(
        knowledgeSource({ kind: "other" as "file" }),
        knowledgeSourceVersion(),
      ),
    ).rejects.toThrow(/unsupported.*kind/i);
    await expect(
      storage.createCandidateKnowledgeSource(
        knowledgeSource({ displayName: " " }),
        knowledgeSourceVersion(),
      ),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.createCandidateKnowledgeSource(
        knowledgeSource(),
        knowledgeSourceVersion({ checksum: "A".repeat(64) }),
      ),
    ).rejects.toThrow(/lowercase SHA-256/i);
    await expect(
      storage.createCandidateKnowledgeSource(
        knowledgeSource(),
        knowledgeSourceVersion({ sizeBytes: 1.5 }),
      ),
    ).rejects.toThrow(/non-negative integer/i);
    await expect(
      storage.createCandidateKnowledgeSource(
        knowledgeSource(),
        knowledgeSourceVersion({ createdAt: "2026-08-12T09:09:00.000Z" }),
      ),
    ).rejects.toThrow(/must not precede its source createdAt/i);

    await storage.createCandidateKnowledgeSource(knowledgeSource(), knowledgeSourceVersion());
    await expect(
      storage.appendCandidateKnowledgeSourceVersion(
        "ckb-1",
        "ckb-source-1",
        knowledgeSourceVersion({
          id: "backdated-idempotent",
          createdAt: "2026-08-12T09:10:00.000Z",
        }),
      ),
    ).rejects.toThrow(/must not precede the current version createdAt/i);
    await expect(
      storage.appendCandidateKnowledgeSourceVersion(
        "ckb-1",
        "ckb-source-1",
        knowledgeSourceVersion({
          id: "backdated-version",
          checksum: "c".repeat(64),
          createdAt: "2026-08-12T09:10:00.000Z",
        }),
      ),
    ).rejects.toThrow(/must not precede the current version createdAt/i);
    await storage.createCandidateKnowledgeSource(
      knowledgeSource({ id: "ckb-source-2", displayName: "Second source" }),
      knowledgeSourceVersion({ id: "occupied-version-id", checksum: "e".repeat(64) }),
    );
    await expect(
      storage.createCandidateKnowledgeSource(
        knowledgeSource({ id: "rolled-back-source", displayName: "Rolled back source" }),
        knowledgeSourceVersion({ id: "occupied-version-id", checksum: "f".repeat(64) }),
      ),
    ).rejects.toThrow();
    await expect(
      storage.getCandidateKnowledgeSource("ckb-1", "rolled-back-source"),
    ).resolves.toBeUndefined();
    await expect(
      storage.appendCandidateKnowledgeSourceVersion(
        "ckb-1",
        "ckb-source-1",
        knowledgeSourceVersion({ id: "occupied-version-id", checksum: "f".repeat(64) }),
      ),
    ).rejects.toThrow();
    await expect(
      storage.listCandidateKnowledgeSourceVersions("ckb-1", "ckb-source-1"),
    ).resolves.toHaveLength(1);
    await storage.close();
  });

  it("enforces immutable source rows and version rows in SQLite", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-source-immutability-"));
    const filename = join(directory, "knowledge.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    const managed = await storage.createCandidateKnowledgeSource(
      knowledgeSource(),
      knowledgeSourceVersion(),
    );
    await storage.prepareManagedCandidateKnowledgeWrite({
      operationId: "immutability-materialization",
      knowledgeBaseId: "ckb-1",
      sourceId: managed.source.id,
      requestedVersionId: "immutability-request",
      kind: "append",
      createdAt: "2026-08-12T09:12:00.000Z",
    });
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "immutability-materialization",
      "targeted",
      managed.version.id,
      "2026-08-12T09:12:00.000Z",
    );
    await storage.recordManagedCandidateKnowledgeWriteEvent(
      "immutability-materialization",
      "published",
      managed.version.id,
      "2026-08-12T09:12:00.000Z",
    );
    await storage.commitManagedCandidateKnowledgeWrite({
      kind: "append",
      operationId: "immutability-materialization",
      version: knowledgeSourceVersion({
        id: "immutability-request",
        createdAt: "2026-08-12T09:12:00.000Z",
      }),
    });
    await storage.createCandidateKnowledgeSource(
      knowledgeSource({ id: "url-source", kind: "url", displayName: "URL source" }),
      knowledgeSourceVersion({ id: "url-version", checksum: "e".repeat(64) }),
    );
    await storage.close();

    const loaded = createRequire(import.meta.url)("better-sqlite3") as {
      readonly default?: unknown;
    };
    const Constructor = loaded.default ?? loaded;
    const database = new (Constructor as RawSqliteConstructor)(filename);
    expect(() =>
      database.exec(
        "UPDATE candidate_knowledge_sources SET display_name = 'changed' WHERE id = 'ckb-source-1'",
      ),
    ).toThrow(/immutable/i);
    expect(() =>
      database.exec(
        "DELETE FROM candidate_knowledge_source_versions WHERE id = 'ckb-source-version-1'",
      ),
    ).toThrow(/immutable/i);
    expect(() =>
      database.exec(
        "DELETE FROM candidate_knowledge_managed_source_versions WHERE version_id = 'ckb-source-version-1'",
      ),
    ).toThrow(/immutable/i);
    expect(() =>
      database.exec(
        "INSERT INTO candidate_knowledge_managed_source_versions(version_id) VALUES ('url-version')",
      ),
    ).not.toThrow();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("round-trips local records after close and reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-storage-"));
    const filename = join(directory, "workspace.sqlite");
    const first = openSqliteStorage(filename);

    const savedKnowledgeBase = await first.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    const archivedKnowledgeBase = await first.createCandidateKnowledgeBase(
      knowledgeBase({ id: "ckb-2", displayName: "Archived material", isDefault: false }),
    );
    await first.archiveCandidateKnowledgeBase(archivedKnowledgeBase.id, "2026-08-12T09:05:00.000Z");
    await first.saveWorkspace(workspace);
    const snapshot = await first.saveContextSnapshot(
      contextSnapshot({
        a: 1,
        b: "local-only",
      }),
    );
    await first.saveEvidenceSource(source);
    await first.saveEvidenceChunk(chunk("chunk-1", "Built local-first systems.", 0));
    const savedArtifact = await first.saveArtifactVersion(
      artifact({
        claims: [{ id: "claim-1", text: "Built local-first systems." }],
      }),
    );
    await first.saveRun(run(savedArtifact.id));
    await first.saveRunSnapshot({
      workspaceId: workspace.id,
      runId: "run-1",
      contextSnapshotId: "context-1",
      state: "drafting",
      round: 1,
      currentStep: "author",
      budget: { maxRounds: 3 },
      artifactId: savedArtifact.id,
      approval: "pending",
      totalCostUsd: 0.01,
      startedAt: "2026-08-12T10:10:00.000Z",
      updatedAt: "2026-08-12T10:10:01.000Z",
      lastError: null,
      payload: { state: "drafting" },
    });
    await first.saveRound(round());
    await first.saveExecution(execution());
    await first.saveFinding(finding());
    await first.saveDecision(decision());
    await first.saveExport(exportRecord());
    await first.close();

    const second = openSqliteStorage(filename);
    await expect(second.getCandidateKnowledgeBase(savedKnowledgeBase.id)).resolves.toEqual(
      savedKnowledgeBase,
    );
    await expect(second.getCandidateKnowledgeBase(archivedKnowledgeBase.id)).resolves.toMatchObject(
      {
        state: "archived",
        archivedAt: "2026-08-12T09:05:00.000Z",
      },
    );
    await expect(second.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    await expect(second.getContextSnapshot(snapshot.id)).resolves.toEqual(snapshot);
    await expect(second.getEvidenceSource(source.id)).resolves.toEqual(source);
    await expect(second.getArtifactVersion(savedArtifact.id)).resolves.toEqual(savedArtifact);
    await expect(second.getRun("run-1")).resolves.toMatchObject(run(savedArtifact.id));
    await expect(second.getLatestRunSnapshot("run-1")).resolves.toMatchObject({
      runId: "run-1",
      state: "drafting",
      payload: { state: "drafting" },
    });
    await expect(second.listRunSnapshots("run-1")).resolves.toHaveLength(1);
    await expect(second.listRounds("run-1")).resolves.toHaveLength(1);
    await expect(second.getExecution("execution-1")).resolves.toMatchObject(execution());
    await expect(second.listFindings("run-1")).resolves.toHaveLength(1);
    await expect(second.listDecisions("run-1")).resolves.toHaveLength(1);
    await expect(second.listExports("run-1")).resolves.toHaveLength(1);
    await expect(second.searchEvidence("local-first")).resolves.toMatchObject([
      { id: "chunk-1", sourceId: "source-1", text: "Built local-first systems." },
    ]);
    await second.close();

    await expect(readFile(filename)).resolves.toBeInstanceOf(Buffer);
    await rm(directory, { recursive: true, force: true });
  });

  it("allows independent artifact lineages to start at version one", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-artifact-lineages-"));
    const filename = join(directory, "workspace.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.saveWorkspace(workspace);

    const firstInput = artifact({ value: "first-lineage" });
    const secondInput = artifact({ value: "second-lineage" }, { id: "artifact-2" });
    const first = await storage.saveArtifactVersion(firstInput);
    const second = await storage.saveArtifactVersion(secondInput);

    expect(first.version).toBe(1);
    expect(second.version).toBe(1);
    expect(second.id).not.toBe(first.id);
    await expect(storage.saveArtifactVersion(firstInput)).resolves.toEqual(first);
    await expect(
      storage.saveArtifactVersion({ ...firstInput, payload: { value: "changed" } }),
    ).rejects.toThrow(StorageConflictError);
    await expect(
      storage.saveArtifactVersion({
        ...firstInput,
        createdAt: "2026-08-12T10:05:00.000Z",
      }),
    ).rejects.toThrow(StorageConflictError);
    await storage.close();

    const reopened = openSqliteStorage(filename);
    await expect(reopened.getArtifactVersion(first.id)).resolves.toEqual(first);
    await expect(reopened.getArtifactVersion(second.id)).resolves.toEqual(second);
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps run history idempotent and rejects conflicting immutable records", async () => {
    const storage = openSqliteStorage(":memory:");
    await seedHistory(storage);

    await expect(storage.saveRun(run())).resolves.toMatchObject(run());
    await expect(storage.saveRound(round())).resolves.toMatchObject(round());
    await expect(storage.saveExecution(execution())).resolves.toMatchObject(execution());
    await expect(storage.saveFinding(finding())).resolves.toMatchObject(finding());
    await expect(storage.saveDecision(decision())).resolves.toMatchObject(decision());
    await expect(storage.saveExport(exportRecord())).resolves.toMatchObject(exportRecord());

    await expect(storage.saveRun({ ...run(), state: "reviewing" })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveRound({ ...round(), state: "reviewing" })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveExecution({ ...execution(), attempt: 2 })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveFinding({ ...finding(), message: "changed" })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveDecision({ ...decision(), rationale: "changed" })).rejects.toThrow(
      StorageConflictError,
    );
    await expect(storage.saveExport({ ...exportRecord(), status: "failed" })).rejects.toThrow(
      StorageConflictError,
    );
    await storage.close();
  });

  it("appends distinct lifecycle snapshots and returns the latest projection", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.saveWorkspace(workspace);
    await storage.saveContextSnapshot(contextSnapshot({ fixture: true }));

    const base = {
      workspaceId: workspace.id,
      runId: "run-1",
      contextSnapshotId: "context-1",
      round: 1,
      currentStep: "author" as const,
      budget: { maxRounds: 3 },
      artifactId: null,
      approval: "pending" as const,
      totalCostUsd: 0,
      startedAt: "2026-08-12T10:10:00.000Z",
      lastError: null,
    };

    const first = await storage.saveRunSnapshot({
      ...base,
      state: "drafting",
      updatedAt: "2026-08-12T10:10:01.000Z",
      payload: { state: "drafting" },
    });
    const duplicate = await storage.saveRunSnapshot({
      ...base,
      state: "drafting",
      updatedAt: "2026-08-12T10:10:01.000Z",
      payload: { state: "drafting" },
    });
    const second = await storage.saveRunSnapshot({
      ...base,
      state: "paused",
      currentStep: null,
      updatedAt: "2026-08-12T10:10:02.000Z",
      payload: { state: "paused" },
    });

    expect(duplicate).toEqual(first);
    expect(second.sequence).toBeGreaterThan(first.sequence);
    await expect(storage.getLatestRunSnapshot("run-1")).resolves.toEqual(second);
    await expect(storage.listRunSnapshots("run-1")).resolves.toHaveLength(2);
    await storage.close();
  });

  it("enforces relational ownership and rejects sensitive structured payloads", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.saveWorkspace(workspace);
    await expect(storage.saveRun(run())).rejects.toThrow();
    await storage.saveContextSnapshot(contextSnapshot({ fixture: true }));
    await expect(storage.saveRound(round())).rejects.toThrow();
    await storage.saveRun(run(null));
    await expect(storage.saveExecution(execution())).rejects.toThrow();

    await storage.saveRound(round());
    await expect(
      storage.saveExecution({ ...execution(), output: { apiKey: "never-persisted" } }),
    ).rejects.toThrow(StorageSecurityError);
    await expect(
      storage.saveExecution({ ...execution(), output: { prompt: "raw prompt" } }),
    ).rejects.toThrow(StorageSecurityError);
    await expect(
      storage.saveFinding({ ...finding(), payload: { providerToken: "never-persisted" } }),
    ).rejects.toThrow(StorageSecurityError);
    await storage.close();
  });

  it("keeps immutable records idempotent and rejects changed payloads", async () => {
    const storage = openSqliteStorage(":memory:");
    await storage.saveWorkspace(workspace);
    await expect(storage.planRetention("not-a-timestamp")).rejects.toThrow();
    await expect(storage.planRetention("2026-08-12T10:05:30.000Z")).resolves.toMatchObject({
      immutableBusinessRecords: true,
    });

    const first = await storage.saveContextSnapshot(contextSnapshot({ b: 2, a: 1 }));
    const equivalent = await storage.saveContextSnapshot(contextSnapshot({ a: 1, b: 2 }));
    expect(equivalent).toEqual(first);
    await expect(storage.saveContextSnapshot(contextSnapshot({ a: 3 }))).rejects.toThrow(
      StorageConflictError,
    );

    await expect(
      storage.saveArtifactVersion({
        ...artifact({ value: "child" }),
        id: "artifact-child",
        version: 2,
        parentVersionId: "missing-parent",
      }),
    ).rejects.toThrow();
    await storage.close();
  });

  it("requires workspace and source foreign keys and indexes evidence safely", async () => {
    const storage = openSqliteStorage(":memory:");
    await expect(storage.saveContextSnapshot(contextSnapshot({ value: true }))).rejects.toThrow();
    await storage.saveWorkspace(workspace);
    await expect(storage.saveEvidenceChunk(chunk("orphan", "orphan", 0))).rejects.toThrow();

    await storage.saveEvidenceSource(source);
    await storage.saveEvidenceChunk(chunk("chunk-1", "TypeScript platform engineer.", 0));
    await storage.saveEvidenceChunk(chunk("chunk-2", "Local persistence and testing.", 1));

    const results = await storage.searchEvidence("platform", 1);
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe("chunk-1");
    await expect(storage.searchEvidence("' OR 1=1")).resolves.toEqual([]);
    await expect(storage.searchEvidence("platform", 0)).rejects.toThrow();
    await storage.close();
  });

  it("chains audit events and creates a reopenable backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-backup-"));
    const filename = join(directory, "workspace.sqlite");
    const backupFilename = join(directory, "workspace-backup.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.saveWorkspace(workspace);
    const first = await storage.appendAuditEvent({
      id: "event-1",
      workspaceId: workspace.id,
      eventType: "test.first",
      entityType: "test",
      entityId: "one",
      payload: { value: 1 },
      createdAt: "2026-08-12T10:05:00.000Z",
    });
    await expect(
      storage.appendAuditEvent({
        id: "event-1",
        workspaceId: workspace.id,
        eventType: "test.first",
        entityType: "test",
        entityId: "one",
        payload: { value: 1 },
        createdAt: "2026-08-12T10:05:00.000Z",
      }),
    ).resolves.toEqual(first);
    await expect(
      storage.appendAuditEvent({
        id: "event-1",
        workspaceId: workspace.id,
        eventType: "test.first",
        entityType: "test",
        entityId: "one",
        payload: { value: 9 },
        createdAt: "2026-08-12T10:05:00.000Z",
      }),
    ).rejects.toThrow(StorageConflictError);
    const second = await storage.appendAuditEvent({
      id: "event-2",
      workspaceId: workspace.id,
      eventType: "test.second",
      entityType: "test",
      entityId: "two",
      payload: { value: 2 },
      createdAt: "2026-08-12T10:06:00.000Z",
    });

    expect(first.previousEventChecksum).not.toBeNull();
    expect(second.previousEventChecksum).toBe(first.eventChecksum);
    expect((await storage.listAuditEvents(workspace.id)).at(-1)?.eventChecksum).toBe(
      second.eventChecksum,
    );
    await storage.backup(backupFilename);
    await storage.close();

    const backup = openSqliteStorage(backupFilename);
    await expect(backup.getWorkspace(workspace.id)).resolves.toEqual(workspace);
    await expect(backup.listAuditEvents(workspace.id)).resolves.toHaveLength(3);
    await backup.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("backs up and restores canonical profile history and approved exports with the workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-profile-backup-"));
    const filename = join(directory, "workspace.sqlite");
    const backupFilename = join(directory, "workspace-backup.sqlite");
    const restoredFilename = join(directory, "workspace-restored.sqlite");
    const storage = openSqliteStorage(filename);
    await seedHistory(storage);
    const profileOne = await storage.saveCanonicalCandidateProfile(
      workspace.id,
      canonicalCandidateProfile({ id: "profile-backup" }),
    );
    const profileTwo = await storage.saveCanonicalCandidateProfile(
      workspace.id,
      canonicalCandidateProfile({
        id: "profile-backup",
        version: 2,
        parentVersion: 1,
        createdAt: "2026-08-12T10:01:00.000Z",
        updatedAt: "2026-08-12T10:01:00.000Z",
      }),
    );
    const exports = await storage.listExports("run-1");

    await storage.createBackup(backupFilename);
    await storage.close();

    const restored = await SqliteStorage.restore(backupFilename, restoredFilename);
    await expect(
      restored.listCanonicalCandidateProfileVersions(workspace.id, "profile-backup"),
    ).resolves.toEqual([profileOne, profileTwo]);
    await expect(restored.listExports("run-1")).resolves.toEqual(exports);
    await restored.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps canonical profile history and approved exports outside retention purge", async () => {
    const storage = openSqliteStorage(":memory:");
    await seedHistory(storage);
    const profileOne = await storage.saveCanonicalCandidateProfile(
      workspace.id,
      canonicalCandidateProfile({ id: "profile-retention" }),
    );
    const profileTwo = await storage.saveCanonicalCandidateProfile(
      workspace.id,
      canonicalCandidateProfile({
        id: "profile-retention",
        version: 2,
        parentVersion: 1,
        createdAt: "2026-08-12T10:01:00.000Z",
        updatedAt: "2026-08-12T10:01:00.000Z",
      }),
    );
    const exports = await storage.listExports("run-1");

    await expect(
      storage.purgeRetention("2026-08-13T00:00:00.000Z", { confirmed: true }),
    ).resolves.toMatchObject({ deletedAuditEventsCount: expect.any(Number) });
    await expect(
      storage.listCanonicalCandidateProfileVersions(workspace.id, "profile-retention"),
    ).resolves.toEqual([profileOne, profileTwo]);
    await expect(storage.listExports("run-1")).resolves.toEqual(exports);
    await storage.close();
  });

  it("persists the per-candidate retention policy and overrides", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-retention-policy-"));
    const filename = join(directory, "knowledge.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());

    const initial = await storage.getCandidateKnowledgeRetentionPolicy("ckb-1");
    expect(initial.revision).toBe(0);
    expect(initial.classes.map((entry) => entry.class)).toEqual(candidateKnowledgeRetentionClasses);
    expect(initial.classes.every((entry) => entry.rule === "retain-until-deletion")).toBe(true);
    const invalidBase = initial.classes.map((entry) => ({ ...entry }));
    await expect(
      storage.setCandidateKnowledgeRetentionPolicy("ckb-1", {
        expectedRevision: 0,
        updatedAt: "2099-01-01T00:00:00.000Z",
        classes: invalidBase,
      }),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.applyCandidateKnowledgeRetentionOverride("ckb-1", {
        class: "raw-sources",
        kind: "legal-hold",
        expectedPolicyRevision: 0,
        expectedState: "none",
        changedAt: "2099-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.getCandidateKnowledgeRetentionPolicyAtAsOf("ckb-1", "2099-01-01T00:00:00.000Z"),
    ).rejects.toThrow(StorageValidationError);
    const firstPolicy = invalidBase[0];
    if (firstPolicy === undefined) throw new Error("retention policy fixture is empty");
    await expect(
      storage.setCandidateKnowledgeRetentionPolicy("ckb-1", {
        expectedRevision: 0,
        updatedAt: "2026-08-12T10:00:00.000Z",
        classes: invalidBase.slice(0, -1),
      }),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.setCandidateKnowledgeRetentionPolicy("ckb-1", {
        expectedRevision: 0,
        updatedAt: "2026-08-12T10:00:00.000Z",
        classes: [
          ...invalidBase.slice(0, -1),
          { ...firstPolicy, class: candidateKnowledgeRetentionClasses[1] },
        ],
      }),
    ).rejects.toThrow(StorageValidationError);
    await expect(
      storage.setCandidateKnowledgeRetentionPolicy("ckb-1", {
        expectedRevision: 0,
        updatedAt: "2026-08-12T10:00:00.000Z",
        classes: invalidBase.map((entry, index) =>
          index === 0 ? { ...entry, rule: "expire-after-days", expireAfterDays: null } : entry,
        ),
      }),
    ).rejects.toThrow(StorageValidationError);
    expect((await storage.getCandidateKnowledgeRetentionPolicy("ckb-1")).revision).toBe(0);

    const updated = await storage.setCandidateKnowledgeRetentionPolicy("ckb-1", {
      expectedRevision: 0,
      updatedAt: "2026-08-12T10:01:00.000Z",
      classes: invalidBase.map((entry, index) =>
        index === 0 ? { ...entry, rule: "expire-after-days", expireAfterDays: 30 } : entry,
      ),
    });
    expect(updated.revision).toBe(1);
    expect(updated.classes[0]).toMatchObject({
      class: "raw-sources",
      rule: "expire-after-days",
      expireAfterDays: 30,
    });
    await expect(
      storage.setCandidateKnowledgeRetentionPolicy("ckb-1", {
        expectedRevision: 0,
        updatedAt: "2026-08-12T10:02:00.000Z",
        classes: invalidBase,
      }),
    ).rejects.toThrow(StorageConflictError);

    const held = await storage.applyCandidateKnowledgeRetentionOverride("ckb-1", {
      class: "raw-sources",
      kind: "legal-hold",
      expectedPolicyRevision: 1,
      expectedState: "none",
      changedAt: "2026-08-12T10:02:00.000Z",
    });
    expect(held.activeOverrides).toHaveLength(1);
    await expect(
      storage.applyCandidateKnowledgeRetentionOverride("ckb-1", {
        class: "raw-sources",
        kind: "legal-hold",
        expectedPolicyRevision: 1,
        expectedState: "none",
        changedAt: "2026-08-12T10:03:00.000Z",
      }),
    ).rejects.toThrow(StorageConflictError);
    const released = await storage.releaseCandidateKnowledgeRetentionOverride("ckb-1", {
      class: "raw-sources",
      kind: "legal-hold",
      expectedPolicyRevision: 1,
      expectedState: "applied",
      changedAt: "2026-08-12T10:03:00.000Z",
    });
    expect(released.activeOverrides).toEqual([]);

    storage.validateCandidateKnowledgeRetentionContract();
    await storage.close();

    const reopened = openSqliteStorage(filename);
    expect(await reopened.getCandidateKnowledgeRetentionPolicy("ckb-1")).toEqual(released);
    reopened.validateCandidateKnowledgeRetentionContract();
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("migrates a populated v17 candidate store to the legacy-safe retention default", async () => {
    const directory = await mkdtemp(join(tmpdir(), "draft-loop-retention-v17-"));
    const filename = join(directory, "knowledge.sqlite");
    const storage = openSqliteStorage(filename);
    await storage.ensureDefaultCandidateKnowledgeBase(knowledgeBase());
    await storage.createCandidateKnowledgeSource(knowledgeSource(), knowledgeSourceVersion());
    await storage.close();

    const legacy = openRawDatabase(filename);
    legacy.exec(
      "DROP TABLE candidate_knowledge_retention_override_events; DROP TABLE candidate_knowledge_retention_policy_events; DELETE FROM schema_migrations WHERE version = 18;",
    );
    legacy.close();

    const migrated = openSqliteStorage(filename);
    const policy = await migrated.getCandidateKnowledgeRetentionPolicy("ckb-1");
    expect(policy.revision).toBe(0);
    expect(policy.classes.every((entry) => entry.rule === "retain-until-deletion")).toBe(true);
    expect(
      queryRawDatabase(
        filename,
        "SELECT (SELECT COUNT(*) FROM candidate_knowledge_retention_policy_events) AS policies, (SELECT COUNT(*) FROM candidate_knowledge_retention_override_events) AS overrides",
      ),
    ).toEqual([{ policies: 0, overrides: 0 }]);
    expect(
      queryRawDatabase(
        filename,
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'candidate_knowledge_retention_plan_events'",
      ),
    ).toEqual([]);
    migrated.validateCandidateKnowledgeRetentionContract();
    await migrated.close();
    await rm(directory, { recursive: true, force: true });
  });
});
