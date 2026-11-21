import { readFileSync, writeFileSync } from "node:fs";

import {
  type RequirementEvidenceArm,
  type RequirementEvidenceFixture,
  requirementEvidenceCorpus,
  runRequirementEvidenceComparison,
} from "@draft-loop/evaluations";
import { openSqliteStorage } from "@draft-loop/storage";
import { describe, expect, it } from "vitest";

import { replayRejectedAuthorCapture } from "./rejected-author-replay.js";
import { pickRequirementEvidence } from "./requirement-picked-evidence.js";
import { matchesRequiredSectionEvidence } from "./required-section-evidence.js";

/**
 * Baseline for roles outside software (#3087, rollup #3086). Fictional cases for a nurse, an
 * account executive, a primary teacher and an electrician run through the deterministic checks:
 * grounding, requirement-to-evidence retrieval and required-section evidence. No model is called.
 *
 * `baseline.json` records today's results, known failures included. A change that fixes one
 * (#3088, #3089) updates the baseline in the same PR. To rewrite it after such a fix:
 *
 *   DRAFT_LOOP_WRITE_NON_TECH_BASELINE=1 pnpm exec vitest run \
 *     packages/application/src/non-tech-cohort-baseline.test.ts
 */

const fixtureUrl = (name: string) =>
  new URL(`../../evaluations/fixtures/non-tech-cohort/${name}`, import.meta.url);
const readJson = <T>(name: string): T => JSON.parse(readFileSync(fixtureUrl(name), "utf8")) as T;

type Support = "supported" | "contradicted";

interface GroundingScenario {
  readonly id: string;
  readonly role: string;
  readonly sourceChunks: readonly { readonly id: string; readonly text: string }[];
  readonly claims: readonly {
    readonly id: string;
    readonly text: string;
    readonly evidenceChunkIds: readonly string[];
    readonly expectedSourceSupport: Support;
    readonly rationale: string;
  }[];
}

interface GroundingFixture {
  readonly schemaVersion: 1;
  readonly provenance: {
    readonly kind: "synthetic";
    readonly containsRealCandidateRecord: false;
    readonly providerRunPerformed: false;
  };
  readonly scenarios: readonly GroundingScenario[];
}

interface SectionFixture {
  readonly cases: readonly {
    readonly id: string;
    readonly section: string;
    readonly text: string;
  }[];
}

interface Baseline {
  readonly grounding: readonly {
    readonly id: string;
    readonly expected: Support;
    readonly status: "accepted" | "rejected";
  }[];
  readonly groundingSummary: {
    readonly claims: number;
    readonly supportedRejected: number;
    readonly contradictedAccepted: number;
  };
  readonly retrieval: {
    readonly picksRecall: number;
    readonly bm25Recall: number;
    readonly missedByBoth: readonly string[];
  };
  readonly sections: readonly { readonly id: string; readonly recognised: boolean }[];
}

const grounding = readJson<GroundingFixture>("grounding-cases.json");
const retrievalFixture = readJson<RequirementEvidenceFixture>("requirement-evidence-cases.json");
const sectionFixture = readJson<SectionFixture>("section-evidence-cases.json");
const baselineName = "baseline.json";

const checksum = "c".repeat(64);
const timestamp = "2026-11-21T00:00:00.000Z";
const workspaceId = "fictional-non-tech-cohort";
const sourceId = "fictional-non-tech-cohort-source";

function replayClaim(
  scenario: GroundingScenario,
  claim: GroundingScenario["claims"][number],
): "accepted" | "rejected" {
  const result = replayRejectedAuthorCapture({
    schemaVersion: 1,
    capturedAt: timestamp,
    provider: "local",
    modelId: "fictional-provider-free-baseline",
    failureStage: "factual-invariant-rejection",
    diagnostics: [],
    validationInputs: {
      executionId: `synthetic-${scenario.id}-${claim.id}`,
      context: {
        language: "en",
        evidenceManifest: [
          { id: `${scenario.id}-source`, path: `/fictional/${scenario.id}.txt`, checksum },
        ],
      },
      retrievedEvidence: scenario.sourceChunks.map((source, ordinal) => ({
        id: `${scenario.id}-${source.id}`,
        workspaceId: "fictional-workspace",
        sourceId: `${scenario.id}-source`,
        ordinal,
        lineStart: ordinal + 1,
        lineEnd: ordinal + 1,
        checksum,
        text: source.text,
        rank: ordinal,
      })),
      requiredSections: [],
      currentArtifact: null,
      createdAt: timestamp,
      proposal: {
        sections: [
          {
            title: "Experience",
            kind: "experience",
            blocks: [
              {
                type: "paragraph",
                text: claim.text,
                claims: [
                  {
                    text: claim.text,
                    substantive: true,
                    evidenceChunkIds: claim.evidenceChunkIds.map((id) => `${scenario.id}-${id}`),
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });
  return result.status;
}

async function retrievalResults(): Promise<Baseline["retrieval"]> {
  const corpus = requirementEvidenceCorpus(retrievalFixture, { workspaceId, sourceId, checksum });
  const picks: RequirementEvidenceArm = async (requirement, limit) =>
    pickRequirementEvidence({
      eligible: corpus,
      selected: [],
      requirements: [requirement],
      budgetCharacters: Number.MAX_SAFE_INTEGER,
    }).slice(0, limit);
  const storage = openSqliteStorage(":memory:");
  try {
    await storage.saveWorkspace({
      id: workspaceId,
      state: "collecting",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await storage.saveEvidenceSource({
      id: sourceId,
      workspaceId,
      path: "fixture://fictional/non-tech-cohort",
      mediaType: "text/markdown",
      checksum,
      createdAt: timestamp,
    });
    for (const chunk of corpus) {
      const { rank: _rank, ...record } = chunk;
      await storage.saveEvidenceChunk({ ...record, createdAt: timestamp });
    }
    const lexical: RequirementEvidenceArm = (requirement, limit) =>
      storage.queryEvidence(requirement, { workspaceId, limit });
    const report = await runRequirementEvidenceComparison({
      fixture: retrievalFixture,
      corpus,
      picks,
      lexical,
    });
    const missed = (cases: typeof report.arms.picks.cases) =>
      new Set(cases.filter(({ found }) => found === 0).map(({ id }) => id));
    const picksMissed = missed(report.arms.picks.cases);
    return {
      picksRecall: round(report.arms.picks.metrics.recall),
      bm25Recall: round(report.arms.bm25.metrics.recall),
      missedByBoth: [...missed(report.arms.bm25.cases)].filter((id) => picksMissed.has(id)).sort(),
    };
  } finally {
    await storage.close();
  }
}

async function observe(): Promise<Baseline> {
  const observations = grounding.scenarios.flatMap((scenario) =>
    scenario.claims.map((claim) => ({
      id: `${scenario.id}/${claim.id}`,
      expected: claim.expectedSourceSupport,
      status: replayClaim(scenario, claim),
    })),
  );
  return {
    grounding: observations,
    groundingSummary: {
      claims: observations.length,
      supportedRejected: observations.filter(
        ({ expected, status }) => expected === "supported" && status === "rejected",
      ).length,
      contradictedAccepted: observations.filter(
        ({ expected, status }) => expected === "contradicted" && status === "accepted",
      ).length,
    },
    retrieval: await retrievalResults(),
    sections: sectionFixture.cases.map(({ id, section, text }) => ({
      id,
      recognised: matchesRequiredSectionEvidence(section, text),
    })),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

describe("non-tech cohort fixtures", () => {
  it("stay fictional and closed over their own ids", () => {
    expect(grounding.schemaVersion).toBe(1);
    expect(grounding.provenance).toMatchObject({
      kind: "synthetic",
      containsRealCandidateRecord: false,
      providerRunPerformed: false,
    });
    expect(new Set(grounding.scenarios.map(({ role }) => role))).toEqual(
      new Set(["nurse", "account-executive", "primary-teacher", "electrician"]),
    );
    for (const scenario of grounding.scenarios) {
      const sourceIds = new Set(scenario.sourceChunks.map(({ id }) => id));
      const supports = new Set(
        scenario.claims.map(({ expectedSourceSupport }) => expectedSourceSupport),
      );
      expect(supports, scenario.id).toEqual(new Set(["supported", "contradicted"]));
      for (const claim of scenario.claims) {
        for (const id of claim.evidenceChunkIds) {
          expect(sourceIds.has(id), `${scenario.id}/${claim.id}`).toBe(true);
          expect(claim.rationale).toContain(id);
        }
      }
    }

    const corpusIds = new Set(retrievalFixture.corpus.map(({ id }) => id));
    const labelled = retrievalFixture.cases.flatMap(
      ({ groundTruthEvidenceIds }) => groundTruthEvidenceIds,
    );
    expect(retrievalFixture.cases).toHaveLength(16);
    for (const id of labelled) expect(corpusIds.has(id), id).toBe(true);
    expect(new Set(sectionFixture.cases.map(({ id }) => id)).size).toBe(
      sectionFixture.cases.length,
    );
  });
});

describe("non-tech cohort baseline", () => {
  it("matches today's recorded results, known failures included", async () => {
    const observed = await observe();
    if (process.env.DRAFT_LOOP_WRITE_NON_TECH_BASELINE === "1") {
      writeFileSync(fixtureUrl(baselineName), `${JSON.stringify(observed, null, 2)}\n`);
    }
    expect(observed).toEqual(readJson<Baseline>(baselineName));
  });
});
