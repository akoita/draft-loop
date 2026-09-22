import type { AuthorArtifactProposal } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildAuthorArtifact } from "./author-output.js";
import { claimCoverageIssues } from "./claim-coverage.js";

function proposal(
  text: string,
  claims: readonly string[],
  substantive = true,
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
            claims: claims.map((text) => ({ text, substantive, evidenceChunkIds: ["chunk-1"] })),
          },
        ],
      },
    ],
  };
}

describe("substantive block claim coverage", () => {
  it.each([
    ["Ten years of experience leading security programs.", ["Ten years of experience"]],
    ["Built tools. Led teams.", ["Built tools."]],
    ["Did not lead teams.", ["lead teams"]],
    ["Improved throughput 50%.", ["Improved throughput 50"]],
    ["Built tools.", []],
    ["Led teams building tools.", ["Built tools leading teams."]],
  ])("rejects uncovered assertions: %s", (text, claims) => {
    expect(claimCoverageIssues(proposal(text, claims))).toEqual([
      {
        code: "substantive_text_uncovered",
        path: ["sections", 0, "blocks", 0, "text"],
        message: "substantive block text is not fully covered by substantive claims",
      },
    ]);
  });

  it("does not trust a non-substantive flag on factual prose", () => {
    expect(claimCoverageIssues(proposal("Built tools.", ["Built tools."], false))).toHaveLength(1);
  });

  it.each([
    ["Built tools. Led teams.", ["Built tools.", "Led teams."]],
    ["Built tools and led teams.", ["Built tools", "led teams"]],
    ["Built tools.\nLed teams.", ["Built tools.\nLed teams."]],
    ["Summary\nBuilt tools.", ["Built tools."]],
    ["Summary: Built tools.", ["Built tools."]],
    ["Built tools; graduation date not provided", ["Built tools"]],
    ["Summary", []],
    ["Education information unavailable", []],
    ["---", []],
  ])("accepts complete coverage or presentation: %s", (text, claims) => {
    expect(claimCoverageIssues(proposal(text, claims))).toEqual([]);
  });

  it.each([
    ["Built tools who led teams.", ["Built tools", "led teams"]],
    ["Built tools which led teams.", ["Built tools", "led teams"]],
    ["Built tools that led teams.", ["Built tools", "led teams"]],
    ["Built tools while leading teams.", ["Built tools", "leading teams"]],
    ["Built tools where teams shipped.", ["Built tools", "teams shipped"]],
    ["Built tools with teams.", ["Built tools", "teams"]],
    ["Built tools including dashboards.", ["Built tools", "dashboards"]],
    ["Built tools as well as dashboards.", ["Built tools", "dashboards"]],
    ["Built tools, and while leading teams.", ["Built tools", "leading teams"]],
    ["Built tools with and including dashboards.", ["Built tools", "dashboards"]],
  ])("accepts a joining-word gap between covered spans: %s", (text, claims) => {
    expect(claimCoverageIssues(proposal(text, claims))).toEqual([]);
  });

  it.each([
    ["Built tools who led teams.", ["Built tools", "teams"]],
    ["Built tools as well dashboards.", ["Built tools", "dashboards"]],
    ["Who built tools.", ["built tools"]],
    ["Built tools while", ["Built tools"]],
    ["Built tools while leading teams.", ["Built tools"]],
    ["Built tools and while", ["Built tools"]],
  ])("keeps a gap uncovered unless it only joins covered spans: %s", (text, claims) => {
    expect(claimCoverageIssues(proposal(text, claims))).toHaveLength(1);
  });

  it.each([
    ["And built tools.", ["built tools"]],
    ["Built tools and", ["Built tools"]],
  ])("keeps an uncovered 'and' exempt anywhere: %s", (text, claims) => {
    expect(claimCoverageIssues(proposal(text, claims))).toEqual([]);
  });

  it("classifies partial claims for author retry without exposing prose", () => {
    try {
      buildAuthorArtifact({
        proposal: proposal("Built tools across all regulated industries.", ["Built tools"]),
        executionId: "coverage-test",
        context: {
          language: "en",
          evidenceManifest: [
            { id: "source-1", path: "/synthetic/source.md", checksum: "a".repeat(64) },
          ],
        },
        retrievedEvidence: [
          {
            id: "chunk-1",
            workspaceId: "workspace-1",
            sourceId: "source-1",
            ordinal: 0,
            lineStart: 1,
            lineEnd: 1,
            checksum: "a".repeat(64),
            text: "Built tools.",
            rank: 0,
          },
        ],
      });
      expect.fail("partial claim must be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(z.ZodError);
      const issues = (error as z.ZodError).issues;
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            params: {
              stage: "factual-invariant-rejection",
              invariantCode: "substantive_text_uncovered",
            },
          }),
        ]),
      );
      expect(JSON.stringify(issues)).not.toContain("regulated");
    }
  });
});
