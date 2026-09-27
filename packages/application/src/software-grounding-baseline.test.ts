import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { replayRejectedAuthorCapture } from "./rejected-author-replay.js";

interface SourceChunk {
  readonly id: string;
  readonly text: string;
}

interface FixtureClaim {
  readonly id: string;
  readonly text: string;
  readonly evidenceChunkIds: readonly string[];
  readonly expectedSourceSupport: "supported" | "contradicted";
  readonly rationale: string;
  readonly expectedBoundary: "deterministic" | "semantic";
}

interface FixtureScenario {
  readonly id: string;
  readonly tags: readonly string[];
  readonly sourceChunks: readonly SourceChunk[];
  readonly claims: readonly FixtureClaim[];
}

interface GroundingFixture {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly provenance: {
    readonly kind: "synthetic";
    readonly containsRealCandidateRecord: false;
    readonly providerRunPerformed: false;
    readonly realApplicationOutcome: null;
  };
  readonly scenarios: readonly FixtureScenario[];
}

interface BaselineObservation {
  readonly scenarioId: string;
  readonly claimId: string;
  readonly status: "accepted" | "rejected";
  readonly diagnosticCodes: readonly string[];
}

interface GroundingBaseline {
  readonly schemaVersion: 1;
  readonly fixtureId: string;
  readonly boundary: "replayRejectedAuthorCapture";
  readonly generatedAt: string;
  readonly observations: readonly BaselineObservation[];
  readonly aggregate: {
    readonly claimCount: number;
    readonly supportedFalseRejections: number;
    readonly semanticClaimsAdmittedNeedingCritique: number;
    readonly deterministicContradictionsAccepted: number;
  };
  readonly limitations: readonly string[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../evaluations/fixtures/software-grounding-generalization/cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as GroundingFixture;
const baseline = JSON.parse(
  readFileSync(
    new URL(
      "../../evaluations/fixtures/software-grounding-generalization/baseline.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as GroundingBaseline;

const checksum = "c".repeat(64);

function replay(scenario: FixtureScenario, claim: FixtureClaim): BaselineObservation {
  const sourceById = new Map(scenario.sourceChunks.map((source) => [source.id, source] as const));
  const evidenceChunks = scenario.sourceChunks.map((source, ordinal) => ({
    id: `${scenario.id}-${source.id}`,
    workspaceId: "fictional-workspace",
    sourceId: `${scenario.id}-source`,
    ordinal,
    lineStart: ordinal + 1,
    lineEnd: ordinal + 1,
    checksum,
    text: source.text,
    rank: ordinal,
  }));
  const citationIds = claim.evidenceChunkIds.map((id) => `${scenario.id}-${id}`);
  if (claim.evidenceChunkIds.some((id) => !sourceById.has(id))) {
    throw new Error(`fixture citation is missing in ${scenario.id}/${claim.id}`);
  }

  const capture = {
    schemaVersion: 1,
    capturedAt: "2026-09-28T00:00:00.000Z",
    provider: "local",
    modelId: "fictional-provider-free-baseline",
    failureStage: "factual-invariant-rejection",
    diagnostics: [],
    validationInputs: {
      executionId: `synthetic-${scenario.id}-${claim.id}`,
      context: {
        language: "en",
        evidenceManifest: [
          {
            id: `${scenario.id}-source`,
            path: `/fictional/${scenario.id}.txt`,
            checksum,
          },
        ],
      },
      retrievedEvidence: evidenceChunks,
      requiredSections: [],
      currentArtifact: null,
      createdAt: "2026-09-28T00:00:00.000Z",
      proposal: {
        sections: [
          {
            title: "Experience",
            kind: "experience",
            blocks: [
              {
                type: "paragraph",
                text: claim.text,
                claims: [{ text: claim.text, substantive: true, evidenceChunkIds: citationIds }],
              },
            ],
          },
        ],
      },
    },
  };
  const result = replayRejectedAuthorCapture(capture);
  return {
    scenarioId: scenario.id,
    claimId: claim.id,
    status: result.status,
    diagnosticCodes:
      result.status === "rejected"
        ? [...new Set(result.diagnostics.map(({ code }) => code))].sort()
        : [],
  };
}

function summarize(observations: readonly BaselineObservation[]) {
  const expectations = new Map(
    fixture.scenarios.flatMap((scenario) =>
      scenario.claims.map((claim) => [`${scenario.id}/${claim.id}`, claim] as const),
    ),
  );
  const claimFor = (observation: BaselineObservation) => {
    const claim = expectations.get(`${observation.scenarioId}/${observation.claimId}`);
    if (claim === undefined) throw new Error("baseline contains an unknown claim");
    return claim;
  };
  return {
    claimCount: observations.length,
    supportedFalseRejections: observations.filter(
      (observation) =>
        claimFor(observation).expectedSourceSupport === "supported" &&
        observation.status === "rejected",
    ).length,
    semanticClaimsAdmittedNeedingCritique: observations.filter(
      (observation) =>
        claimFor(observation).expectedSourceSupport === "contradicted" &&
        claimFor(observation).expectedBoundary === "semantic" &&
        observation.status === "accepted",
    ).length,
    deterministicContradictionsAccepted: observations.filter(
      (observation) =>
        claimFor(observation).expectedSourceSupport === "contradicted" &&
        claimFor(observation).expectedBoundary === "deterministic" &&
        observation.status === "accepted",
    ).length,
  };
}

function validateFixture(): void {
  expect(fixture.schemaVersion).toBe(1);
  expect(fixture.provenance).toMatchObject({
    kind: "synthetic",
    containsRealCandidateRecord: false,
    providerRunPerformed: false,
    realApplicationOutcome: null,
  });
  expect(fixture.scenarios).toHaveLength(7);

  const scenarioIds = fixture.scenarios.map(({ id }) => id);
  expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
  const requiredTags = [
    "unfamiliar-technology",
    "consulting",
    "study",
    "shared-contribution",
    "staging",
    "career-gap",
    "bootcamp",
  ];
  const tags = new Set(fixture.scenarios.flatMap(({ tags: scenarioTags }) => scenarioTags));
  for (const tag of requiredTags) expect(tags.has(tag), tag).toBe(true);

  for (const scenario of fixture.scenarios) {
    expect(scenario.claims, scenario.id).toHaveLength(2);
    expect(new Set(scenario.sourceChunks.map(({ id }) => id)).size).toBe(
      scenario.sourceChunks.length,
    );
    expect(new Set(scenario.claims.map(({ id }) => id)).size).toBe(2);
    expect(
      scenario.claims.map(({ expectedSourceSupport }) => expectedSourceSupport).sort(),
    ).toEqual(["contradicted", "supported"]);
    const sourceIds = new Set(scenario.sourceChunks.map(({ id }) => id));
    for (const claim of scenario.claims) {
      expect(claim.evidenceChunkIds.length, `${scenario.id}/${claim.id}`).toBeGreaterThan(0);
      expect(claim.evidenceChunkIds.every((id) => sourceIds.has(id))).toBe(true);
      for (const citedId of claim.evidenceChunkIds) expect(claim.rationale).toContain(citedId);
      expect(["deterministic", "semantic"]).toContain(claim.expectedBoundary);
    }
  }
}

describe("fictional software-grounding generalization baseline", () => {
  it("keeps paired source expectations and citations closed over the fixture", () => {
    validateFixture();
  });

  it("reproduces the committed current validator observations at the normal local boundary", () => {
    const observations = fixture.scenarios.flatMap((scenario) =>
      scenario.claims.map((claim) => replay(scenario, claim)),
    );

    console.log(JSON.stringify(summarize(observations)));
    expect(baseline.schemaVersion).toBe(1);
    expect(baseline.fixtureId).toBe(fixture.id);
    expect(baseline.boundary).toBe("replayRejectedAuthorCapture");
    expect(observations).toEqual(baseline.observations);
    expect(summarize(observations)).toEqual(baseline.aggregate);
  });
});
