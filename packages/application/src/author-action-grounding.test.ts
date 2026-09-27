import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { completeAuthorEvidenceCitations } from "./author-evidence-completion.js";
import { createAuthorGroundingGuide, extractProtectedValues } from "./author-grounding.js";
import { completeCvProposalIssues } from "./complete-cv.js";

function source(text: string): ScoredEvidenceChunk {
  return {
    id: "source-chunk",
    workspaceId: "workspace",
    sourceId: "source",
    ordinal: 0,
    lineStart: 1,
    lineEnd: 1,
    checksum: "a".repeat(64),
    text,
    rank: 0,
  };
}
function proposal(text: string, cited = true) {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            type: "bullet",
            text,
            claims: [{ text, substantive: true, evidenceChunkIds: cited ? ["source-chunk"] : [] }],
          },
        ],
      },
    ],
  });
}

function proposalWithEvidence(text: string, evidenceChunkIds: readonly string[]) {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title: "Experience",
        kind: "experience",
        blocks: [
          {
            type: "bullet",
            text,
            claims: [{ text, substantive: true, evidenceChunkIds }],
          },
        ],
      },
    ],
  });
}

describe("opening action-verb grounding", () => {
  it.each([
    ["Built", "TypeScript"],
    ["Implemented", "GraphQL"],
    ["Deployed", "AWS"],
  ])("accepts supported %s %s wording without protecting the action as a name", (verb, name) => {
    const evidence = [source(`${verb} local-first ${name} tools with deterministic testing.`)];
    const text = `${verb} ${name} tools with deterministic testing.`;
    expect(extractProtectedValues(text)).toEqual([name]);
    expect(completeCvProposalIssues(proposal(text), evidence)).toEqual([]);
    expect(createAuthorGroundingGuide(evidence)[0]?.protectedValues).toContain(name);
    const completed = completeAuthorEvidenceCitations(proposal(text, false), evidence);
    expect(completed.sections[0]?.blocks[0]?.claims[0]?.evidenceChunkIds).toEqual(["source-chunk"]);
    expect(completeCvProposalIssues(completed, evidence)).toEqual([]);
  });

  it("allows leading whitespace and preserves protected-value source order", () => {
    expect(extractProtectedValues("  Built TypeScript tools using AWS in 2024.")).toEqual([
      "TypeScript",
      "AWS",
      "2024",
    ]);
  });

  it("splits Used only for a leading supported pair of technical names and an action", () => {
    const text = "Used JUnit and AssertJ to validate scenarios";
    const junitEvidence = { ...source("JUnit"), id: "junit" };
    const assertjEvidence = { ...source("AssertJ"), id: "assertj" };
    const evidence = [junitEvidence, assertjEvidence];
    const input = proposalWithEvidence(
      text,
      evidence.map(({ id }) => id),
    );

    expect(extractProtectedValues(text)).toEqual(expect.arrayContaining(["JUnit", "AssertJ"]));
    expect(extractProtectedValues(text)).not.toContain("Used JUnit");
    expect(completeCvProposalIssues(input, evidence)).toEqual([]);
    expect(
      completeCvProposalIssues(input, [{ ...source("JUnitPro"), id: "junit" }, assertjEvidence]),
    ).toContainEqual(expect.objectContaining({ code: "factual_invariant_violation" }));
    expect(completeCvProposalIssues(input, [junitEvidence])).toContainEqual(
      expect.objectContaining({ code: "factual_invariant_violation" }),
    );

    expect(extractProtectedValues("Used Acme and AssertJ to validate scenarios")).toContain(
      "Used Acme",
    );
    expect(extractProtectedValues("Used Senior and AssertJ to validate scenarios")).toContain(
      "Used Senior",
    );
    expect(extractProtectedValues("Used JUnit or AssertJ to validate scenarios")).toContain(
      "Used JUnit",
    );
  });

  it("requires single TitleCase and mixed names to be whole evidence tokens", () => {
    for (const name of ["Keycloak", "JUnit", "AssertJ"]) {
      expect(
        completeCvProposalIssues(proposal(`Used ${name} tools`), [source(`${name}Pro tools`)]),
      ).toContainEqual(expect.objectContaining({ code: "factual_invariant_violation" }));
      expect(
        completeCvProposalIssues(proposal(`Used ${name} tools`), [source(`${name} tools`)]),
      ).toEqual([]);
    }
  });

  it.each([
    "Lead TypeScript Engineer",
    "Staff TypeScript Engineer",
    "Senior Software Engineer",
    "Built Systems",
    "Built AWS Architect",
    "Built TypeScript",
    "Built TypeScript is the employer",
    "Built TypeScript was founded",
    "Built TypeScript. Established tooling followed.",
  ])("retains the ambiguous or multi-word name %s", (text) => {
    expect(extractProtectedValues(text)).toContain(text.split(/(?:\.| is | was )/u)[0]);
  });

  it("keeps action-looking words protected inside employer names and later prose", () => {
    expect(extractProtectedValues("Worked at Built TypeScript tools.")).toContain(
      "Built TypeScript",
    );
    expect(extractProtectedValues("Experience: Built TypeScript tools.")).toContain(
      "Built TypeScript",
    );
    expect(
      completeCvProposalIssues(proposal("Worked at Built TypeScript tools."), [
        source("Built local-first TypeScript tools."),
      ]),
    ).toEqual([expect.objectContaining({ code: "factual_invariant_violation" })]);
  });

  it.each([
    ["Built JavaScript tools.", "Built TypeScript tools."],
    ["Built TypeScript tools.", "Built SuperTypeScript tools."],
    ["Built TypeScript tools.", "Built TypeScript2 tools."],
    ["Built AWS tools.", "Built GCP tools."],
    ["Built TypeScript tools at Other Systems.", "Built TypeScript tools at Example Systems."],
    ["Lead TypeScript Engineer", "Staff TypeScript Engineer"],
    ["Built TypeScript is the employer.", "The employer uses TypeScript tools."],
    [
      "Built TypeScript tools; AWS Certified Architect.",
      "Built TypeScript tools; AWS Certified Developer.",
    ],
    ["Built TypeScript tools in 2025.", "Built TypeScript tools in 2024."],
    ["Built TypeScript tools with 20% improvement.", "Built TypeScript tools with 20 improvement."],
    [
      "Built TypeScript tools with 20 improvements.",
      "Built TypeScript tools with 120 improvements.",
    ],
  ])("rejects changed protected facts in %s", (claim, evidence) => {
    expect(completeCvProposalIssues(proposal(claim), [source(evidence)])).toContainEqual(
      expect.objectContaining({ code: "factual_invariant_violation" }),
    );
  });

  it("still requires evidence and does not complete an unsupported technology citation", () => {
    const evidence = [source("Built local-first JavaScript tools.")];
    const uncited = proposal("Built TypeScript tools.", false);
    expect(completeAuthorEvidenceCitations(uncited, evidence)).toBe(uncited);
    expect(completeCvProposalIssues(uncited, evidence)).toContainEqual(
      expect.objectContaining({ code: "missing_evidence" }),
    );
  });
});
