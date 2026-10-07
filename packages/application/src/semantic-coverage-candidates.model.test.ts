import { readFileSync } from "node:fs";

import {
  createOnnxTextEmbedder,
  type GraniteEmbeddingTier,
  type TextEmbedder,
} from "@draft-loop/embeddings";
import type { DraftArtifact } from "@draft-loop/schemas";
import { assessRequirementCoverage } from "@draft-loop/validation";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { attachSemanticCoverageCandidates } from "./semantic-coverage-candidates.js";

/*
 * Opt-in: runs the real local embedding model on the #727 fixture.
 *
 *   DRAFT_LOOP_EMBEDDING_MODEL_DIR=<installed model directory> \
 *   DRAFT_LOOP_EMBEDDING_TIER=311m|97m|eg2-text \
 *   pnpm vitest run packages/application/src/semantic-coverage-candidates.model.test.ts
 */

interface CoverageFixture {
  readonly blocks: readonly { readonly id: string; readonly text: string }[];
  readonly requirements: readonly {
    readonly id: string;
    readonly kind: string;
    readonly label: "covered" | "uncovered";
    readonly evidence: readonly string[];
    readonly text: string;
  }[];
}

const modelDirectory = process.env.DRAFT_LOOP_EMBEDDING_MODEL_DIR;
const tierValue = process.env.DRAFT_LOOP_EMBEDDING_TIER ?? "311m";
const tiers: readonly string[] = ["311m", "97m", "eg2-text"];

const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../evaluations/fixtures/requirement-coverage/semantic-coverage-cases.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as CoverageFixture;
const artifact = { sections: [{ blocks: fixture.blocks }] } as unknown as Pick<
  DraftArtifact,
  "sections"
>;

describe.skipIf(modelDirectory === undefined)(
  "semantic coverage candidates with a real model",
  () => {
    let embedder: TextEmbedder | undefined;

    beforeAll(async () => {
      if (!tiers.includes(tierValue)) {
        throw new Error(`DRAFT_LOOP_EMBEDDING_TIER must be one of ${tiers.join(", ")}.`);
      }
      embedder = await createOnnxTextEmbedder({
        modelDirectory: modelDirectory as string,
        tier: tierValue as GraniteEmbeddingTier,
      });
    }, 120_000);

    afterAll(async () => {
      await embedder?.dispose();
    });

    it("proposes the labelled evidence block for every lexically missed covered requirement", async () => {
      const baseline = assessRequirementCoverage(fixture.requirements, artifact);
      const result = await attachSemanticCoverageCandidates({
        assessments: baseline,
        requirements: fixture.requirements,
        artifact,
        embedder: embedder as TextEmbedder,
      });
      expect(result.candidatesAvailable).toBe(true);

      const byId = new Map(
        result.assessments.map((assessment) => [assessment.requirementId, assessment]),
      );
      const summary = fixture.requirements.map((requirement) => {
        const assessment = byId.get(requirement.id);
        return `${requirement.id} (${requirement.kind}) ${assessment?.status}/${assessment?.basis} ${
          assessment?.evidence
            .map((item) => `${item.blockId}${item.score === undefined ? "" : `:${item.score}`}`)
            .join(", ") ?? ""
        }`;
      });
      console.log(
        `tier ${tierValue}, floor ${JSON.stringify(result.floor)}\n${summary.join("\n")}`,
      );

      const lexicallyMissed = fixture.requirements.filter(
        (requirement) =>
          requirement.label === "covered" &&
          baseline.find((assessment) => assessment.requirementId === requirement.id)?.status ===
            "uncovered",
      );
      expect(lexicallyMissed.map((requirement) => requirement.id)).toEqual([
        "r1",
        "r2",
        "r3",
        "r4",
        "r5",
        "r6",
        "r7",
      ]);
      for (const requirement of lexicallyMissed) {
        const assessment = byId.get(requirement.id);
        expect(assessment?.status, `${requirement.id} status`).toBe("needs-judgement");
        const candidateIds = assessment?.evidence.map((item) => item.blockId) ?? [];
        expect(
          requirement.evidence.some((blockId) => candidateIds.includes(blockId)),
          `${requirement.id} labelled evidence ${requirement.evidence.join("+")} among candidates ${summary.find((line) => line.startsWith(`${requirement.id} `))}`,
        ).toBe(true);
      }

      for (const id of ["r13", "r14"]) {
        expect(byId.get(id)).toBe(baseline.find((assessment) => assessment.requirementId === id));
      }
    }, 120_000);
  },
);
