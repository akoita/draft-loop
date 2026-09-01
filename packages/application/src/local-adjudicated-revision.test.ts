import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readinessDimensions } from "@draft-loop/domain";
import {
  type AuthorAdjudicationDecisionInput,
  type IndependentReadinessReport,
  independentReadinessReportSchema,
} from "@draft-loop/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  type ApplicationDriver,
  createApplicationService,
  type RequestAdjudicatedRevisionCommand,
} from "./index.js";
import { createCandidateKnowledgeStoreService } from "./knowledge-base.js";
import { createLocalApplicationDriver, type ProviderClientFactories } from "./local.js";

const silent = { write: () => undefined };

function stage(
  driver: ApplicationDriver,
  command: RequestAdjudicatedRevisionCommand,
): Promise<Awaited<ReturnType<NonNullable<ApplicationDriver["requestAdjudicatedRevision"]>>>> {
  if (driver.requestAdjudicatedRevision === undefined) {
    throw new Error("The local driver does not expose adjudicated revision staging.");
  }
  return driver.requestAdjudicatedRevision(command, silent);
}

async function fixtureRun(
  prefix: string,
  options?: Parameters<typeof createLocalApplicationDriver>[0],
): Promise<{
  readonly root: string;
  readonly driver: ApplicationDriver;
  readonly started: Awaited<ReturnType<ApplicationDriver["start"]>>;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(
    join(root, "job.md"),
    "TypeScript systems engineer\nKubernetes operations\n",
    "utf8",
  );
  await writeFile(
    join(root, "evidence", "resume.md"),
    "Built local-first TypeScript tools with deterministic testing.\n",
    "utf8",
  );
  const driver = createLocalApplicationDriver(options);
  await driver.initialize(
    { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true, maxRounds: 3 },
    silent,
  );
  const started = await driver.start({ root, allowProviderData: false }, silent);
  expect(started.state).toBe("awaiting-approval");
  expect(started.artifact).not.toBeNull();
  return { root, driver, started };
}

function reportFor(
  snapshot: Awaited<ReturnType<ApplicationDriver["start"]>>,
): IndependentReadinessReport {
  if (snapshot.artifact === null) throw new Error("The fixture did not produce an artifact.");
  return independentReadinessReportSchema.parse({
    schemaVersion: 1,
    contextSnapshotId: snapshot.contextSnapshotId,
    artifact: { id: snapshot.artifact.id, version: snapshot.artifact.version },
    createdAt: "2020-09-01T10:00:00.000Z",
    summary: "A complete, content-safe readiness report for staging.",
    independentReview: {
      authorLineage: "anthropic:fixture-author",
      criticLineage: "openai:fixture-critic",
      lineagesDistinct: true,
      required: true,
    },
    inputAssessment: { status: "complete", missingInputs: [] },
    evaluation: {
      scores: readinessDimensions.map((dimension) => ({
        dimension,
        score: 0.8,
        rationale: `The ${dimension} check passed for the fixture.`,
      })),
      thresholdResults: readinessDimensions.map((dimension) => ({
        dimension,
        score: 0.8,
        threshold: 0.7,
        meets: true,
      })),
      meetsRubric: true,
    },
    findings: [
      {
        id: "finding-accept",
        origin: "critic",
        code: "quality-accept",
        category: "quality",
        severity: "warning",
        rationale: "The summary can be made more direct.",
        target: { kind: "artifact", id: snapshot.artifact.id },
        recommendedAction: "Use a more direct summary sentence.",
        confidence: 0.9,
      },
      {
        id: "finding-reject",
        origin: "deterministic",
        code: "format-reject",
        category: "format",
        severity: "warning",
        rationale: "The proposed layout change is not needed.",
        target: { kind: "artifact", id: snapshot.artifact.id },
        recommendedAction: "Leave the current layout unchanged.",
        confidence: 0.8,
      },
      {
        id: "finding-nuance",
        origin: "critic",
        code: "coverage-nuance",
        category: "coverage",
        severity: "warning",
        rationale: "The evidence supports a narrower coverage statement.",
        target: { kind: "artifact", id: snapshot.artifact.id },
        recommendedAction: "Keep the claim while stating its boundary.",
        confidence: 0.7,
      },
    ],
  });
}

function decisionsFor(
  report: IndependentReadinessReport,
): readonly AuthorAdjudicationDecisionInput[] {
  return report.findings.map((finding, index) => ({
    findingId: finding.id,
    disposition: ["accept", "reject", "nuance"][index] as "accept" | "reject" | "nuance",
    rationale: `The candidate recorded the ${finding.id} decision.`,
  }));
}

function commandFor(
  root: string,
  snapshot: Awaited<ReturnType<ApplicationDriver["start"]>>,
): RequestAdjudicatedRevisionCommand {
  const report = reportFor(snapshot);
  return {
    root,
    runId: snapshot.runId,
    report,
    decisions: decisionsFor(report),
    acceptedEffectOverrides: [
      {
        findingId: "finding-accept",
        rationale: "The accepted wording effect is bounded and explicit.",
      },
    ],
  };
}

async function configuredSelectionRun(prefix: string): Promise<{
  readonly root: string;
  readonly driver: ApplicationDriver;
  readonly started: Awaited<ReturnType<ApplicationDriver["start"]>>;
  readonly storeRoot: string;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const storeRoot = join(root, "candidate-store");
  const sourcePath = join(root, "candidate-evidence.md");
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
  await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript systems.\n", "utf8");
  await writeFile(sourcePath, "Built TypeScript systems.\n", "utf8");

  const ids = ["store-selection", "ckb-selection", "source-selection", "version-selection"];
  const service = createCandidateKnowledgeStoreService({
    generateId: () => ids.shift() ?? "unexpected-id",
    now: () => "2026-09-01T10:00:00.000Z",
  });
  await service.initializeStore({ storeRoot });
  await service.importKnowledgeSourceFile({
    storeRoot,
    knowledgeBaseId: "ckb-selection",
    sourcePath,
  });

  const driver = createLocalApplicationDriver();
  await driver.initialize(
    { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true, maxRounds: 3 },
    silent,
  );
  await driver.configureKnowledgeSelection({
    root,
    entries: [{ storeRoot, storeId: "store-selection", knowledgeBaseId: "ckb-selection" }],
  });
  const started = await driver.start({ root, allowProviderData: false }, silent);
  expect(started.state).toBe("awaiting-approval");
  return { root, driver, started, storeRoot };
}

describe("local adjudicated revision staging", () => {
  it("stages a complete accept/reject/nuance adjudication in the next rejected round", async () => {
    const { root, driver, started } = await fixtureRun("draft-loop-adjudication-stage-");
    try {
      const command = commandFor(root, started);
      const staged = await createApplicationService(driver).requestAdjudicatedRevision(
        command,
        silent,
      );

      expect(staged.state).toBe("revising");
      expect(staged.approval).toBe("rejected");
      expect(staged.round).toBe(started.round + 1);
      expect(staged.currentStep).toBe("revision");
      expect(staged.adjudicationRuntime?.report).toEqual(command.report);
      expect(
        staged.adjudicationRuntime?.plan.decisions.map(({ disposition }) => disposition),
      ).toEqual(["accept", "reject", "nuance"]);
      expect(
        staged.adjudicationRuntime?.plan.decisions
          .slice(1)
          .every(({ effectRequirement }) => effectRequirement === "disagreement-preserved"),
      ).toBe(true);
      expect(staged.adjudicationRuntime?.acceptedEffectOverrides).toEqual(
        command.acceptedEffectOverrides,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("reloads the exact report, canonical plan, and preserved disagreements after restart", async () => {
    const { root, driver, started } = await fixtureRun("draft-loop-adjudication-restart-");
    try {
      const staged = await stage(driver, commandFor(root, started));
      const restarted = createLocalApplicationDriver();
      const reloaded = await restarted.status({ root, runId: started.runId }, silent);

      expect(reloaded).toEqual(staged);
      expect(reloaded?.adjudicationRuntime?.report).toEqual(staged.adjudicationRuntime?.report);
      expect(reloaded?.adjudicationRuntime?.plan).toEqual(staged.adjudicationRuntime?.plan);
      expect(
        reloaded?.adjudicationRuntime?.plan.decisions
          .slice(1)
          .map(({ disposition }) => disposition),
      ).toEqual(["reject", "nuance"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not resolve credentials or open provider clients while staging", async () => {
    const resolveCredential = vi.fn(async () => {
      throw new Error("staging must not resolve provider credentials");
    });
    const providerClientFactories: ProviderClientFactories = {
      anthropic: vi.fn(() => {
        throw new Error("staging must not create an Anthropic client");
      }),
      openai: vi.fn(() => {
        throw new Error("staging must not create an OpenAI client");
      }),
      local: vi.fn(() => {
        throw new Error("staging must not create a local client");
      }),
    };
    const { root, driver, started } = await fixtureRun("draft-loop-adjudication-no-provider-", {
      resolveCredential,
      providerClientFactories,
    });
    try {
      resolveCredential.mockClear();
      await stage(driver, commandFor(root, started));
      expect(resolveCredential).not.toHaveBeenCalled();
      expect(providerClientFactories.anthropic).not.toHaveBeenCalled();
      expect(providerClientFactories.openai).not.toHaveBeenCalled();
      expect(providerClientFactories.local).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails clearly when no latest run exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-adjudication-missing-run-"));
    try {
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript systems.\n", "utf8");
      const driver = createLocalApplicationDriver();
      await driver.initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        silent,
      );
      const report = reportFor({
        contextSnapshotId: "missing-context",
        artifact: { id: "missing-artifact", version: 1 },
      } as never);
      await expect(stage(driver, { root, report, decisions: [] })).rejects.toThrow(
        "No run is configured. Start a run first.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects selection drift before changing the persisted run", async () => {
    const { root, driver, started } = await configuredSelectionRun(
      "draft-loop-adjudication-selection-drift-",
    );
    try {
      const before = await driver.status({ root, runId: started.runId }, silent);
      const configPath = join(root, ".draft-loop", "workspace.json");
      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        candidateKnowledgeSelection: {
          entries: [{ storeRoot: string; storeId: string; knowledgeBaseId: string }];
        };
      };
      config.candidateKnowledgeSelection.entries[0].storeId = "different-store";
      await writeFile(configPath, JSON.stringify(config), "utf8");

      await expect(stage(driver, commandFor(root, started))).rejects.toThrow(
        "The candidate knowledge selection changed; review is required before provider execution.",
      );
      expect(await driver.status({ root, runId: started.runId }, silent)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed for incomplete, duplicate, unknown, and stale decisions without mutation", async () => {
    const { root, driver, started } = await fixtureRun("draft-loop-adjudication-validation-");
    try {
      const command = commandFor(root, started);
      const before = await driver.status({ root, runId: started.runId }, silent);
      if (before === undefined) throw new Error("The fixture run was not persisted.");

      await expect(
        stage(driver, { ...command, decisions: command.decisions.slice(0, 2) }),
      ).rejects.toThrow("Exactly one adjudication decision is required for every report finding.");
      expect(await driver.status({ root, runId: started.runId }, silent)).toEqual(before);

      const firstDecision = command.decisions[0];
      if (firstDecision === undefined) throw new Error("The fixture decisions are incomplete.");
      await expect(
        stage(driver, { ...command, decisions: [...command.decisions, firstDecision] }),
      ).rejects.toThrow("Adjudication decision finding-accept is duplicated.");
      expect(await driver.status({ root, runId: started.runId }, silent)).toEqual(before);

      await expect(
        stage(driver, {
          ...command,
          decisions: command.decisions.map((decision, index) =>
            index === 0 ? { ...decision, findingId: "unknown-finding" } : decision,
          ),
        }),
      ).rejects.toThrow("Adjudication decision unknown-finding is not in the readiness report.");
      expect(await driver.status({ root, runId: started.runId }, silent)).toEqual(before);

      await expect(
        stage(driver, {
          ...command,
          report: { ...command.report, contextSnapshotId: "stale-context" },
        }),
      ).rejects.toThrow("The readiness report context does not match the run context.");
      expect(await driver.status({ root, runId: started.runId }, silent)).toEqual(before);

      await expect(
        stage(driver, {
          ...command,
          report: {
            ...command.report,
            artifact: { id: "stale-artifact", version: command.report.artifact.version },
            findings: command.report.findings.map((finding) => ({
              ...finding,
              target: { kind: "artifact", id: "stale-artifact" },
            })),
          },
        }),
      ).rejects.toThrow("The readiness report artifact does not match the current artifact.");
      expect(await driver.status({ root, runId: started.runId }, silent)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
