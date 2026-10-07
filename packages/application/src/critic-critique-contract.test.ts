import type { JsonObject } from "@draft-loop/providers";
import { maximumCoverageJudgementRequests } from "@draft-loop/validation";
import { describe, expect, it } from "vitest";

import { CliUserError } from "./cli-user-error.js";
import {
  coverageJudgementInstructionsVersion,
  createCriticAdjudicationPrompt,
  maximumCritiqueFindings,
  maximumCritiqueMessageCharacters,
} from "./critic-adjudication.js";
import {
  coverageJudgementPromptRequests,
  criticCoverageJudgementParts,
  critiqueOutputSchema,
  critiqueOutputSchemaWithCoverageJudgements,
  maximumCoverageJudgementCandidateBlocks,
  parseCritique,
} from "./critic-critique-contract.js";

/** The critique schema exactly as it was recorded before coverage judgements existed. */
const recordedCritiqueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          code: { type: "string" },
          category: {
            type: "string",
            enum: ["format", "factuality", "coverage", "evidence", "quality"],
          },
          severity: { type: "string", enum: ["error", "warning"] },
          message: { type: "string" },
        },
        required: ["id", "code", "category", "severity", "message"],
      },
    },
  },
  required: ["findings"],
};

const context = {
  requirements: [
    { id: "req-1", text: "Led a platform team", priority: "high" },
    { id: "req-2", text: "Reduced cloud cost", priority: "medium" },
  ],
} as never;

const artifact = {
  sections: [
    {
      blocks: [
        { id: "b1", text: "Managed six engineers." },
        { id: "b2", text: "Cut spend by a third." },
        { id: "b3", text: "Ran hiring." },
        { id: "b4", text: "Mentored juniors." },
        { id: "b5", text: "Owned the roadmap." },
      ],
    },
    { blocks: [{ id: "b6", text: "Wrote runbooks." }] },
  ],
} as never;

const finding = {
  id: "f1",
  code: "coverage-gap",
  category: "coverage",
  severity: "warning",
  message: "A gap.",
};

const judgement = {
  requirementId: "req-1",
  verdict: "satisfied",
  citedBlockIds: ["b1"],
  rationale: "The block states the team lead role.",
};

describe("critique schema", () => {
  it("keeps the recorded schema unchanged", () => {
    expect(JSON.stringify(critiqueOutputSchema)).toBe(JSON.stringify(recordedCritiqueSchema));
  });

  it("builds a strict-mode variant that lists every property as required", () => {
    const schema = critiqueOutputSchemaWithCoverageJudgements as {
      properties: Record<string, { items?: Record<string, unknown>; maxItems?: number }>;
      required: string[];
      additionalProperties: boolean;
    };

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).toEqual(["findings", "coverageJudgements"]);
    expect(schema.required).toEqual(["findings", "coverageJudgements"]);
    expect(schema.properties.findings).toEqual(recordedCritiqueSchema.properties.findings);
    const judgements = schema.properties.coverageJudgements;
    expect(judgements?.maxItems).toBe(maximumCoverageJudgementRequests);
    expect(judgements?.items).toMatchObject({
      additionalProperties: false,
      required: ["requirementId", "verdict", "citedBlockIds", "rationale"],
    });
    const properties = judgements?.items?.properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(properties).sort()).toEqual(
      ["citedBlockIds", "rationale", "requirementId", "verdict"].sort(),
    );
    expect(properties.verdict).toEqual({ type: "string", enum: ["satisfied", "not-satisfied"] });
    expect(properties.citedBlockIds).toMatchObject({
      type: "array",
      maxItems: maximumCoverageJudgementCandidateBlocks,
    });
    expect(critiqueOutputSchema).toEqual(recordedCritiqueSchema);
  });
});

describe("coverage judgement request rendering", () => {
  it("leaves prompt, input, and schema untouched without requests", () => {
    const base = createCriticAdjudicationPrompt("cli-critic-v3");
    for (const requests of [undefined, []]) {
      const parts = criticCoverageJudgementParts(requests, context, artifact);

      expect(parts.systemPrompt(base)).toBe(base);
      expect(parts.input).toEqual({});
      expect(parts.outputSchema).toBe(critiqueOutputSchema);
      expect(parts.instructionsVersion).toBeUndefined();
    }
  });

  it("renders resolved requirement and block texts and switches schema and prompt", () => {
    const base = createCriticAdjudicationPrompt("cli-critic-v3");
    const parts = criticCoverageJudgementParts(
      [{ requirementId: "req-1", candidateBlockIds: ["b1", "b6"] }],
      context,
      artifact,
    );

    expect(parts.systemPrompt(base).startsWith(`${base}\n\nCoverage judgement (`)).toBe(true);
    expect(parts.input).toEqual({
      coverageJudgementRequests: [
        {
          requirementId: "req-1",
          requirement: "Led a platform team",
          candidates: [
            { blockId: "b1", text: "Managed six engineers." },
            { blockId: "b6", text: "Wrote runbooks." },
          ],
        },
      ],
    });
    expect(parts.outputSchema).toBe(critiqueOutputSchemaWithCoverageJudgements);
    expect(parts.instructionsVersion).toBe(coverageJudgementInstructionsVersion);
  });

  it("bounds candidates per request, deduplicates, and drops unresolved blocks", () => {
    const [request] = coverageJudgementPromptRequests(
      [{ requirementId: "req-2", candidateBlockIds: ["missing", "b2", "b2", "b3", "b4", "b5"] }],
      context,
      artifact,
    );

    expect(request?.candidates).toEqual([
      { blockId: "b2", text: "Cut spend by a third." },
      { blockId: "b3", text: "Ran hiring." },
      { blockId: "b4", text: "Mentored juniors." },
    ]);
  });

  it("drops requests whose requirement or blocks cannot be resolved", () => {
    const requests = coverageJudgementPromptRequests(
      [
        { requirementId: "unknown", candidateBlockIds: ["b1"] },
        { requirementId: "req-1", candidateBlockIds: ["missing"] },
        { requirementId: "req-2", candidateBlockIds: ["b2"] },
      ],
      context,
      artifact,
    );

    expect(requests.map((request) => request.requirementId)).toEqual(["req-2"]);
  });

  it("falls back to the unchanged critic call when nothing resolves", () => {
    const parts = criticCoverageJudgementParts(
      [{ requirementId: "unknown", candidateBlockIds: ["b1"] }],
      context,
      artifact,
    );

    expect(parts.outputSchema).toBe(critiqueOutputSchema);
    expect(parts.input).toEqual({});
    expect(parts.instructionsVersion).toBeUndefined();
  });

  it("caps the number of requests", () => {
    const many = {
      requirements: Array.from({ length: 12 }, (_, index) => ({
        id: `r${index}`,
        text: `Requirement ${index}`,
        priority: "low",
      })),
    } as never;
    const requests = Array.from({ length: 12 }, (_, index) => ({
      requirementId: `r${index}`,
      candidateBlockIds: ["b1"],
    }));

    expect(coverageJudgementPromptRequests(requests, many, artifact)).toHaveLength(
      maximumCoverageJudgementRequests,
    );
  });
});

describe("critique parsing", () => {
  it("returns only findings when no judgements are present", () => {
    const critique = parseCritique({ findings: [finding] } as unknown as JsonObject);

    expect(critique).toEqual({ findings: [finding] });
    expect(critique).not.toHaveProperty("coverageJudgements");
    expect(critique).not.toHaveProperty("coverageJudgementInstructionsVersion");
  });

  it("attaches valid judgements and the instruction version", () => {
    const critique = parseCritique(
      { findings: [], coverageJudgements: [judgement] } as unknown as JsonObject,
      coverageJudgementInstructionsVersion,
    );

    expect(critique.coverageJudgements).toEqual([judgement]);
    expect(critique.coverageJudgementInstructionsVersion).toBe("coverage-judgement-v1");
  });

  it("keeps an empty judgement list distinct from an absent one", () => {
    const critique = parseCritique({ findings: [], coverageJudgements: [] } as never);

    expect(critique.coverageJudgements).toEqual([]);
  });

  it("drops malformed judgements individually and keeps findings", () => {
    const critique = parseCritique({
      findings: [finding],
      coverageJudgements: [
        judgement,
        { ...judgement, requirementId: "req-2" },
        "not an object",
        { ...judgement, requirementId: 3 },
        { ...judgement, verdict: true },
        { ...judgement, citedBlockIds: "b1" },
        { ...judgement, citedBlockIds: ["a", "b", "c", "d"] },
        { ...judgement, rationale: undefined },
      ],
    } as never);

    expect(critique.findings).toHaveLength(1);
    expect(critique.coverageJudgements).toEqual([
      judgement,
      { ...judgement, requirementId: "req-2" },
    ]);
  });

  it("drops judgements with non-string citations or a missing list", () => {
    const critique = parseCritique({
      findings: [],
      coverageJudgements: [
        null,
        { ...judgement, citedBlockIds: ["b1", 2] },
        { requirementId: "req-1", verdict: "satisfied", rationale: "No citations field." },
      ],
    } as never);

    expect(critique.coverageJudgements).toEqual([]);
  });

  it("leaves semantic checks to the validator", () => {
    const outside = {
      ...judgement,
      verdict: "maybe",
      citedBlockIds: ["elsewhere"],
      rationale: "x".repeat(500),
    };
    const critique = parseCritique({ findings: [], coverageJudgements: [outside] } as never);

    expect(critique.coverageJudgements).toEqual([outside]);
  });

  it("truncates judgements beyond the cap", () => {
    const critique = parseCritique({
      findings: [],
      coverageJudgements: Array.from({ length: 12 }, (_, index) => ({
        ...judgement,
        requirementId: `r${index}`,
      })),
    } as never);

    expect(critique.coverageJudgements).toHaveLength(maximumCoverageJudgementRequests);
  });

  it("ignores a judgement field that is not a list", () => {
    const critique = parseCritique({ findings: [], coverageJudgements: "satisfied" } as never);

    expect(critique).not.toHaveProperty("coverageJudgements");
  });

  it("still rejects invalid findings as before", () => {
    const withJudgements = { coverageJudgements: [judgement] };
    expect(() => parseCritique({ ...withJudgements } as never)).toThrow(CliUserError);
    expect(() => parseCritique({ findings: "x", ...withJudgements } as never)).toThrow(
      "invalid findings list",
    );
    expect(() => parseCritique({ findings: [1], ...withJudgements } as never)).toThrow(
      "invalid finding.",
    );
    expect(() =>
      parseCritique({ findings: [{ ...finding, id: " " }], ...withJudgements } as never),
    ).toThrow("incomplete finding");
    expect(() =>
      parseCritique({
        findings: [{ ...finding, message: "x".repeat(maximumCritiqueMessageCharacters + 1) }],
      } as never),
    ).toThrow("excessively long");
    expect(() =>
      parseCritique({
        findings: Array.from({ length: maximumCritiqueFindings + 1 }, () => finding),
      } as never),
    ).toThrow("too many findings");
  });
});
