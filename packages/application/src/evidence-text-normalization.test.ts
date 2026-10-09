import { canonicalCandidateProfileExtractionProposalSchema } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { createCanonicalProfileEvidenceChecker } from "./candidate-profile-grounding-diagnostics.js";
import { repairCanonicalProfileEvidenceQuotes } from "./canonical-profile-evidence-quotes.js";
import { evidenceQuoteCases, syntheticCareerSource } from "./evidence-quote-fixtures.js";
import {
  createEvidenceSourceIndex,
  normalizeFormattedEvidenceText,
} from "./evidence-text-normalization.js";

const reference = {
  storeId: "store-1",
  knowledgeBaseId: "knowledge-1",
  sourceId: "document-1",
  versionId: "version-1",
  kind: "candidate-provided" as const,
};
const sourceTexts = new Map([["source-1", syntheticCareerSource]]);

function plainRule(value: string, quote: string, source: string): boolean {
  const normalize = (text: string) =>
    text.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
  return (
    normalize(source).includes(normalize(quote)) && normalize(quote).includes(normalize(value))
  );
}

function proposalFor(value: string, quote: string) {
  return canonicalCandidateProfileExtractionProposalSchema.parse({
    schemaVersion: 1,
    facts: [
      {
        key: "fact-1",
        category: "skill",
        field: "name",
        value,
        evidence: [{ sourceId: "source-1", quote }],
      },
    ],
    issues: [],
  });
}

describe("formatting-tolerant evidence grounding", () => {
  it.each(evidenceQuoteCases)("$label", ({ value, quote, grounded, acceptedBefore }) => {
    expect(plainRule(value, quote, syntheticCareerSource)).toBe(acceptedBefore);

    const checker = createCanonicalProfileEvidenceChecker(
      new Map([["source-1", [reference]]]),
      sourceTexts,
    );
    const repaired = repairCanonicalProfileEvidenceQuotes(proposalFor(value, quote), sourceTexts);
    const repairedFact = repaired.facts[0];
    const evidence = repairedFact?.evidence[0];
    expect(evidence).toBeDefined();
    expect(
      checker.evidenceFailures(value, { sourceId: "source-1", quote: evidence?.quote ?? "" }),
    ).toEqual(grounded ? [] : expect.arrayContaining([expect.any(String)]));

    if (grounded) {
      // The unrepaired quote is accepted too, and a rewritten quote is always verbatim source text.
      expect(checker.evidenceFailures(value, { sourceId: "source-1", quote })).toEqual([]);
      const stored = evidence?.quote ?? "";
      if (stored !== quote) expect(syntheticCareerSource).toContain(stored);
    } else {
      expect(evidence?.quote).toBe(quote);
    }
  });

  it("stores the exact source substring when only formatting differed", () => {
    const cases: readonly [string, string, string][] = [
      ["Acme Labs", "Senior Engineer at Acme Labs", "Senior Engineer** at *Acme Labs"],
      ["Kotlin", "TypeScript, Kotlin, and", "TypeScript, __Kotlin__, and"],
      ["search", "Shipped the “search” feature", 'Shipped the "search" feature'],
      ["2019-2021", "during 2019-2021 and", "during 2019–2021 and"],
      [
        "GitHub Actions",
        "with GitHub Actions for",
        "with [GitHub Actions](https://example.com/actions) for",
      ],
    ];
    for (const [value, quote, expected] of cases) {
      const repaired = repairCanonicalProfileEvidenceQuotes(proposalFor(value, quote), sourceTexts);
      expect(repaired.facts[0]?.evidence[0]?.quote).toBe(expected);
      expect(syntheticCareerSource).toContain(expected);
    }
  });

  it("leaves plain matches and ungrounded quotes untouched", () => {
    const plain = proposalFor("Kotlin", "typescript, __kotlin__");
    expect(repairCanonicalProfileEvidenceQuotes(plain, sourceTexts)).toBe(plain);
    const paraphrase = proposalFor("platform migrations", "Led platform migrations");
    expect(repairCanonicalProfileEvidenceQuotes(paraphrase, sourceTexts)).toBe(paraphrase);
  });

  it("keeps the quote when the exact span would exceed the quote length limit", () => {
    const longLink = `[text](${"u".repeat(2_100)})`;
    const sources = new Map([["source-1", `Built ${longLink} fast.`]]);
    const input = proposalFor("text", "Built text fast.");
    expect(repairCanonicalProfileEvidenceQuotes(input, sources)).toBe(input);
  });

  it("maps normalized offsets back across dropped markup and expanded characters", () => {
    const text = "- **ﬁne** art\r\n  [work](http://x.test)";
    const formatted = normalizeFormattedEvidenceText(text);
    expect(formatted.text).toBe("fine art work");
    const index = createEvidenceSourceIndex(new Map([["s", text]]));
    expect(index.locateExactQuote("s", "fine art work")).toBe("ﬁne** art\r\n  [work");
    expect(index.locateExactQuote("s", "Ｆine art")).toBe("ﬁne** art");
    expect(index.locateExactQuote("missing", "fine")).toBeUndefined();
    expect(index.containsQuote("s", "")).toBe(false);
  });
});
