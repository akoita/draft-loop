import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { authorArtifactProposalSchema } from "@draft-loop/schemas";
import { expect, it } from "vitest";

import { completeAuthorEvidenceCitations } from "./author-evidence-completion.js";
import { createAuthorGroundingGuide, extractProtectedValues } from "./author-grounding.js";
import { completeCvProposalIssues } from "./complete-cv.js";

function source(text: string): ScoredEvidenceChunk {
  return {
    id: "chunk",
    sourceId: "source",
    workspaceId: "workspace",
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
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text,
            claims: [{ text, substantive: true, evidenceChunkIds: cited ? ["chunk"] : [] }],
          },
        ],
      },
    ],
  });
}

it.each([
  "No experience: GraphQL.",
  "- No experience: TypeScript, GraphQL, or AWS.",
  "No GraphQL experience.",
])("grounds an explicit negative experience statement from %s", (text) => {
  const evidence = [source(text)];
  const completed = completeAuthorEvidenceCitations(
    proposal("No GraphQL experience", false),
    evidence,
  );
  expect(completed.sections[0]?.blocks[0]?.claims[0]?.evidenceChunkIds).toEqual(["chunk"]);
  expect(completeCvProposalIssues(completed, evidence)).toEqual([]);
  expect(createAuthorGroundingGuide(evidence)[0]?.protectedValues).toContain(
    "No GraphQL experience",
  );
});

it.each([
  ["No GraphQL experience", "Experience: GraphQL."],
  ["no GraphQL experience", "Experience: GraphQL."],
  ["GraphQL experience", "No experience: GraphQL."],
  ["No GraphQL experience", "GraphQL tools are available."],
  ["No GraphQL experience", "No experience: TypeScript."],
  ["No GraphQL experience", "No experience: SuperGraphQL."],
  ["No GraphQL experience", "No experience: GraphQL2."],
  ["No GraphQL experience", "No experience: GraphQL except production work."],
  ["No GraphQL experience", "No GraphQL experience required."],
  ["No GraphQL experience", "No experience: GraphQL.\nExperience: GraphQL."],
])("rejects %s against %s", (claim, evidence) => {
  expect(
    completeCvProposalIssues(proposal(claim), [source(evidence)]).some(
      (issue) => issue.code === "factual_invariant_violation",
    ),
  ).toBe(true);
});

it("preserves positive polarity and rejects missing citations", () => {
  expect(
    completeCvProposalIssues(proposal("GraphQL experience"), [source("Experience: GraphQL.")]),
  ).toEqual([]);
  expect(
    completeCvProposalIssues(proposal("No GraphQL experience", false), [
      source("No experience: GraphQL."),
    ]),
  ).toEqual([expect.objectContaining({ code: "missing_evidence" })]);
});

it.each([
  "No GraphQL Corporation",
  "No GraphQL Experience",
  "No GraphQL experience is required",
  "No GraphQL",
  "No GraphQL Architect",
])("retains ambiguous proper-name protection for %s", (text) => {
  expect(extractProtectedValues(text)).toContain(
    text === "No GraphQL experience is required" ? "No GraphQL" : text,
  );
});
