import { describe, expect, it } from "vitest";

import { completeCvProposalIssues } from "./complete-cv.js";
import { shortNamesRelated, shortNameTokens } from "./short-name-relation.js";

describe("short-name relation", () => {
  it("collects short tokens that start with an uppercase letter", () => {
    expect(shortNameTokens("Go")).toEqual(["Go"]);
    expect(shortNameTokens("R and C")).toEqual(["R", "C"]);
    expect(shortNameTokens("UI, on go")).toEqual(["UI"]);
    expect(shortNameTokens("TypeScript")).toEqual([]);
  });

  it("relates a short name that appears as a whole word in the evidence", () => {
    expect(shortNamesRelated("Go", ["Languages: TypeScript, Python, Go"])).toBe(true);
  });

  it("does not relate a short name absent from the evidence", () => {
    expect(shortNamesRelated("Go", ["Languages: TypeScript, Python"])).toBe(false);
  });

  it("matches case-sensitively, so a lowercase word does not support a name", () => {
    expect(shortNamesRelated("Go", ["Ready to go live with TypeScript"])).toBe(false);
  });

  it("does not match a short name inside a longer word", () => {
    expect(shortNamesRelated("Go", ["Worked at Google"])).toBe(false);
    expect(shortNamesRelated("Go", ["Built Go2 tooling"])).toBe(false);
  });

  it("relates single-letter names present as whole words", () => {
    expect(shortNamesRelated("R", ["Statistics: R, Python"])).toBe(true);
    expect(shortNamesRelated("C", ["Systems: C, Rust"])).toBe(true);
    expect(shortNamesRelated("C", ["Systems: C++"])).toBe(true);
    expect(shortNamesRelated("R", ["Read reports"])).toBe(false);
  });

  it("searches every cited chunk after NFKC normalization", () => {
    expect(shortNamesRelated("Go", ["Python", "Languages: Ｇｏ"])).toBe(true);
  });

  it("does not relate a claim without an uppercase short token", () => {
    expect(shortNamesRelated("on", ["Worked on TypeScript"])).toBe(false);
    expect(shortNamesRelated("", ["Go"])).toBe(false);
  });

  it("requires every short name to appear", () => {
    expect(shortNamesRelated("Go, R", ["Languages: Go, Python"])).toBe(false);
    expect(shortNamesRelated("Go, R", ["Languages: Go", "Statistics: R"])).toBe(true);
  });
});

describe("short-name fallback in CV claim validation", () => {
  function skillsProposal(claimText: string) {
    return {
      sections: [
        {
          title: "Skills",
          kind: "skills" as const,
          blocks: [
            {
              type: "bullet" as const,
              text: claimText,
              claims: [{ text: claimText, substantive: true, evidenceChunkIds: ["chunk"] }],
            },
          ],
        },
      ],
    };
  }

  function evidence(text: string) {
    return [
      {
        id: "chunk",
        workspaceId: "workspace",
        sourceId: "source",
        ordinal: 0,
        lineStart: 1,
        lineEnd: 1,
        checksum: "a".repeat(64),
        text,
        rank: 0,
      },
    ];
  }

  function codes(claimText: string, evidenceText: string): readonly string[] {
    return completeCvProposalIssues(skillsProposal(claimText), evidence(evidenceText)).map(
      (issue) => issue.code,
    );
  }

  it("accepts a short-name claim supported by the cited evidence", () => {
    expect(codes("Go", "Languages: TypeScript, Go")).not.toContain("unsupported_claim");
  });

  it("rejects a short-name claim whose evidence only has the lowercase word", () => {
    expect(codes("Go", "Ready to go live with TypeScript")).toContain("unsupported_claim");
  });

  it("keeps the related-token check for claims with meaningful tokens", () => {
    expect(codes("Kafka", "Languages: TypeScript, Python")).toContain("unsupported_claim");
    expect(codes("Go and Kafka", "Languages: Go, Python")).toContain("unsupported_claim");
    expect(codes("TypeScript", "Languages: TypeScript, Go")).not.toContain("unsupported_claim");
  });
});
