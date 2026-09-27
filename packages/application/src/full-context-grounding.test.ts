import type { ScoredEvidenceChunk } from "@draft-loop/domain";
import { authorArtifactProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { extractProtectedValues } from "./author-grounding.js";
import { buildAuthorArtifact } from "./author-output.js";
import { completeCvProposalIssues } from "./complete-cv.js";

const checksum = "a".repeat(64);
const phone = "+39 (20) 12 34 56 78";

function chunk(id: string, text: string, ordinal = 0): ScoredEvidenceChunk {
  return {
    id,
    workspaceId: "workspace-1",
    sourceId: "source-1",
    ordinal,
    lineStart: ordinal + 1,
    lineEnd: ordinal + 1,
    checksum,
    text,
    rank: ordinal,
  };
}

function proposal(
  title: string,
  kind: "header" | "summary" | "experience" | "projects",
  blockText: string,
  claimText: string,
  citedIds: readonly string[],
) {
  return authorArtifactProposalSchema.parse({
    sections: [
      {
        title,
        kind,
        blocks: [
          {
            type: kind === "projects" ? "bullet" : "paragraph",
            text: blockText,
            claims: [{ text: claimText, substantive: true, evidenceChunkIds: citedIds }],
          },
        ],
      },
    ],
  });
}

function codes(
  input: ReturnType<typeof proposal>,
  evidence: readonly ScoredEvidenceChunk[],
  requiredSections: readonly string[] = [],
) {
  return completeCvProposalIssues(input, evidence, requiredSections).map(({ code }) => code);
}

describe("full-context grounding boundaries", () => {
  it("accepts a phone-only claim when the complete number is in one cited chunk", () => {
    const evidence = [chunk("phone", `Contact: ${phone}`)];

    expect(codes(proposal("Contact", "header", phone, phone, ["phone"]), evidence)).toEqual([]);
  });

  it.each([
    ["a missing citation", [], [chunk("phone", `Contact: ${phone}`)]],
    [
      "an uncited number",
      ["other"],
      [chunk("phone", `Contact: ${phone}`), chunk("other", "Contact details recorded.", 1)],
    ],
    [
      "changed digits even when their groups occur separately",
      ["phone", "digits"],
      [chunk("phone", `Contact: ${phone}`), chunk("digits", "Alternate final digits: 79.", 1)],
    ],
    [
      "a partial number within a longer cited number",
      ["phone"],
      [chunk("phone", `Contact: ${phone}`)],
    ],
    [
      "different separators in the cited number",
      ["alternate"],
      [chunk("alternate", "Contact: +39 (20) 12-34 56 78")],
    ],
    ["a longer number prefix", ["phone"], [chunk("phone", `Contact: 1${phone}`)]],
    ["a longer number suffix", ["phone"], [chunk("phone", `Contact: ${phone} 90`)]],
    [
      "digits split across cited chunks",
      ["first", "second"],
      [chunk("first", "Contact: +39 (20) 12 34"), chunk("second", "56 78", 1)],
    ],
  ])("rejects a phone claim with %s", (_case, citedIds, evidence) => {
    const claimText =
      _case === "changed digits even when their groups occur separately"
        ? "+39 (20) 12 34 56 79"
        : _case === "a partial number within a longer cited number"
          ? "+39 (20) 12 34 56"
          : phone;
    const codesFound = codes(
      proposal("Contact", "header", claimText, claimText, citedIds),
      evidence,
    );
    expect(codesFound).toContain(citedIds.length === 0 ? "missing_evidence" : "unsupported_claim");
  });

  it("leaves non-phone claims to the existing relation check", () => {
    const evidence = [chunk("java", "Used Java for backend services.")];

    expect(
      codes(
        proposal(
          "Summary",
          "summary",
          "Used Java for backend services.",
          "Used Java for backend services.",
          ["java"],
        ),
        evidence,
      ),
    ).toEqual([]);
  });

  it("recognizes a cited comma appositive as a narrow software-object description", () => {
    const text = "Built FLUXDSL, a model-driven engineering tool written in Java.";
    const evidence = [chunk("tool", text)];

    expect(extractProtectedValues(text)).toContain("FLUXDSL");
    expect(extractProtectedValues(text)).not.toContain("Built FLUXDSL");
    expect(codes(proposal("Experience", "experience", text, text, ["tool"]), evidence)).toEqual([]);

    const evolved = "Evolved WATCHSYS, the in-house supervision tool built with Java.";
    expect(extractProtectedValues(evolved)).toContain("WATCHSYS");
    expect(extractProtectedValues(evolved)).not.toContain("Evolved WATCHSYS");
    expect(
      codes(proposal("Experience", "experience", evolved, evolved, ["evolved-tool"]), [
        chunk("evolved-tool", evolved),
      ]),
    ).toEqual([]);
  });

  it("keeps unsupported acronyms, employers, titles, and linking predicates protected", () => {
    const acronym = "Built FLUXDSL, a model-driven engineering tool written in Java.";
    expect(
      codes(proposal("Experience", "experience", acronym, acronym, ["tool"]), [
        chunk("tool", "Built a model-driven engineering tool written in Java."),
      ]),
    ).toContain("factual_invariant_violation");

    expect(
      extractProtectedValues("Built Northwind Freight, a model-driven engineering tool"),
    ).toContain("Built Northwind Freight");
    expect(
      extractProtectedValues("Built Staff Engineer, a model-driven engineering tool"),
    ).toContain("Built Staff Engineer");
    expect(extractProtectedValues("Built FLUXDSL is an employer")).toContain("Built FLUXDSL");

    const evolved = "Evolved WATCHSYS, the in-house supervision tool built with Java.";
    expect(
      codes(proposal("Experience", "experience", evolved, evolved, ["tool-without-name"]), [
        chunk("tool-without-name", "Evolved the in-house supervision tool built with Java."),
      ]),
    ).toContain("factual_invariant_violation");
    expect(
      extractProtectedValues("Evolved Northwind Freight, the in-house supervision tool"),
    ).toContain("Evolved Northwind Freight");
    expect(
      extractProtectedValues("Evolved Staff Engineer, the in-house supervision tool"),
    ).toContain("Evolved Staff Engineer");
    expect(extractProtectedValues("Evolved WATCHSYS is an employer")).toContain("Evolved WATCHSYS");
  });

  it("builds an artifact with a cited phone, software appositive, and configured navigation note", () => {
    const evidence = [
      chunk("phone", `Contact: ${phone}`, 0),
      chunk("summary", "Used Java to build backend systems.", 1),
      chunk("tool", "Built FLUXDSL, a model-driven engineering tool written in Java.", 2),
      chunk("project", "Built a Java workflow prototype.", 3),
    ];
    const artifact = buildAuthorArtifact({
      proposal: {
        sections: [
          {
            title: "Contact",
            kind: "header",
            blocks: [
              {
                type: "paragraph",
                text: phone,
                claims: [{ text: phone, substantive: true, evidenceChunkIds: ["phone"] }],
              },
            ],
          },
          {
            title: "Summary",
            kind: "summary",
            blocks: [
              {
                type: "paragraph",
                text: "Used Java to build backend systems; see Selected Projects.",
                claims: [
                  {
                    text: "Used Java to build backend systems",
                    substantive: true,
                    evidenceChunkIds: ["summary"],
                  },
                ],
              },
            ],
          },
          {
            title: "Experience",
            kind: "experience",
            blocks: [
              {
                type: "paragraph",
                text: "Built FLUXDSL, a model-driven engineering tool written in Java.",
                claims: [
                  {
                    text: "Built FLUXDSL, a model-driven engineering tool written in Java.",
                    substantive: true,
                    evidenceChunkIds: ["tool"],
                  },
                ],
              },
            ],
          },
          {
            title: "Selected Projects",
            kind: "projects",
            blocks: [
              {
                type: "bullet",
                text: "Built a Java workflow prototype.",
                claims: [
                  {
                    text: "Built a Java workflow prototype.",
                    substantive: true,
                    evidenceChunkIds: ["project"],
                  },
                ],
              },
            ],
          },
        ],
      },
      executionId: "full-context-grounding",
      context: {
        language: "en",
        evidenceManifest: [{ id: "source-1", path: "/local/cv.md", checksum }],
      },
      retrievedEvidence: evidence,
      requiredSections: ["Selected Projects"],
      createdAt: "2026-09-27T10:00:00.000Z",
    });

    expect(artifact.sections).toHaveLength(4);
  });

  it.each([
    ["an unknown target", "Used Java to build systems; see Archive.", ["Selected Projects"], true],
    ["an unconfigured title", "Used Java to build systems; see Selected Projects.", [], true],
    [
      "a missing configured section",
      "Used Java to build systems; see Selected Projects.",
      ["Selected Projects"],
      false,
    ],
    [
      "an extra factual tail",
      "Used Java to build systems; see Selected Projects and doubled throughput.",
      ["Selected Projects"],
      true,
    ],
    [
      "an unsupported date prefix",
      "Used Java in 2019-2023; see Selected Projects.",
      ["Selected Projects"],
      true,
    ],
  ])("does not erase unsupported facts in %s", (_case, text, requiredSections, includeProjects) => {
    const inputSections = [
      {
        title: "Summary",
        kind: "summary",
        blocks: [
          {
            type: "paragraph",
            text,
            claims: [
              {
                text: "Used Java to build systems",
                substantive: true,
                evidenceChunkIds: ["summary"],
              },
            ],
          },
        ],
      },
      ...(includeProjects
        ? [
            {
              title: "Selected Projects",
              kind: "projects",
              blocks: [
                {
                  type: "bullet",
                  text: "Built a Java workflow prototype.",
                  claims: [
                    {
                      text: "Built a Java workflow prototype.",
                      substantive: true,
                      evidenceChunkIds: ["project"],
                    },
                  ],
                },
              ],
            },
          ]
        : []),
    ];
    const parsed = authorArtifactProposalSchema.parse({ sections: inputSections });
    const issues = completeCvProposalIssues(
      parsed,
      [
        chunk("summary", "Used Java to build systems.", 0),
        chunk("project", "Built a Java workflow prototype.", 1),
      ],
      requiredSections,
    );

    expect(issues.map(({ code }) => code)).toContain("substantive_text_uncovered");
  });
});
