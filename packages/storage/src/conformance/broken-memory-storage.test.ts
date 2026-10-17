import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ArtifactVersionInput, ArtifactVersionRecord } from "../artifact-history.js";
import type { AuditEvent, AuditEventInput } from "../ports/history.js";
import type {
  CanonicalCandidateProfileVersionRecord,
  OpportunityBriefVersionRecord,
  WritingPolicyVersionRecord,
} from "../ports/versioned-records.js";
import type { WorkspaceRecord } from "../ports/workspace.js";
import { type HistoryRecordsStorage, historyRecordsContracts } from "./history-records.js";

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * A plausible but careless in-memory store: it overwrites on save, keeps
 * insertion order, never checks parents or workspaces, and writes no audit
 * trail. Every port method exists, so only the contracts can catch it.
 */
function brokenMemoryStorage(): HistoryRecordsStorage {
  const workspaces = new Map<string, WorkspaceRecord>();
  type Row = { readonly runId?: string; readonly workspaceId?: string };
  const records = new Map<string, Map<string, Row>>();
  const table = (name: string) => {
    let rows = records.get(name);
    if (rows === undefined) {
      rows = new Map();
      records.set(name, rows);
    }
    return rows;
  };
  const save = async <T extends { readonly id: string }>(name: string, input: T) => {
    const record = { ...input, checksum: digest(input) };
    table(name).set(input.id, record as Row);
    return record;
  };
  const get = async <T>(name: string, id: string) => table(name).get(id) as T | undefined;
  const list = async <T>(name: string, runId: string) =>
    [...table(name).values()].filter((row) => row.runId === runId) as unknown as readonly T[];
  const snapshots: { runId: string; sequence: number; id: string }[] = [];
  const audit: AuditEvent[] = [];
  const briefs = new Map<string, OpportunityBriefVersionRecord>();
  const profiles = new Map<string, CanonicalCandidateProfileVersionRecord>();
  const policies: WritingPolicyVersionRecord[] = [];

  return {
    saveWorkspace: async (record) => void workspaces.set(record.id, record),
    getWorkspace: async (id) => workspaces.get(id),
    saveContextSnapshot: (input) => save("context", input),
    getContextSnapshot: (id) => get("context", id),
    saveArtifactVersion: (input: ArtifactVersionInput) => save("artifact", input),
    getArtifactVersion: (id) => get<ArtifactVersionRecord>("artifact", id),
    saveRun: (input) => save("run", input),
    getRun: (id) => get("run", id),
    listRuns: async (workspaceId) =>
      [...table("run").values()].filter((row) => row.workspaceId === workspaceId) as never,
    saveRunSnapshot: async (input) => {
      const record = {
        ...input,
        id: `snapshot-${snapshots.length}`,
        sequence: snapshots.length + 1,
        checksum: digest(input),
      };
      snapshots.push(record);
      return record;
    },
    getLatestRunSnapshot: async (runId) => snapshots.find((row) => row.runId === runId) as never,
    listRunSnapshots: async (runId) => snapshots.filter((row) => row.runId === runId) as never,
    saveRound: (input) => save("round", input),
    getRound: (id) => get("round", id),
    listRounds: (runId) => list("round", runId),
    saveExecution: (input) => save("execution", input),
    getExecution: (id) => get("execution", id),
    listExecutions: (runId) => list("execution", runId),
    saveFinding: (input) => save("finding", input),
    getFinding: (id) => get("finding", id),
    listFindings: (runId) => list("finding", runId),
    saveDecision: (input) => save("decision", input),
    getDecision: (id) => get("decision", id),
    listDecisions: (runId) => list("decision", runId),
    saveExport: (input) => save("export", input),
    getExport: (id) => get("export", id),
    listExports: (runId) => list("export", runId),
    appendAuditEvent: async (input: AuditEventInput) => {
      const event: AuditEvent = {
        ...input,
        sequence: audit.length + 1,
        payloadChecksum: digest(input.payload),
        previousEventChecksum: null,
        eventChecksum: digest(input),
      };
      audit.push(event);
      return event;
    },
    listAuditEvents: async (workspaceId) => audit.filter((row) => row.workspaceId === workspaceId),
    auditEvents: {
      findLatestAuditEvent: async () => undefined,
      verifyAuditChain: async () => ({ ok: true, eventCount: audit.length, problems: [] }),
    },
    saveOpportunityBrief: async (workspaceId, brief) => {
      const record = { workspaceId, brief, checksum: digest(brief) };
      briefs.set(`${brief.id}:${brief.version}`, record);
      return record;
    },
    getOpportunityBrief: async (_workspaceId, briefId, version) =>
      briefs.get(`${briefId}:${version}`),
    getLatestOpportunityBrief: async (_workspaceId, briefId) =>
      [...briefs.values()].filter((row) => row.brief.id === briefId).at(-1),
    listOpportunityBriefVersions: async (_workspaceId, briefId) =>
      [...briefs.values()].filter((row) => row.brief.id === briefId),
    saveCanonicalCandidateProfile: async (workspaceId, profile) => {
      const record = { workspaceId, profile, checksum: digest(profile) };
      profiles.set(`${profile.id}:${profile.version}`, record);
      return record;
    },
    getCanonicalCandidateProfile: async (_workspaceId, profileId, version) =>
      profiles.get(`${profileId}:${version}`),
    getLatestCanonicalCandidateProfile: async (_workspaceId, profileId) =>
      [...profiles.values()].filter((row) => row.profile.id === profileId).at(-1),
    listCanonicalCandidateProfileVersions: async (_workspaceId, profileId) =>
      [...profiles.values()].filter(
        (row) => profileId === undefined || row.profile.id === profileId,
      ),
    saveWritingPolicyVersion: (async (
      first: string | { workspaceId: string; policy: never },
      second?: never,
    ) => {
      const { workspaceId, policy } =
        typeof first === "string" ? { workspaceId: first, policy: second } : first;
      const record = {
        workspaceId,
        policy,
        checksum: (policy as { checksum: string } | undefined)?.checksum ?? "",
        version: (policy as { version: string } | undefined)?.version ?? "",
        schemaVersion: 1,
        createdAt: "2026-08-12T10:00:00.000Z",
        priorChecksum: null,
        payloadChecksum: digest(policy),
      } as unknown as WritingPolicyVersionRecord;
      policies.push(record);
      return record;
    }) as HistoryRecordsStorage["saveWritingPolicyVersion"],
    getWritingPolicyVersion: async (workspaceId, checksum) =>
      policies.find((row) => row.workspaceId === workspaceId && row.checksum === checksum),
    getLatestWritingPolicyVersion: async (workspaceId) =>
      policies.filter((row) => row.workspaceId === workspaceId).at(-1),
    listWritingPolicyVersions: async (workspaceId) =>
      policies.filter((row) => row.workspaceId === workspaceId),
  };
}

describe("history and versioned-record conformance contracts", () => {
  it("fail a careless in-memory implementation in every concern it gets wrong", async () => {
    const failed: string[] = [];
    for (const contract of historyRecordsContracts) {
      try {
        await contract.check(brokenMemoryStorage());
      } catch {
        failed.push(contract.name);
      }
    }
    const failedConcerns = new Set(failed.map((name) => name.split(":")[0]));
    expect([...failedConcerns].sort()).toEqual([
      "artifact versions",
      "audit",
      "canonical profiles",
      "context snapshots",
      "decisions",
      "executions",
      "exports",
      "findings",
      "opportunity briefs",
      "rounds",
      "run snapshots",
      "runs",
      "writing policies",
    ]);
    expect(failed).toEqual(
      expect.arrayContaining([
        "runs: reject a changed run under an existing id",
        "runs: list only the workspace's runs, by update time then id",
        "run snapshots: append in order and return the latest",
        "run snapshots: an identical snapshot is stored once",
        "rounds: rejects a changed record under an existing id",
        "rounds: lists only the run's records, in order",
        "audit: history writes extend a per-workspace hash chain that verifies",
        "opportunity briefs: need their workspace and their parent version",
        "opportunity briefs: are scoped to their workspace",
        "canonical profiles: need their workspace and are scoped to it",
        "writing policies: append a chain from the current leaf",
        "writing policies: refuse branches, reused content and reused versions",
      ]),
    );
  });
});
