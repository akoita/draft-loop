import { readFileSync } from "node:fs";

import { isRequirementCoveredByBlock } from "@draft-loop/validation";
import { describe, expect, it } from "vitest";

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

const fixtureText = readFileSync(
  new URL("../fixtures/requirement-coverage/semantic-coverage-cases.json", import.meta.url),
  "utf8",
);
const fixture = JSON.parse(fixtureText) as CoverageFixture;
const artifact = {
  sections: [{ blocks: fixture.blocks.map((block) => ({ text: block.text })) }],
} as unknown as Parameters<typeof isRequirementCoveredByBlock>[1];

function lexicalOutcome(id: string): boolean {
  const requirement = fixture.requirements.find((candidate) => candidate.id === id);
  if (requirement === undefined) throw new Error(`Unknown requirement ${id}.`);
  return isRequirementCoveredByBlock(requirement, artifact);
}

describe("semantic requirement coverage investigation fixture (#727)", () => {
  it("contains only invented, internally consistent content", () => {
    for (const forbidden of ["anthropic", "openai", "/private/", "@draft-loop"]) {
      expect(fixtureText).not.toContain(forbidden);
    }
    const blockIds = new Set(fixture.blocks.map((block) => block.id));
    expect(blockIds.size).toBe(fixture.blocks.length);
    for (const requirement of fixture.requirements) {
      for (const evidence of requirement.evidence) expect(blockIds.has(evidence)).toBe(true);
      expect(requirement.evidence.length > 0).toBe(requirement.label === "covered");
    }
  });

  // These assertions record current behaviour, not desired behaviour. When a
  // coverage change lands, update them together with the evaluation note.
  it("reproduces the lexical false negatives for differently worded coverage", () => {
    const falseNegatives = fixture.requirements
      .filter((requirement) => requirement.label === "covered" && !lexicalOutcome(requirement.id))
      .map((requirement) => requirement.id);
    expect(falseNegatives).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7"]);
  });

  it("keeps true gaps and misleading keyword overlaps uncovered", () => {
    for (const id of ["r8", "r9", "r10", "r11", "r12", "r14"]) {
      expect(lexicalOutcome(id)).toBe(false);
    }
    for (const id of ["r15", "r16"]) expect(lexicalOutcome(id)).toBe(true);
  });

  it("rejects a lower degree for a level-qualified degree requirement (#950)", () => {
    // "MSc or PhD in Computer Science" uses the strict degree rule, so a block
    // that only states a BSc no longer covers it through word overlap.
    expect(lexicalOutcome("r13")).toBe(false);
  });
});
