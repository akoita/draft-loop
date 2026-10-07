import { readFileSync } from "node:fs";

import {
  type EmbeddingModelIdentity,
  getGraniteEmbeddingModel,
  type SemanticRelevanceFloor,
  type TextEmbedder,
} from "@draft-loop/embeddings";
import type { DraftArtifact } from "@draft-loop/schemas";
import { assessRequirementCoverage } from "@draft-loop/validation";
import { describe, expect, it } from "vitest";

import {
  attachSemanticCoverageCandidates,
  semanticCandidateRationale,
} from "./semantic-coverage-candidates.js";

interface CoverageFixture {
  readonly blocks: readonly { readonly id: string; readonly text: string }[];
  readonly requirements: readonly { readonly id: string; readonly text: string }[];
}

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../evaluations/fixtures/requirement-coverage/semantic-coverage-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as CoverageFixture;

const artifact = {
  sections: [{ blocks: fixture.blocks }],
} as unknown as Pick<DraftArtifact, "sections">;

const calibratedFloor: SemanticRelevanceFloor = { maxMarginFromTop: 0.05, minimumScore: 0.68 };

/**
 * Block vectors are one-hot axes; a requirement vector is built from chosen cosines to blocks plus a
 * residual axis so it stays unit length. The cosines mirror the EmbeddingGemma 2 pattern measured
 * on this fixture (#727).
 */
const requirementCosines: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  r1: { "b-lead": 0.786, "b-mentor": 0.6 },
  r2: { "b-cost": 0.821 },
  r3: { "b-oncall": 0.765 },
  r4: { "b-migration": 0.72, "b-skills": 0.69 },
  r5: { "b-lead": 0.7, "b-mentor": 0.7 },
  r6: { "b-fr": 0.809 },
  r7: { "b-stakeholders": 0.744 },
  r8: { "b-course": 0.742 },
  r9: { "b-course": 0.641 },
  r11: { "b-hobby": 0.753 },
  r12: { "b-course": 0.74 },
};

const fakeIdentity: EmbeddingModelIdentity = {
  modelId: "fake-model",
  sourceRepository: "example/fake",
  revision: "rev-1",
  modelFileSha256: "a".repeat(64),
  dimensions: 8,
  pooling: "cls",
  runtime: "fake-runtime",
};

interface FakeOptions {
  readonly identity?: EmbeddingModelIdentity;
  readonly cosines?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly onEmbed?: () => void;
}

function createFakeEmbedder(options: FakeOptions = {}): TextEmbedder & {
  readonly calls: { readonly role: string; readonly count: number }[];
} {
  const cosines = options.cosines ?? requirementCosines;
  const axes = fixture.blocks.length + 1;
  const calls: { role: string; count: number }[] = [];
  return {
    identity: options.identity ?? fakeIdentity,
    calls,
    embed: async (texts, role) => {
      options.onEmbed?.();
      calls.push({ role, count: texts.length });
      return texts.map((text) => {
        const vector = new Float32Array(axes);
        const blockIndex = fixture.blocks.findIndex((block) => block.text === text);
        if (blockIndex >= 0) {
          vector[blockIndex] = 1;
          return vector;
        }
        const requirement = fixture.requirements.find((candidate) => candidate.text === text);
        const requirementCos = cosines[requirement?.id ?? ""] ?? {};
        let squares = 0;
        for (const [blockId, cosine] of Object.entries(requirementCos)) {
          vector[fixture.blocks.findIndex((block) => block.id === blockId)] = cosine;
          squares += cosine * cosine;
        }
        vector[axes - 1] = Math.sqrt(1 - squares);
        return vector;
      });
    },
    dispose: async () => undefined,
  };
}

const explicitGapIds = new Set(["r10"]);
const baseline = assessRequirementCoverage(fixture.requirements, artifact, explicitGapIds);

function assessmentFor(
  assessments: readonly { readonly requirementId: string }[],
  id: string,
): ReturnType<typeof assessRequirementCoverage>[number] {
  const found = assessments.find((assessment) => assessment.requirementId === id);
  if (found === undefined) throw new Error(`Missing assessment ${id}.`);
  return found as ReturnType<typeof assessRequirementCoverage>[number];
}

function run(overrides: Partial<Parameters<typeof attachSemanticCoverageCandidates>[0]> = {}) {
  return attachSemanticCoverageCandidates({
    assessments: baseline,
    requirements: fixture.requirements,
    artifact,
    embedder: createFakeEmbedder(),
    floor: calibratedFloor,
    ...overrides,
  });
}

describe("attachSemanticCoverageCandidates", () => {
  it("leaves lexically covered, protected, and explicit-gap assessments identical", async () => {
    const result = await run();

    for (const id of ["r15", "r16", "r13", "r14", "r10"]) {
      expect(assessmentFor(result.assessments, id)).toBe(assessmentFor(baseline, id));
    }
    expect(assessmentFor(baseline, "r13").basis).toBe("protected-rule");
    expect(assessmentFor(baseline, "r14").basis).toBe("protected-rule");
    expect(assessmentFor(baseline, "r10").status).toBe("explicit-gap");
    expect(result.assessments.map((assessment) => assessment.requirementId)).toEqual(
      baseline.map((assessment) => assessment.requirementId),
    );
  });

  it("turns eligible requirements above the floor into sorted needs-judgement candidates", async () => {
    const result = await run();
    expect(result.candidatesAvailable).toBe(true);
    expect(result.floor).toEqual(calibratedFloor);

    for (const id of ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r11", "r12"]) {
      const assessment = assessmentFor(result.assessments, id);
      expect(assessment.status).toBe("needs-judgement");
      expect(assessment.basis).toBe("semantic-candidate");
      expect(assessment.rationale).toBe(semanticCandidateRationale);
      expect(assessment.evidence.length).toBeGreaterThanOrEqual(1);
      expect(assessment.evidence.length).toBeLessThanOrEqual(3);
      const scores = assessment.evidence.map((item) => item.score as number);
      expect(scores).toEqual([...scores].sort((left, right) => right - left));
      for (const score of scores) {
        expect(score).toBeGreaterThanOrEqual(-1);
        expect(score).toBeLessThanOrEqual(1);
        expect(Math.round(score * 1000) / 1000).toBe(score);
      }
      const requirement = fixture.requirements.find((item) => item.id === id);
      expect(assessment.rationale).not.toContain(requirement?.text ?? "unreachable");
      expect(Object.isFrozen(assessment)).toBe(true);
    }
    expect(assessmentFor(result.assessments, "r1").evidence).toEqual([
      { blockId: "b-lead", score: 0.786 },
    ]);
    expect(assessmentFor(result.assessments, "r4").evidence).toEqual([
      { blockId: "b-migration", score: 0.72 },
      { blockId: "b-skills", score: 0.69 },
    ]);
  });

  it("orders equal scores by block id", async () => {
    const result = await run();
    expect(assessmentFor(result.assessments, "r5").evidence.map((item) => item.blockId)).toEqual([
      "b-lead",
      "b-mentor",
    ]);
  });

  it("keeps requirements with no block above the floor uncovered", async () => {
    const result = await run();
    expect(assessmentFor(result.assessments, "r9")).toBe(assessmentFor(baseline, "r9"));
    expect(assessmentFor(result.assessments, "r9").status).toBe("uncovered");
  });

  it("caps candidates at maxCandidates", async () => {
    const cosines = { r1: { "b-lead": 0.5, "b-mentor": 0.45, "b-cost": 0.4, "b-data": 0.35 } };
    const wide: SemanticRelevanceFloor = { maxMarginFromTop: 0.5, minimumScore: 0.2 };
    const embedder = createFakeEmbedder({ cosines });

    const defaulted = await run({ embedder, floor: wide });
    expect(assessmentFor(defaulted.assessments, "r1").evidence.map((item) => item.blockId)).toEqual(
      ["b-lead", "b-mentor", "b-cost"],
    );
    const capped = await run({ embedder, floor: wide, maxCandidates: 2 });
    expect(assessmentFor(capped.assessments, "r1").evidence.map((item) => item.blockId)).toEqual([
      "b-lead",
      "b-mentor",
    ]);
  });

  it("embeds blocks and eligible requirements once each", async () => {
    const embedder = createFakeEmbedder();
    await run({ embedder });
    expect(embedder.calls).toEqual([
      { role: "document", count: fixture.blocks.length },
      { role: "query", count: 11 },
    ]);
  });

  it("uses the calibrated floor of a pinned model identity", async () => {
    const model = getGraniteEmbeddingModel("eg2-text");
    const embedder = createFakeEmbedder({
      identity: { ...fakeIdentity, modelId: model.modelId, dimensions: model.nativeDimensions },
    });
    const result = await attachSemanticCoverageCandidates({
      assessments: baseline,
      requirements: fixture.requirements,
      artifact,
      embedder,
    });
    expect(result.floor).toEqual({ maxMarginFromTop: 0.05, minimumScore: 0.68 });
    expect(result.candidatesAvailable).toBe(true);
    expect(assessmentFor(result.assessments, "r1").status).toBe("needs-judgement");
  });

  it("creates no candidates for an uncalibrated model without an explicit floor", async () => {
    const embedder = createFakeEmbedder();
    const result = await attachSemanticCoverageCandidates({
      assessments: baseline,
      requirements: fixture.requirements,
      artifact,
      embedder,
    });
    expect(result.assessments).toBe(baseline);
    expect(result.candidatesAvailable).toBe(false);
    expect(result.floor).toBeNull();
    expect(embedder.calls).toEqual([]);
  });

  it("returns the original assessments when the embedder fails", async () => {
    const embedder = createFakeEmbedder({
      onEmbed: () => {
        throw new Error("runtime failed");
      },
    });
    const result = await run({ embedder });
    expect(result.assessments).toBe(baseline);
    expect(result.candidatesAvailable).toBe(false);
  });

  it("rethrows an abort instead of swallowing it", async () => {
    const controller = new AbortController();
    const embedder = createFakeEmbedder({
      onEmbed: () => {
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      },
    });
    await expect(run({ embedder, signal: controller.signal })).rejects.toThrow();

    const aborted = new AbortController();
    aborted.abort();
    await expect(run({ signal: aborted.signal })).rejects.toThrow();
  });

  it("changes nothing when there is nothing eligible", async () => {
    const embedder = createFakeEmbedder();
    const lexicalOnly = baseline.filter((assessment) => assessment.status === "covered");
    const result = await run({ assessments: lexicalOnly, embedder });
    expect(result.assessments).toStrictEqual(lexicalOnly);
    expect(result.candidatesAvailable).toBe(true);
    expect(embedder.calls).toEqual([]);
  });
});
