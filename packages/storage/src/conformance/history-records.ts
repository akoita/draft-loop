import { createHash } from "node:crypto";
import {
  type CanonicalCandidateProfile,
  type CanonicalCandidateProfileInput,
  canonicalCandidateProfileSchema,
  type OpportunityBrief,
  type WritingPolicyInput,
} from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import { auditEventChecksum } from "../audit-event-write.js";
import type {
  ArtifactHistoryStoragePort,
  AuditTrailStoragePort,
  DecisionRecordInput,
  ExecutionRecordInput,
  ExportRecordInput,
  FindingRecordInput,
  HistoryStoragePort,
  RoundRecordInput,
  RunRecordInput,
  RunSnapshotRecordInput,
} from "../ports/history.js";
import type {
  CanonicalCandidateProfileStoragePort,
  ContextSnapshotStoragePort,
  OpportunityBriefStoragePort,
  WritingPolicyStoragePort,
} from "../ports/versioned-records.js";
import type { WorkspaceRecord, WorkspaceStoragePort } from "../ports/workspace.js";
import { StorageConflictError, StorageValidationError } from "../storage-errors.js";

/** The port surface the history and versioned-record contracts exercise. */
export type HistoryRecordsStorage = WorkspaceStoragePort &
  ContextSnapshotStoragePort &
  ArtifactHistoryStoragePort &
  HistoryStoragePort &
  AuditTrailStoragePort &
  OpportunityBriefStoragePort &
  CanonicalCandidateProfileStoragePort &
  WritingPolicyStoragePort;

/** An empty store for one contract, and how to release it afterwards. */
export interface OpenedHistoryRecordsStorage {
  readonly storage: HistoryRecordsStorage;
  readonly close: () => Promise<void>;
}

export type HistoryRecordsStorageFactory = () => Promise<OpenedHistoryRecordsStorage>;

/** One behaviour every implementation must honour, checked against an empty store. */
export interface StorageContract {
  readonly name: string;
  readonly check: (storage: HistoryRecordsStorage) => Promise<void>;
}

const sha256Pattern = /^[a-f0-9]{64}$/u;

const workspace: WorkspaceRecord = {
  id: "conformance-workspace",
  state: "collecting",
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T10:00:00.000Z",
};
const otherWorkspace: WorkspaceRecord = { ...workspace, id: "conformance-workspace-other" };

const artifactVersion = {
  id: "artifact-1",
  workspaceId: workspace.id,
  version: 1,
  parentVersionId: null,
  createdAt: "2026-08-12T10:04:00.000Z",
  payload: { sections: ["Summary"] },
} as const;

const run = (overrides: Partial<RunRecordInput> = {}): RunRecordInput => ({
  id: "run-1",
  workspaceId: workspace.id,
  contextSnapshotId: "context-1",
  state: "drafting",
  round: 1,
  currentStep: "author",
  budget: { maxRounds: 3, maxCostUsd: 1 },
  artifactId: "artifact-1",
  approval: "pending",
  totalCostUsd: 0.01,
  startedAt: "2026-08-12T10:10:00.000Z",
  updatedAt: "2026-08-12T10:10:01.000Z",
  lastError: null,
  payload: { stateReason: "fixture" },
  ...overrides,
});

const runSnapshot = (overrides: Partial<RunSnapshotRecordInput> = {}): RunSnapshotRecordInput => {
  const { id: _id, ...input } = run();
  return { ...input, runId: "run-1", ...overrides };
};

const round = (overrides: Partial<RoundRecordInput> = {}): RoundRecordInput => ({
  id: "round-1",
  workspaceId: workspace.id,
  runId: "run-1",
  number: 1,
  state: "drafting",
  startedAt: "2026-08-12T10:10:00.000Z",
  completedAt: null,
  evaluation: null,
  payload: { source: "fixture" },
  ...overrides,
});

const execution = (overrides: Partial<ExecutionRecordInput> = {}): ExecutionRecordInput => ({
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
  ...overrides,
});

const finding = (overrides: Partial<FindingRecordInput> = {}): FindingRecordInput => ({
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
  ...overrides,
});

const decision = (overrides: Partial<DecisionRecordInput> = {}): DecisionRecordInput => ({
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
  ...overrides,
});

const exportRecord = (overrides: Partial<ExportRecordInput> = {}): ExportRecordInput => ({
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
  ...overrides,
});

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
        originalUrl: "https://example.com/role",
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

const canonicalProfile = (
  overrides: Partial<CanonicalCandidateProfileInput> = {},
): CanonicalCandidateProfile =>
  canonicalCandidateProfileSchema.parse({
    id: "profile-1",
    version: 1,
    parentVersion: null,
    status: "draft",
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:00.000Z",
    candidateKnowledgeSelection: {
      capturedAt: "2026-08-12T09:00:00.000Z",
      entries: [
        {
          storeId: "store-1",
          knowledgeBaseId: "knowledge-1",
          sources: [
            {
              sourceId: "source-1",
              versionId: "version-1",
              lifecycleRevision: {
                knowledgeBaseState: "active",
                knowledgeBaseArchivedAt: null,
                versionId: "version-1",
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
            storeId: "store-1",
            knowledgeBaseId: "knowledge-1",
            sourceId: "source-1",
            versionId: "version-1",
            kind: "candidate-provided",
          },
        ],
      },
    ],
    issues: [],
    ...overrides,
  });

const writingPolicy = (content: string, version: string): WritingPolicyInput => ({
  content,
  checksum: createHash("sha256").update(content, "utf8").digest("hex"),
  version,
});

/** Saves one record of every history kind for `run-1` in the conformance workspace. */
async function seedHistory(storage: HistoryRecordsStorage): Promise<void> {
  await storage.saveWorkspace(workspace);
  await storage.saveContextSnapshot({
    id: "context-1",
    workspaceId: workspace.id,
    schemaVersion: 1,
    createdAt: "2026-08-12T10:01:00.000Z",
    payload: { job: "fixture" },
  });
  await storage.saveArtifactVersion(artifactVersion);
  await storage.saveRun(run());
  await storage.saveRound(round());
  await storage.saveExecution(execution());
  await storage.saveFinding(finding());
  await storage.saveDecision(decision());
  await storage.saveExport(exportRecord());
}

/**
 * The contract of one append-only child record kind: saved records read back
 * unchanged, identical re-saves are no-ops, changed re-saves conflict, and the
 * run's list holds only that run's records in the documented order.
 */
interface ChildRecordKind<Input extends { readonly id: string; readonly runId: string }> {
  readonly label: string;
  readonly make: (overrides: Partial<Input>) => Input;
  readonly change: Partial<Input>;
  /** Overrides for a second record of the same run: its id sorts first, its order key later. */
  readonly later: Partial<Input>;
  readonly save: (storage: HistoryRecordsStorage, input: Input) => Promise<unknown>;
  readonly get: (storage: HistoryRecordsStorage, id: string) => Promise<unknown>;
  readonly list: (storage: HistoryRecordsStorage, runId: string) => Promise<readonly unknown[]>;
}

function childRecordContracts<Input extends { readonly id: string; readonly runId: string }>(
  kind: ChildRecordKind<Input>,
): readonly StorageContract[] {
  return [
    {
      name: `${kind.label}: reads a saved record back with a content checksum`,
      check: async (storage) => {
        await seedHistory(storage);
        const input = kind.make({});
        const saved = await kind.get(storage, input.id);
        expect(saved).toEqual({ ...input, checksum: expect.stringMatching(sha256Pattern) });
        await expect(kind.get(storage, `${input.id}-missing`)).resolves.toBeUndefined();
      },
    },
    {
      name: `${kind.label}: treats an identical re-save as a no-op`,
      check: async (storage) => {
        await seedHistory(storage);
        const input = kind.make({});
        const before = await kind.get(storage, input.id);
        await expect(kind.save(storage, input)).resolves.toEqual(before);
        await expect(kind.list(storage, input.runId)).resolves.toHaveLength(1);
      },
    },
    {
      name: `${kind.label}: rejects a changed record under an existing id`,
      check: async (storage) => {
        await seedHistory(storage);
        const input = kind.make({});
        const before = await kind.get(storage, input.id);
        await expect(kind.save(storage, kind.make(kind.change))).rejects.toBeInstanceOf(
          StorageConflictError,
        );
        await expect(kind.get(storage, input.id)).resolves.toEqual(before);
      },
    },
    {
      name: `${kind.label}: lists only the run's records, in order`,
      check: async (storage) => {
        await seedHistory(storage);
        await storage.saveRun(run({ id: "run-2" }));
        const seeded = kind.make({});
        // Saved in reverse, with ids that sort against the order key, so only
        // the documented order can produce the expected list.
        const first = kind.make({ id: `${seeded.id}-z`, runId: "run-2" } as Partial<Input>);
        const later = kind.make({ ...kind.later, runId: "run-2" } as Partial<Input>);
        await kind.save(storage, later);
        await kind.save(storage, first);
        const listed = (await kind.list(storage, "run-2")) as readonly { id: string }[];
        expect(listed.map((record) => record.id)).toEqual([first.id, later.id]);
        const own = (await kind.list(storage, seeded.runId)) as readonly { id: string }[];
        expect(own.map((record) => record.id)).toEqual([seeded.id]);
      },
    },
  ];
}

const runContracts: readonly StorageContract[] = [
  {
    name: "runs: read a saved run back with a content checksum",
    check: async (storage) => {
      await seedHistory(storage);
      await expect(storage.getRun("run-1")).resolves.toEqual({
        ...run(),
        checksum: expect.stringMatching(sha256Pattern),
      });
      await expect(storage.getRun("run-missing")).resolves.toBeUndefined();
    },
  },
  {
    name: "runs: treat an identical re-save as a no-op",
    check: async (storage) => {
      await seedHistory(storage);
      const before = await storage.getRun("run-1");
      await expect(storage.saveRun(run())).resolves.toEqual(before);
      await expect(storage.listRuns(workspace.id)).resolves.toEqual([before]);
    },
  },
  {
    name: "runs: reject a changed run under an existing id",
    check: async (storage) => {
      await seedHistory(storage);
      const before = await storage.getRun("run-1");
      await expect(storage.saveRun(run({ totalCostUsd: 0.5 }))).rejects.toBeInstanceOf(
        StorageConflictError,
      );
      await expect(storage.getRun("run-1")).resolves.toEqual(before);
    },
  },
  {
    name: "runs: list only the workspace's runs, by update time then id",
    check: async (storage) => {
      await seedHistory(storage);
      await storage.saveWorkspace(otherWorkspace);
      await storage.saveRun(run({ id: "run-b", updatedAt: "2026-08-12T10:09:00.000Z" }));
      await storage.saveRun(run({ id: "run-a", updatedAt: "2026-08-12T10:09:00.000Z" }));
      await storage.saveRun(run({ id: "run-other", workspaceId: otherWorkspace.id }));
      const listed = await storage.listRuns(workspace.id);
      expect(listed.map((record) => record.id)).toEqual(["run-a", "run-b", "run-1"]);
      const other = await storage.listRuns(otherWorkspace.id);
      expect(other.map((record) => record.id)).toEqual(["run-other"]);
    },
  },
];

const runSnapshotContracts: readonly StorageContract[] = [
  {
    name: "run snapshots: append in order and return the latest",
    check: async (storage) => {
      await seedHistory(storage);
      await expect(storage.getLatestRunSnapshot("run-1")).resolves.toBeUndefined();
      const first = await storage.saveRunSnapshot(runSnapshot());
      const second = await storage.saveRunSnapshot(
        runSnapshot({
          state: "reviewing",
          currentStep: "critic",
          updatedAt: "2026-08-12T10:11:00.000Z",
        }),
      );
      expect(first).toMatchObject({
        ...runSnapshot(),
        checksum: expect.stringMatching(sha256Pattern),
      });
      expect(second.sequence).toBeGreaterThan(first.sequence);
      expect(second.id).not.toBe(first.id);
      await expect(storage.getLatestRunSnapshot("run-1")).resolves.toEqual(second);
      await expect(storage.listRunSnapshots("run-1")).resolves.toEqual([first, second]);
    },
  },
  {
    name: "run snapshots: an identical snapshot is stored once",
    check: async (storage) => {
      await seedHistory(storage);
      const first = await storage.saveRunSnapshot(runSnapshot());
      await expect(storage.saveRunSnapshot(runSnapshot())).resolves.toEqual(first);
      await expect(storage.listRunSnapshots("run-1")).resolves.toEqual([first]);
    },
  },
  {
    name: "run snapshots: lists only the run's snapshots",
    check: async (storage) => {
      await seedHistory(storage);
      await storage.saveRun(run({ id: "run-2" }));
      await storage.saveRunSnapshot(runSnapshot({ runId: "run-2" }));
      const own = await storage.saveRunSnapshot(runSnapshot());
      await expect(storage.listRunSnapshots("run-1")).resolves.toEqual([own]);
      await expect(storage.listRunSnapshots("run-missing")).resolves.toEqual([]);
    },
  },
];

const childContracts: readonly StorageContract[] = [
  ...childRecordContracts<RoundRecordInput>({
    label: "rounds",
    make: round,
    change: { state: "reviewing" },
    later: { id: "round-0", number: 2 },
    save: (storage, input) => storage.saveRound(input),
    get: (storage, id) => storage.getRound(id),
    list: (storage, runId) => storage.listRounds(runId),
  }),
  ...childRecordContracts<ExecutionRecordInput>({
    label: "executions",
    make: execution,
    change: { outputTokens: 21 },
    later: { id: "execution-0", attempt: 2, startedAt: "2026-08-12T10:10:04.000Z" },
    save: (storage, input) => storage.saveExecution(input),
    get: (storage, id) => storage.getExecution(id),
    list: (storage, runId) => storage.listExecutions(runId),
  }),
  ...childRecordContracts<FindingRecordInput>({
    label: "findings",
    make: finding,
    change: { message: "A changed message." },
    later: { id: "finding-0", createdAt: "2026-08-12T10:10:04.500Z" },
    save: (storage, input) => storage.saveFinding(input),
    get: (storage, id) => storage.getFinding(id),
    list: (storage, runId) => storage.listFindings(runId),
  }),
  ...childRecordContracts<DecisionRecordInput>({
    label: "decisions",
    make: decision,
    change: { rationale: "A changed rationale." },
    later: { id: "decision-0", createdAt: "2026-08-12T10:10:05.500Z" },
    save: (storage, input) => storage.saveDecision(input),
    get: (storage, id) => storage.getDecision(id),
    list: (storage, runId) => storage.listDecisions(runId),
  }),
  ...childRecordContracts<ExportRecordInput>({
    label: "exports",
    make: exportRecord,
    change: { status: "failed" },
    later: { id: "export-0", createdAt: "2026-08-12T10:10:06.500Z" },
    save: (storage, input) => storage.saveExport(input),
    get: (storage, id) => storage.getExport(id),
    list: (storage, runId) => storage.listExports(runId),
  }),
];

const auditContracts: readonly StorageContract[] = [
  {
    name: "audit: history writes extend a per-workspace hash chain that verifies",
    check: async (storage) => {
      await seedHistory(storage);
      await storage.saveRunSnapshot(runSnapshot());
      const events = await storage.listAuditEvents(workspace.id);
      expect(events.length).toBeGreaterThan(0);
      let previous: string | null = null;
      let sequence = Number.NEGATIVE_INFINITY;
      for (const event of events) {
        expect(event.workspaceId).toBe(workspace.id);
        expect(event.sequence).toBeGreaterThan(sequence);
        expect(event.payloadChecksum).toMatch(sha256Pattern);
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
        sequence = event.sequence;
      }
      await expect(storage.auditEvents.verifyAuditChain(workspace.id)).resolves.toMatchObject({
        ok: true,
        eventCount: events.length,
        problems: [],
      });
    },
  },
  {
    name: "audit: an appended event joins its workspace's chain only",
    check: async (storage) => {
      await seedHistory(storage);
      await storage.saveWorkspace(otherWorkspace);
      const before = await storage.listAuditEvents(workspace.id);
      const otherBefore = await storage.listAuditEvents(otherWorkspace.id);
      const input = {
        id: "conformance-event-1",
        workspaceId: workspace.id,
        eventType: "conformance.checked",
        entityType: "conformance",
        entityId: "entity-1",
        payload: { checked: true },
        createdAt: "2026-08-12T10:20:00.000Z",
      };
      const appended = await storage.appendAuditEvent(input);
      expect(appended).toMatchObject(input);
      expect(appended.previousEventChecksum).toBe(before.at(-1)?.eventChecksum ?? null);
      await expect(storage.appendAuditEvent(input)).resolves.toEqual(appended);
      await expect(storage.listAuditEvents(workspace.id)).resolves.toEqual([...before, appended]);
      await expect(storage.listAuditEvents(otherWorkspace.id)).resolves.toEqual(otherBefore);
      await expect(
        storage.appendAuditEvent({ ...input, payload: { checked: false } }),
      ).rejects.toBeInstanceOf(StorageConflictError);
    },
  },
];

const artifactContracts: readonly StorageContract[] = [
  {
    name: "artifact versions: are immutable once saved",
    check: async (storage) => {
      await seedHistory(storage);
      const saved = await storage.getArtifactVersion("artifact-1");
      expect(saved).toEqual({ ...artifactVersion, checksum: expect.stringMatching(sha256Pattern) });
      await expect(storage.saveArtifactVersion(artifactVersion)).resolves.toEqual(saved);
      await expect(
        storage.saveArtifactVersion({ ...artifactVersion, payload: { sections: ["Changed"] } }),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect(storage.getArtifactVersion("artifact-1")).resolves.toEqual(saved);
      await expect(storage.getArtifactVersion("artifact-missing")).resolves.toBeUndefined();
    },
  },
];

const contextSnapshotContracts: readonly StorageContract[] = [
  {
    name: "context snapshots: are immutable once saved",
    check: async (storage) => {
      await seedHistory(storage);
      const saved = await storage.getContextSnapshot("context-1");
      expect(saved).toMatchObject({ id: "context-1", payload: { job: "fixture" } });
      expect(saved?.checksum).toMatch(sha256Pattern);
      await expect(
        storage.saveContextSnapshot({
          id: "context-1",
          workspaceId: workspace.id,
          schemaVersion: 1,
          createdAt: "2026-08-12T10:01:00.000Z",
          payload: { job: "changed" },
        }),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect(storage.getContextSnapshot("context-1")).resolves.toEqual(saved);
      await expect(storage.getContextSnapshot("context-missing")).resolves.toBeUndefined();
    },
  },
];

const opportunityBriefContracts: readonly StorageContract[] = [
  {
    name: "opportunity briefs: keep immutable versions and return the latest",
    check: async (storage) => {
      await storage.saveWorkspace(workspace);
      const one = await storage.saveOpportunityBrief(workspace.id, opportunityBrief());
      const two = await storage.saveOpportunityBrief(
        workspace.id,
        opportunityBrief({ version: 2, priorVersion: 1, createdAt: "2026-08-12T10:05:00.000Z" }),
      );
      expect(one).toMatchObject({
        workspaceId: workspace.id,
        brief: { id: "brief-1", version: 1 },
      });
      expect(one.checksum).toMatch(sha256Pattern);
      await expect(storage.saveOpportunityBrief(workspace.id, opportunityBrief())).resolves.toEqual(
        one,
      );
      await expect(
        storage.saveOpportunityBrief(
          workspace.id,
          opportunityBrief({ createdAt: "2026-08-12T10:00:30.000Z" }),
        ),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect(storage.getOpportunityBrief(workspace.id, "brief-1", 1)).resolves.toEqual(one);
      await expect(storage.getLatestOpportunityBrief(workspace.id, "brief-1")).resolves.toEqual(
        two,
      );
      await expect(storage.listOpportunityBriefVersions(workspace.id, "brief-1")).resolves.toEqual([
        one,
        two,
      ]);
      await expect(
        storage.getOpportunityBrief(workspace.id, "brief-1", 3),
      ).resolves.toBeUndefined();
    },
  },
  {
    name: "opportunity briefs: need their workspace and their parent version",
    check: async (storage) => {
      await storage.saveWorkspace(workspace);
      await expect(
        storage.saveOpportunityBrief("workspace-missing", opportunityBrief()),
      ).rejects.toBeInstanceOf(StorageValidationError);
      await expect(
        storage.saveOpportunityBrief(
          workspace.id,
          opportunityBrief({ version: 2, priorVersion: 1 }),
        ),
      ).rejects.toBeInstanceOf(StorageConflictError);
      await expect(storage.listOpportunityBriefVersions(workspace.id, "brief-1")).resolves.toEqual(
        [],
      );
    },
  },
  {
    name: "opportunity briefs: are scoped to their workspace",
    check: async (storage) => {
      await storage.saveWorkspace(workspace);
      await storage.saveWorkspace(otherWorkspace);
      await storage.saveOpportunityBrief(otherWorkspace.id, opportunityBrief());
      await expect(
        storage.getLatestOpportunityBrief(workspace.id, "brief-1"),
      ).resolves.toBeUndefined();
      await expect(storage.listOpportunityBriefVersions(workspace.id, "brief-1")).resolves.toEqual(
        [],
      );
    },
  },
];

const canonicalProfileContracts: readonly StorageContract[] = [
  {
    name: "canonical profiles: keep an immutable linear chain and return the latest",
    check: async (storage) => {
      await storage.saveWorkspace(workspace);
      const one = await storage.saveCanonicalCandidateProfile(workspace.id, canonicalProfile());
      const two = await storage.saveCanonicalCandidateProfile(
        workspace.id,
        canonicalProfile({
          version: 2,
          parentVersion: 1,
          createdAt: "2026-08-12T10:01:00.000Z",
          updatedAt: "2026-08-12T10:01:00.000Z",
        }),
      );
      expect(one).toMatchObject({ workspaceId: workspace.id, profile: { id: "profile-1" } });
      expect(one.checksum).toMatch(sha256Pattern);
      await expect(
        storage.saveCanonicalCandidateProfile(workspace.id, canonicalProfile()),
      ).resolves.toEqual(one);
      await expect(
        storage.getCanonicalCandidateProfile(workspace.id, "profile-1", 1),
      ).resolves.toEqual(one);
      await expect(
        storage.getLatestCanonicalCandidateProfile(workspace.id, "profile-1"),
      ).resolves.toEqual(two);
      await expect(
        storage.listCanonicalCandidateProfileVersions(workspace.id, "profile-1"),
      ).resolves.toEqual([one, two]);
      await expect(
        storage.saveCanonicalCandidateProfile(
          workspace.id,
          canonicalProfile({ version: 4, parentVersion: 3 }),
        ),
      ).rejects.toThrow();
      await expect(
        storage.listCanonicalCandidateProfileVersions(workspace.id, "profile-1"),
      ).resolves.toEqual([one, two]);
    },
  },
  {
    name: "canonical profiles: need their workspace and are scoped to it",
    check: async (storage) => {
      await storage.saveWorkspace(workspace);
      await storage.saveWorkspace(otherWorkspace);
      await expect(
        storage.saveCanonicalCandidateProfile("workspace-missing", canonicalProfile()),
      ).rejects.toBeInstanceOf(StorageValidationError);
      await storage.saveCanonicalCandidateProfile(otherWorkspace.id, canonicalProfile());
      await expect(
        storage.getLatestCanonicalCandidateProfile(workspace.id, "profile-1"),
      ).resolves.toBeUndefined();
      await expect(
        storage.listCanonicalCandidateProfileVersions(otherWorkspace.id),
      ).resolves.toHaveLength(1);
    },
  },
];

const writingPolicyContracts: readonly StorageContract[] = [
  {
    name: "writing policies: append a chain from the current leaf",
    check: async (storage) => {
      await storage.saveWorkspace(workspace);
      await expect(storage.getLatestWritingPolicyVersion(workspace.id)).resolves.toBeUndefined();
      const policyOne = writingPolicy("Workspace policy one", "policy-1");
      const one = await storage.saveWritingPolicyVersion(workspace.id, policyOne, {
        createdAt: "2026-08-12T10:01:00.000Z",
        priorChecksum: null,
      });
      expect(one).toMatchObject({
        workspaceId: workspace.id,
        checksum: policyOne.checksum,
        version: "policy-1",
        priorChecksum: null,
        policy: { content: "Workspace policy one" },
      });
      expect(one.payloadChecksum).toMatch(sha256Pattern);
      const two = await storage.saveWritingPolicyVersion({
        workspaceId: workspace.id,
        policy: writingPolicy("Workspace policy two", "policy-2"),
        createdAt: "2026-08-12T10:02:00.000Z",
      });
      expect(two.priorChecksum).toBe(one.checksum);
      await expect(storage.getWritingPolicyVersion(workspace.id, one.checksum)).resolves.toEqual(
        one,
      );
      await expect(storage.getLatestWritingPolicyVersion(workspace.id)).resolves.toEqual(two);
      await expect(storage.listWritingPolicyVersions(workspace.id)).resolves.toEqual([one, two]);
    },
  },
  {
    name: "writing policies: refuse branches, reused content and reused versions",
    check: async (storage) => {
      await storage.saveWorkspace(workspace);
      const one = await storage.saveWritingPolicyVersion(
        workspace.id,
        writingPolicy("Workspace policy one", "policy-1"),
        { createdAt: "2026-08-12T10:01:00.000Z", priorChecksum: null },
      );
      const two = await storage.saveWritingPolicyVersion(
        workspace.id,
        writingPolicy("Workspace policy two", "policy-2"),
        { createdAt: "2026-08-12T10:02:00.000Z" },
      );
      await expect(
        storage.saveWritingPolicyVersion(workspace.id, writingPolicy("Branch", "policy-branch"), {
          createdAt: "2026-08-12T10:03:00.000Z",
          priorChecksum: one.checksum,
        }),
      ).rejects.toThrow();
      await expect(
        storage.saveWritingPolicyVersion(
          workspace.id,
          writingPolicy("Workspace policy one", "policy-again"),
        ),
      ).rejects.toThrow();
      await expect(
        storage.saveWritingPolicyVersion(workspace.id, writingPolicy("Other", "policy-2")),
      ).rejects.toThrow();
      await expect(storage.listWritingPolicyVersions(workspace.id)).resolves.toEqual([one, two]);
    },
  },
];

const workspaceContracts: readonly StorageContract[] = [
  {
    name: "workspaces: read back what was saved, including updates",
    check: async (storage) => {
      await expect(storage.getWorkspace(workspace.id)).resolves.toBeUndefined();
      await storage.saveWorkspace(workspace);
      await expect(storage.getWorkspace(workspace.id)).resolves.toEqual(workspace);
      const updated: WorkspaceRecord = {
        ...workspace,
        state: "drafting",
        updatedAt: "2026-08-12T11:00:00.000Z",
      };
      await storage.saveWorkspace(updated);
      await expect(storage.getWorkspace(workspace.id)).resolves.toEqual(updated);
    },
  },
];

/** Every history and versioned-record contract, in a stable order. */
export const historyRecordsContracts: readonly StorageContract[] = [
  ...workspaceContracts,
  ...contextSnapshotContracts,
  ...artifactContracts,
  ...runContracts,
  ...runSnapshotContracts,
  ...childContracts,
  ...auditContracts,
  ...opportunityBriefContracts,
  ...canonicalProfileContracts,
  ...writingPolicyContracts,
];

/** Runs every contract against fresh stores from `open`, one test per contract. */
export function describeHistoryRecordsConformance(
  implementation: string,
  open: HistoryRecordsStorageFactory,
): void {
  describe(`${implementation} storage conformance: history and versioned records`, () => {
    for (const contract of historyRecordsContracts) {
      it(contract.name, async () => {
        const opened = await open();
        try {
          await contract.check(opened.storage);
        } finally {
          await opened.close();
        }
      });
    }
  });
}
