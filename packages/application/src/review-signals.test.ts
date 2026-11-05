import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ArtifactVersionRecord,
  DecisionRecord,
  FindingRecord,
  RunRecord,
} from "@draft-loop/storage";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";

import {
  deletedTerms,
  type ReviewSignalsStorage,
  readReviewSignals,
  reviewTerms,
} from "./review-signals.js";

const workspaceId = "workspace-signals";
const at = (minute: number) => `2030-01-01T10:${String(minute).padStart(2, "0")}:00.000Z`;

interface Section {
  readonly kind: string;
  readonly blocks: readonly { readonly id: string; readonly text: string }[];
}

function artifact(
  id: string,
  parentVersionId: string | null,
  version: number,
  sections: Section[],
) {
  return {
    id,
    workspaceId,
    version,
    parentVersionId,
    createdAt: at(version),
    payload: {
      id,
      parentVersionId,
      version,
      sections: sections.map((s, i) => ({ id: `s${i}`, ...s })),
    },
  };
}

const summary = (text: string): Section => ({
  kind: "summary",
  blocks: [{ id: "b-summary", text }],
});
const skills: Section = {
  kind: "skills",
  blocks: [{ id: "b-skills", text: "TypeScript, Postgres" }],
};
const experience: Section = {
  kind: "experience",
  blocks: [{ id: "b-exp", text: "Built a ledger service at Example Ledger." }],
};

interface FixtureRun {
  readonly id: string;
  readonly applicationId: string;
  readonly approval: "pending" | "approved";
  readonly artifacts: ReturnType<typeof artifact>[];
  readonly findings: { readonly id: string; readonly code: string }[];
  readonly decisions: { readonly findingId: string; readonly decision: string }[];
}

/** Two applications, three runs: repeated dismissals, a summary edit and a reordered draft. */
function fixture(): FixtureRun[] {
  return [
    {
      id: "run-1",
      applicationId: "app-a",
      approval: "approved",
      artifacts: [
        artifact("r1-v1", null, 1, [
          summary("A passionate, results-driven engineer."),
          experience,
          skills,
        ]),
        artifact("r1-v2", "r1-v1", 2, [
          summary("A passionate, results-driven engineer."),
          skills,
          experience,
        ]),
        artifact("r1-v2-candidate-edits", "r1-v2", 3, [
          summary("An engineer."),
          skills,
          experience,
        ]),
      ],
      findings: [
        { id: "f1", code: "editorial-tone" },
        { id: "f2", code: "unsupported-claim" },
      ],
      decisions: [
        { findingId: "f1", decision: "rejected" },
        { findingId: "f2", decision: "accepted" },
      ],
    },
    {
      id: "run-2",
      applicationId: "app-b",
      approval: "approved",
      artifacts: [
        artifact("r2-v1", null, 1, [summary("A passionate builder."), experience, skills]),
        artifact("r2-v1-candidate-edits", "r2-v1", 2, [summary("A builder."), experience, skills]),
      ],
      findings: [{ id: "f3", code: "editorial-tone" }],
      decisions: [
        { findingId: "f3", decision: "rejected" },
        { findingId: "f3", decision: "overridden" },
      ],
    },
    {
      id: "run-3",
      applicationId: "app-b",
      approval: "pending",
      artifacts: [artifact("r3-v1", null, 1, [summary("A passionate person."), experience])],
      findings: [{ id: "f4", code: "editorial-tone" }],
      decisions: [
        { findingId: "f4", decision: "rejected" },
        { findingId: "f4", decision: "accepted" },
      ],
    },
  ];
}

function runRecord(run: FixtureRun): Omit<RunRecord, "checksum"> {
  return {
    id: run.id,
    workspaceId,
    contextSnapshotId: "context-1",
    state: run.approval === "approved" ? "approved" : "awaiting-approval",
    round: 1,
    currentStep: null,
    budget: { maxRounds: 3, maxCostUsd: 1 },
    artifactId: run.artifacts.at(-1)?.id ?? null,
    approval: run.approval,
    totalCostUsd: 0,
    startedAt: at(0),
    updatedAt: at(1),
    lastError: null,
    payload: {},
  } as Omit<RunRecord, "checksum">;
}

function findingRecord(run: FixtureRun, finding: { id: string; code: string }) {
  return {
    id: finding.id,
    workspaceId,
    runId: run.id,
    roundId: `${run.id}-round-1`,
    executionId: null,
    artifactId: null,
    code: finding.code,
    category: "editorial",
    severity: "warning" as const,
    message: "fixture",
    claimId: null,
    sectionId: null,
    requirementId: null,
    createdAt: at(2),
    payload: {},
  };
}

function decisionRecords(run: FixtureRun) {
  return run.decisions.map(({ findingId, decision }, index) => ({
    id: `${run.id}-decision-${index}`,
    workspaceId,
    runId: run.id,
    roundId: null,
    artifactId: null,
    type: decision === "accepted" ? ("accept-finding" as const) : ("reject-finding" as const),
    rationale: "fixture",
    actor: "user",
    createdAt: at(10 + index),
    payload: { action: "finding-decision", findingId, decision },
  }));
}

function memoryStorage(runs: FixtureRun[]): ReviewSignalsStorage {
  const versions = new Map(runs.flatMap((run) => run.artifacts.map((a) => [a.id, a])));
  return {
    listRuns: async () => runs.map((run) => ({ ...runRecord(run), checksum: "" }) as RunRecord),
    listFindings: async (runId) =>
      runs
        .filter((run) => run.id === runId)
        .flatMap((run) => run.findings.map((f) => ({ ...findingRecord(run, f), checksum: "" })))
        .map((record) => record as FindingRecord),
    listDecisions: async (runId) =>
      runs
        .filter((run) => run.id === runId)
        .flatMap((run) =>
          decisionRecords(run).map((d) => ({ ...d, checksum: "" }) as DecisionRecord),
        ),
    getArtifactVersion: async (id) => {
      const found = versions.get(id);
      return found === undefined
        ? undefined
        : ({ ...found, checksum: "" } as unknown as ArtifactVersionRecord);
    },
    applicationIdForRun: async (_workspaceId: string, runId: string) =>
      runs.find((run) => run.id === runId)?.applicationId ?? "default",
  };
}

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

async function sqliteStorage(runs: FixtureRun[]): Promise<ReviewSignalsStorage> {
  const directory = mkdtempSync(join(tmpdir(), "review-signals-"));
  directories.push(directory);
  const storage = openSqliteStorage(join(directory, "workspace.sqlite"));
  await storage.saveWorkspace({
    id: workspaceId,
    state: "collecting",
    createdAt: at(0),
    updatedAt: at(0),
  });
  await storage.saveContextSnapshot({
    id: "context-1",
    workspaceId,
    schemaVersion: 1,
    createdAt: at(0),
    payload: { job: "fixture" },
  });
  for (const id of ["app-a", "app-b"])
    await storage.applications.insertApplication({
      workspaceId,
      id,
      name: id,
      jobSource: { kind: "local-file", path: "/synthetic/jobs/role.md" },
      createdAt: at(0),
    });
  for (const run of runs) {
    for (const version of run.artifacts) await storage.saveArtifactVersion(version);
    await storage.saveRun(runRecord(run));
    await storage.applications.bindRun({
      workspaceId,
      applicationId: run.applicationId,
      runId: run.id,
      createdAt: at(0),
    });
    await storage.saveRound({
      id: `${run.id}-round-1`,
      workspaceId,
      runId: run.id,
      number: 1,
      state: "awaiting-approval",
      startedAt: at(0),
      completedAt: at(1),
      evaluation: null,
      payload: {},
    } as never);
    for (const finding of run.findings) await storage.saveFinding(findingRecord(run, finding));
    for (const decision of decisionRecords(run)) await storage.saveDecision(decision);
  }
  return {
    listRuns: (id) => storage.listRuns(id),
    listFindings: (runId) => storage.listFindings(runId),
    listDecisions: (runId) => storage.listDecisions(runId),
    getArtifactVersion: (id) => storage.getArtifactVersion(id),
    applicationIdForRun: (id: string, runId: string) =>
      storage.applications.applicationIdForRun(id, runId),
  };
}

describe("review terms", () => {
  it("lower-cases words, drops punctuation and short words", () => {
    expect(reviewTerms("A Results-driven, passionate engineer.")).toEqual([
      "results-driven",
      "passionate",
      "engineer",
    ]);
  });

  it("lists drafted words the edit removed, once each", () => {
    expect(deletedTerms("passionate and passionate engineer", "An engineer")).toEqual([
      "passionate",
      "and",
    ]);
    expect(deletedTerms("Same words", "same WORDS")).toEqual([]);
  });
});

describe.each([
  ["in memory", async (runs: FixtureRun[]) => memoryStorage(runs)],
  ["on SQLite", sqliteStorage],
])("review signals %s", (_label, open) => {
  it("counts dismissed findings by code with their runs and applications", async () => {
    const signals = await readReviewSignals(await open(fixture()), workspaceId);
    expect(signals.dismissedFindings).toEqual([
      {
        code: "editorial-tone",
        count: 2,
        runIds: ["run-1", "run-2"],
        applicationIds: ["app-a", "app-b"],
      },
    ]);
  });

  it("reads deleted terms from approval edits of approved runs only", async () => {
    const signals = await readReviewSignals(await open(fixture()), workspaceId);
    expect(signals.deletedTerms).toEqual([
      {
        term: "passionate",
        count: 2,
        runIds: ["run-1", "run-2"],
        applicationIds: ["app-a", "app-b"],
      },
      { term: "results-driven", count: 1, runIds: ["run-1"], applicationIds: ["app-a"] },
    ]);
  });

  it("compares the approved section order with the run's first draft", async () => {
    const signals = await readReviewSignals(await open(fixture()), workspaceId);
    expect(signals.sectionOrders).toEqual([
      {
        runId: "run-1",
        applicationId: "app-a",
        drafted: ["summary", "experience", "skills"],
        approved: ["summary", "skills", "experience"],
        removed: [],
      },
    ]);
  });

  it("has no signals once the runs are gone", async () => {
    expect(await readReviewSignals(await open([]), workspaceId)).toEqual({
      dismissedFindings: [],
      deletedTerms: [],
      sectionOrders: [],
    });
  });
});
