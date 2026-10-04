import { canonicalCandidateProfileExtractionProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  type CanonicalCandidateProfileExtractionInput,
  processCanonicalCandidateProfileExtraction,
} from "./candidate-profile-extraction.js";
import { repairCanonicalProfileEvidenceQuotes } from "./canonical-profile-evidence-quotes.js";

function proposal(
  facts: readonly {
    readonly key: string;
    readonly value: string;
    readonly sourceId: string;
    readonly quote: string;
  }[],
  issues: readonly {
    readonly code: string;
    readonly factKeys: readonly string[];
    readonly sourceIds: readonly string[];
  }[] = [],
) {
  return canonicalCandidateProfileExtractionProposalSchema.parse({
    schemaVersion: 1,
    facts: facts.map((fact) => ({
      key: fact.key,
      category: "skill",
      field: "name",
      value: fact.value,
      evidence: [{ sourceId: fact.sourceId, quote: fact.quote }],
    })),
    issues,
  });
}

describe("canonical profile evidence quote recovery", () => {
  it("removes one provider-added bold pair when the sentence is exactly grounded", () => {
    const input = proposal([
      {
        key: "fact-a",
        value: "migration across three production services",
        sourceId: "source-a",
        quote: "**a migration across three production services**",
      },
    ]);
    const repaired = repairCanonicalProfileEvidenceQuotes(
      input,
      new Map([["source-a", "**Led a migration across three production services during 2024.**"]]),
    );

    expect(repaired.facts[0]?.evidence[0]?.quote).toBe(
      "a migration across three production services",
    );
    expect(input.facts[0]?.evidence[0]?.quote).toBe(
      "**a migration across three production services**",
    );
  });

  it("supports underscore and single-character emphasis without changing interior text", () => {
    const input = proposal([
      {
        key: "fact-a",
        value: "CI pipelines",
        sourceId: "source-a",
        quote: "__Built CI pipelines__",
      },
      {
        key: "fact-b",
        value: "TypeScript",
        sourceId: "source-a",
        quote: "*TypeScript*",
      },
      {
        key: "fact-c",
        value: "Kubernetes",
        sourceId: "source-a",
        quote: "_Kubernetes_",
      },
    ]);
    const repaired = repairCanonicalProfileEvidenceQuotes(
      input,
      new Map([["source-a", "Built CI pipelines, used TypeScript, and deployed Kubernetes."]]),
    );

    expect(repaired.facts.map((fact) => fact.evidence[0]?.quote)).toEqual([
      "Built CI pipelines",
      "TypeScript",
      "Kubernetes",
    ]);
  });

  it("preserves already exact evidence and returns the original proposal unchanged", () => {
    const input = proposal([
      {
        key: "fact-a",
        value: "TypeScript",
        sourceId: "source-a",
        quote: "TypeScript",
      },
      {
        key: "fact-b",
        value: "React",
        sourceId: "source-b",
        quote: "*React*",
      },
    ]);

    expect(
      repairCanonicalProfileEvidenceQuotes(
        input,
        new Map([
          ["source-a", "TypeScript used on the project."],
          ["source-b", "*React* was part of the interface."],
        ]),
      ),
    ).toBe(input);
  });

  it.each([
    ["unavailable source", "**TypeScript**", "TypeScript", new Map<string, string>()],
    [
      "value absent from the quote",
      "**Built interfaces**",
      "React",
      new Map([["source-a", "Built interfaces for three products."]]),
    ],
    [
      "ellipsis",
      "**Led ... migration**",
      "migration",
      new Map([["source-a", "Led a migration across the platform."]]),
    ],
    [
      "misspelling",
      "**Led a migraton**",
      "migration",
      new Map([["source-a", "Led a migration across the platform."]]),
    ],
    [
      "interior emphasis",
      "**Led a *safe* migration**",
      "migration",
      new Map([["source-a", "Led a safe migration across the platform."]]),
    ],
    [
      "noncontiguous source text",
      "**Led the platform migration**",
      "migration",
      new Map([["source-a", "Led the platform-wide cloud migration."]]),
    ],
  ])("leaves an ungrounded %s quote unchanged", (_reason, quote, value, sources) => {
    const input = proposal([{ key: "fact-a", value, sourceId: "source-a", quote }]);

    expect(repairCanonicalProfileEvidenceQuotes(input, sources)).toBe(input);
  });

  it("preserves issue links and immutability while repairing a copied fact", () => {
    const input = proposal(
      [
        {
          key: "fact-a",
          value: "TypeScript",
          sourceId: "source-a",
          quote: "**TypeScript**",
        },
        {
          key: "fact-b",
          value: "React",
          sourceId: "source-b",
          quote: "**React**",
        },
      ],
      [
        {
          code: "conflict-value",
          factKeys: ["fact-a", "fact-b"],
          sourceIds: ["source-a", "source-b"],
        },
      ],
    );
    Object.freeze(input.facts[0]?.evidence[0]);
    Object.freeze(input.facts[0]?.evidence);
    Object.freeze(input.facts[0]);
    Object.freeze(input.facts);
    Object.freeze(input.issues[0]);
    Object.freeze(input.issues);
    Object.freeze(input);

    const repaired = repairCanonicalProfileEvidenceQuotes(
      input,
      new Map([
        ["source-a", "TypeScript is used."],
        ["source-b", "React is used."],
      ]),
    );

    expect(repaired).not.toBe(input);
    expect(repaired.facts[0]?.evidence[0]?.quote).toBe("TypeScript");
    expect(input.facts[0]?.evidence[0]?.quote).toBe("**TypeScript**");
    expect(repaired.issues).toBe(input.issues);
    expect(repaired.issues[0]?.factKeys).toEqual(["fact-a", "fact-b"]);
  });

  it("repairs emphasis in the normal extraction path and drops only unsupported quotes", async () => {
    const source = {
      id: "source-a",
      mediaType: "text/markdown",
      checksum: "a".repeat(64),
      text: "A role used TypeScript to ship applications.",
      reference: {
        storeId: "store-a",
        knowledgeBaseId: "knowledge-a",
        sourceId: "document-a",
        versionId: "version-a",
        kind: "candidate-provided" as const,
      },
    } satisfies CanonicalCandidateProfileExtractionInput["sources"][number];
    const validFact = {
      key: "skill-typescript",
      category: "skill",
      field: "name",
      value: "TypeScript",
      evidence: [{ sourceId: source.id, quote: "**TypeScript**" }],
    };
    const extract = (facts: readonly object[]) => ({
      extract: async () => ({ schemaVersion: 1, facts, issues: [] }),
    });
    const request = {
      operationId: "quote-repair",
      sources: [source],
      allowProviderData: true,
    } as const;

    const recovered = await processCanonicalCandidateProfileExtraction(
      extract([validFact]),
      request,
    );
    expect(recovered.facts).toHaveLength(1);
    expect(recovered.facts[0]?.value).toBe("TypeScript");
    expect(recovered.facts[0]?.provenance).toEqual([source.reference]);

    const filtered = await processCanonicalCandidateProfileExtraction(
      extract([
        validFact,
        {
          key: "unsupported-react",
          category: "skill",
          field: "name",
          value: "React",
          evidence: [{ sourceId: source.id, quote: "**React**" }],
        },
      ]),
      request,
    );
    expect(filtered.facts.map((fact) => fact.value)).toEqual(["TypeScript"]);
    expect(filtered.issues.map((issue) => issue.message)).toContain(
      "1 extracted fact was dropped because their evidence quotes were not found in the cited sources. Review the profile for missing facts.",
    );
  });
});
