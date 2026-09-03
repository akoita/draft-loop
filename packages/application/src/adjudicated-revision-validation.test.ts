import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readinessDimensions } from "@draft-loop/domain";
import {
  type AuthorAdjudicationDecisionInput,
  type AuthorArtifactProposal,
  type IndependentReadinessReport,
  independentReadinessReportSchema,
} from "@draft-loop/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  type ApplicationDriver,
  createApplicationService,
  type RequestAdjudicatedRevisionCommand,
} from "./index.js";
import { createLocalApplicationDriver } from "./local.js";

type JsonRecord = Record<string, unknown>;

const silent = { write: () => undefined };

function localCompletion(output: JsonRecord, id: string): unknown {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id,
      choices: [{ message: { content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
    }),
  };
}

function validProposal(
  chunkId: string,
  text = "Built local-first TypeScript tools with deterministic testing.",
): AuthorArtifactProposal {
  return {
    sections: [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text,
            claims: [
              {
                text,
                substantive: true,
                evidenceChunkIds: [chunkId],
              },
            ],
          },
        ],
      },
    ],
  };
}

function tenFindingReport(
  snapshot: Awaited<ReturnType<ApplicationDriver["start"]>>,
): IndependentReadinessReport {
  const artifact = snapshot.artifact;
  if (artifact === null) throw new Error("Artifact is required.");
  return independentReadinessReportSchema.parse({
    schemaVersion: 1,
    contextSnapshotId: snapshot.contextSnapshotId,
    artifact: { id: artifact.id, version: artifact.version },
    createdAt: "2026-09-01T10:00:00.000Z",
    summary: "Ten findings matching the v0.9 pilot observation shape.",
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
        rationale: `Check passed for ${dimension}.`,
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
        id: "finding-accept-1",
        origin: "critic",
        code: "quality-accept",
        category: "quality",
        severity: "warning",
        rationale: "External requirement one.",
        target: { kind: "requirement", id: "req-external-1" },
        recommendedAction: "Apply external requirement one.",
        confidence: 0.9,
      },
      {
        id: "finding-accept-2",
        origin: "critic",
        code: "quality-accept-2",
        category: "quality",
        severity: "warning",
        rationale: "External rubric requirement two.",
        target: { kind: "rubric", id: "clarity" },
        recommendedAction: "Apply external rubric requirement two.",
        confidence: 0.9,
      },
      {
        id: "finding-reject-1",
        origin: "critic",
        code: "format-reject-1",
        category: "format",
        severity: "warning",
        rationale: "First rejected finding.",
        target: { kind: "artifact", id: artifact.id },
        recommendedAction: "Do not change format.",
        confidence: 0.8,
      },
      {
        id: "finding-reject-2",
        origin: "critic",
        code: "format-reject-2",
        category: "format",
        severity: "warning",
        rationale: "Second rejected finding.",
        target: { kind: "artifact", id: artifact.id },
        recommendedAction: "Do not alter section.",
        confidence: 0.8,
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `finding-nuance-${index + 1}`,
        origin: "critic" as const,
        code: `nuance-${index + 1}`,
        category: "coverage" as const,
        severity: "warning" as const,
        rationale: `Nuanced finding ${index + 1}.`,
        target: { kind: "artifact" as const, id: artifact.id },
        recommendedAction: `Keep claim boundary for nuance ${index + 1}.`,
        confidence: 0.7,
      })),
    ],
  });
}

function tenFindingDecisions(
  report: IndependentReadinessReport,
): readonly AuthorAdjudicationDecisionInput[] {
  return report.findings.map((finding) => {
    const disposition = finding.id.startsWith("finding-accept")
      ? ("accept" as const)
      : finding.id.startsWith("finding-reject")
        ? ("reject" as const)
        : ("nuance" as const);
    return {
      findingId: finding.id,
      disposition,
      rationale: `Confirmed decision for ${finding.id}.`,
    };
  });
}

function tenFindingOverrides(): NonNullable<
  RequestAdjudicatedRevisionCommand["acceptedEffectOverrides"]
> {
  return [
    {
      findingId: "finding-accept-1",
      rationale: "Bounded accepted effect rationale for external requirement one.",
    },
    {
      findingId: "finding-accept-2",
      rationale: "Bounded accepted effect rationale for external rubric requirement two.",
    },
  ];
}

async function setupTenFindingRun(
  prefix: string,
  onRevisionFetch: (body: JsonRecord) => Promise<unknown>,
): Promise<{
  readonly root: string;
  readonly driver: ApplicationDriver;
  readonly started: Awaited<ReturnType<ApplicationDriver["start"]>>;
  readonly chunkId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "job.md"), "TypeScript systems engineer\n", "utf8");
  await writeFile(
    join(root, "evidence", "resume.md"),
    "Built local-first TypeScript tools with deterministic testing.\n",
    "utf8",
  );

  let chunkId = "chunk-1";
  let round = 1;

  const localFetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      readonly model: string;
      readonly messages: readonly { readonly content: string }[];
    };
    const serialized = body.messages[1]?.content ?? "";
    const parsed = JSON.parse(serialized) as JsonRecord;

    if (body.model === "adjudicated-author") {
      const retrieved = (parsed.retrievedEvidence as readonly { readonly id: string }[]) ?? [];
      if (retrieved[0]?.id) chunkId = retrieved[0].id;
      if (round === 1) {
        return localCompletion(validProposal(chunkId), "author-r1");
      }
      return onRevisionFetch(parsed);
    }
    return localCompletion({ findings: [] }, "critic");
  });

  const driver = createLocalApplicationDriver({
    providerClientFactories: {
      local: () => ({ fetch: localFetch as unknown as typeof fetch }),
    },
  });

  await driver.initialize(
    {
      root,
      jobDescription: "job.md",
      sources: "evidence",
      authorCompany: "local",
      authorModel: "adjudicated-author",
      criticCompany: "local",
      criticModel: "adjudicated-critic",
      localEndpoint: "http://127.0.0.1:8080/v1",
      maxRounds: 3,
    },
    silent,
  );

  const started = await driver.start({ root, allowProviderData: true }, silent);
  expect(started.state).toBe("awaiting-approval");
  round = 2;

  const report = tenFindingReport(started);
  const decisions = tenFindingDecisions(report);
  const acceptedEffectOverrides = tenFindingOverrides();

  await createApplicationService(driver).requestAdjudicatedRevision(
    { root, runId: started.runId, report, decisions, acceptedEffectOverrides },
    silent,
  );

  return { root, driver, started, chunkId };
}

describe("adjudicated revision failure-stage classification with 10-finding carrier", () => {
  it("classifies transport parsing failures without exposing private stdout content", async () => {
    const { root, driver, started } = await setupTenFindingRun(
      "draft-loop-stage-transport-",
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "malformed-resp",
          choices: [{ message: { content: "not-json-at-all{" } }],
        }),
      }),
    );

    try {
      const resumed = await driver.resume(
        { root, runId: started.runId, allowProviderData: true },
        silent,
      );

      expect(resumed.state).toBe("provider-error");
      expect(resumed.lastError).toMatchObject({
        code: "invalid-response",
        step: "revision",
        failureStage: "transport-parsing",
        failureReason: "transport-parsing",
        diagnostics: [{ code: "invalid_json" }],
      });
      const serialized = JSON.stringify(resumed.lastError);
      expect(serialized).not.toContain("not-json-at-all");
      expect(serialized).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies response-schema validation failures and preserves retryability", async () => {
    let attempts = 0;
    const authorInputs: JsonRecord[] = [];
    const { root, driver, started, chunkId } = await setupTenFindingRun(
      "draft-loop-stage-response-schema-",
      async (input) => {
        authorInputs.push(input);
        attempts += 1;
        if (attempts === 1) {
          // Missing required sections array
          return localCompletion({ invalid: true }, "invalid-schema");
        }
        return localCompletion(validProposal(chunkId), "valid-schema");
      },
    );

    try {
      const failed = await driver.resume(
        { root, runId: started.runId, allowProviderData: true },
        silent,
      );

      expect(failed.state).toBe("provider-error");
      expect(failed.lastError).toMatchObject({
        code: "invalid-response",
        step: "revision",
        failureStage: "response-schema-validation",
        failureReason: "response-schema-validation",
        retryable: true,
      });
      expect(failed.lastError?.diagnostics).toEqual(
        expect.arrayContaining([{ code: "invalid_type", path: "sections" }]),
      );

      const recovered = await driver.resume(
        { root, runId: started.runId, allowProviderData: true },
        silent,
      );

      expect(recovered.state).toBe("awaiting-approval");
      expect(authorInputs).toHaveLength(2);
      expect(authorInputs[1]).toMatchObject({
        retryFeedback: {
          failureCode: "invalid-response",
          failureStage: "response-schema-validation",
        },
      });
      expect((authorInputs[1]?.retryFeedback as { diagnostics?: unknown })?.diagnostics).toEqual(
        expect.arrayContaining([{ code: "invalid_type", path: "sections" }]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies factual-invariant rejections with content-free diagnostic codes", async () => {
    let attempts = 0;
    const { root, driver, started, chunkId } = await setupTenFindingRun(
      "draft-loop-stage-factual-invariant-",
      async () => {
        attempts += 1;
        if (attempts === 1) {
          // Introduces ungrounded protected value 2099
          return localCompletion(
            validProposal(chunkId, "Built tools in 2099 with deterministic testing."),
            "unsupported-protected-value",
          );
        }
        return localCompletion(validProposal(chunkId), "valid-recovered");
      },
    );

    try {
      const failed = await driver.resume(
        { root, runId: started.runId, allowProviderData: true },
        silent,
      );

      expect(failed.state).toBe("provider-error");
      expect(failed.lastError).toMatchObject({
        code: "invalid-response",
        step: "revision",
        failureStage: "factual-invariant-rejection",
        failureReason: "factual-invariant-rejection",
        retryable: true,
        diagnostics: [
          { code: "factual_invariant_violation", path: "sections.0.blocks.0.claims.0.text" },
        ],
      });
      const serialized = JSON.stringify(failed.lastError);
      expect(serialized).not.toContain("2099");
      expect(serialized).not.toContain("Built tools in 2099");

      const recovered = await driver.resume(
        { root, runId: started.runId, allowProviderData: true },
        silent,
      );
      expect(recovered.state).toBe("awaiting-approval");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("classifies artifact-schema validation failures correctly", async () => {
    const { root, driver, started } = await setupTenFindingRun(
      "draft-loop-stage-artifact-schema-",
      async () => {
        return localCompletion({ sections: [] }, "empty-sections");
      },
    );

    try {
      const failed = await driver.resume(
        { root, runId: started.runId, allowProviderData: true },
        silent,
      );

      expect(failed.state).toBe("provider-error");
      expect(failed.lastError).toMatchObject({
        code: "invalid-response",
        step: "revision",
        failureStage: "response-schema-validation",
        retryable: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes production validation for a representative valid revised artifact with the 10-finding carrier", async () => {
    const { root, driver, started, chunkId } = await setupTenFindingRun(
      "draft-loop-stage-valid-carrier-",
      async () => localCompletion(validProposal(chunkId), "valid-revised"),
    );

    try {
      const completed = await driver.resume(
        { root, runId: started.runId, allowProviderData: true },
        silent,
      );

      expect(completed.state).toBe("awaiting-approval");
      expect(completed.round).toBe(2);
      expect(completed.lastError).toBeNull();
      expect(completed.adjudicationRuntime?.trace?.valid).toBe(true);
      expect(completed.adjudicationRuntime?.trace?.effects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ findingId: "finding-accept-1", status: "overridden" }),
          expect.objectContaining({ findingId: "finding-accept-2", status: "overridden" }),
          expect.objectContaining({
            findingId: "finding-reject-1",
            status: "disagreement-preserved",
          }),
          expect.objectContaining({
            findingId: "finding-reject-2",
            status: "disagreement-preserved",
          }),
          expect.objectContaining({
            findingId: "finding-nuance-1",
            status: "disagreement-preserved",
          }),
        ]),
      );
      expect(completed.adjudicationRuntime?.trace?.effects).toHaveLength(10);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
