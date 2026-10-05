import { canonicalCandidateProfileExtractionProposalJsonSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { normalizeAnthropicOutputSchema } from "./anthropic-output-schema.js";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a JSON object in the test fixture.");
  }
  return value as Record<string, unknown>;
}

describe("Anthropic structured output schema", () => {
  it("uses the SDK transform on the canonical extraction schema without mutating it", () => {
    const original = structuredClone(canonicalCandidateProfileExtractionProposalJsonSchema);
    const format = normalizeAnthropicOutputSchema(
      canonicalCandidateProfileExtractionProposalJsonSchema,
    );
    const serializedFormat = JSON.parse(JSON.stringify(format)) as unknown;
    const schema = record(format.schema);
    const properties = record(schema.properties);
    const facts = record(properties.facts);
    const fact = record(facts.items);
    const factProperties = record(fact.properties);
    const evidence = record(factProperties.evidence);
    const evidenceItem = record(evidence.items);

    expect(format.type).toBe("json_schema");
    expect(Object.keys(format).sort()).toEqual(["schema", "type"]);
    expect(serializedFormat).toEqual(format);
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "facts", "issues"],
    });
    expect(facts).not.toHaveProperty("maxItems");
    expect(facts.description).toContain("maxItems: 2048");
    expect(fact).toMatchObject({ type: "object", additionalProperties: false });
    expect(fact.required).toEqual(["key", "category", "field", "value", "evidence"]);
    expect(evidence).toMatchObject({ type: "array", minItems: 1 });
    expect(evidence).not.toHaveProperty("maxItems");
    expect(evidence.description).toMatch(/maxItems: \d+/u);
    expect(evidenceItem).toMatchObject({ type: "object", additionalProperties: false });
    expect(canonicalCandidateProfileExtractionProposalJsonSchema).toEqual(original);
  });

  it("preserves an existing description while folding unsupported constraints into it", () => {
    const schema = structuredClone(
      canonicalCandidateProfileExtractionProposalJsonSchema,
    ) as unknown as Record<string, unknown>;
    const properties = record(schema.properties);
    const facts = record(properties.facts);
    facts.description = "Candidate sourced facts.";

    const normalized = normalizeAnthropicOutputSchema(schema);
    const normalizedFacts = record(record(normalized.schema).properties);

    expect(record(normalizedFacts.facts).description).toMatch(
      /^Candidate sourced facts\.\n\n\{maxItems: 2048\}$/u,
    );
    expect(facts.description).toBe("Candidate sourced facts.");
  });
});
