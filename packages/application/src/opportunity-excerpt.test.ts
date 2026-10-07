import { createHash } from "node:crypto";

import { opportunityBriefMaximumExcerptLength } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import { verifiedOpportunityExcerpt } from "./opportunity-excerpt.js";
import {
  type OpportunityExtractionSource,
  processOpportunityExtraction,
} from "./opportunity-extraction.js";

const jobText =
  "About the role\n\nYou will   lead platform reliability\nacross teams.\nRequired: 5 years of production TypeScript.";
const companyText = "Example Systems values operational ownership.";

function source(
  id: string,
  classification: OpportunityExtractionSource["classification"],
  text: string,
): OpportunityExtractionSource {
  return {
    id,
    classification,
    status: "available",
    mediaType: "text/plain",
    checksum: createHash("sha256").update(text, "utf8").digest("hex"),
    text,
  };
}

const sources = [
  source("job-source", "job-posting", jobText),
  source("company-source", "company-context", companyText),
];

function proposalWith(responsibilityExcerpt: string | null, requirementExcerpt: string | null) {
  const sourceIds = ["job-source"];
  return {
    schemaVersion: 1,
    role: null,
    employer: null,
    responsibilities: [
      { text: "Lead platform reliability", sourceIds, excerpt: responsibilityExcerpt },
    ],
    requirements: [
      {
        text: "Production TypeScript",
        priority: "critical" as const,
        sourceIds,
        excerpt: requirementExcerpt,
      },
    ],
    priorities: [],
    contradictions: [],
  };
}

async function extract(proposal: unknown) {
  return processOpportunityExtraction(
    { extract: async () => proposal },
    { operationId: "excerpt-operation", sources },
  );
}

describe("verifiedOpportunityExcerpt", () => {
  const index = new Map(sources.map((item) => [item.id, item.text]));

  it("keeps a verbatim excerpt and stores it whitespace-normalized", () => {
    expect(
      verifiedOpportunityExcerpt(
        "You will lead  platform reliability\n across teams.",
        ["job-source"],
        index,
      ),
    ).toBe("You will lead platform reliability across teams.");
  });

  it("drops null, empty, paraphrased, case-changed, and uncited-source excerpts", () => {
    expect(verifiedOpportunityExcerpt(null, ["job-source"], index)).toBeUndefined();
    expect(verifiedOpportunityExcerpt("   ", ["job-source"], index)).toBeUndefined();
    expect(
      verifiedOpportunityExcerpt("You will own reliability", ["job-source"], index),
    ).toBeUndefined();
    expect(
      verifiedOpportunityExcerpt("you will lead platform", ["job-source"], index),
    ).toBeUndefined();
    expect(
      verifiedOpportunityExcerpt("operational ownership", ["job-source"], index),
    ).toBeUndefined();
    expect(verifiedOpportunityExcerpt("operational ownership", ["company-source"], index)).toBe(
      "operational ownership",
    );
    expect(verifiedOpportunityExcerpt("lead platform", ["missing-source"], index)).toBeUndefined();
  });

  it("drops excerpts over the length bound without truncating", () => {
    const longText = "word ".repeat(100).trim();
    const longIndex = new Map([["long", longText]]);
    const atBound = longText.slice(0, opportunityBriefMaximumExcerptLength).trim();

    expect(longText.length).toBeGreaterThan(opportunityBriefMaximumExcerptLength);
    expect(verifiedOpportunityExcerpt(longText, ["long"], longIndex)).toBeUndefined();
    expect(verifiedOpportunityExcerpt(atBound, ["long"], longIndex)).toBe(atBound);
  });
});

describe("opportunity extraction excerpts", () => {
  it("keeps verified excerpts on responsibilities and requirements", async () => {
    const result = await extract(
      proposalWith(
        "lead platform reliability across teams.",
        "5 years  of production\nTypeScript.",
      ),
    );

    expect(result.responsibilities[0]?.excerpt).toBe("lead platform reliability across teams.");
    expect(result.requirements[0]?.excerpt).toBe("5 years of production TypeScript.");
  });

  it("drops unverifiable and uncited-source excerpts instead of failing extraction", async () => {
    const result = await extract(
      proposalWith("You will own the entire platform", "operational ownership"),
    );

    expect(result.issues).toEqual([]);
    expect(result.responsibilities[0]).not.toHaveProperty("excerpt");
    expect(result.requirements[0]).not.toHaveProperty("excerpt");
  });

  it("drops an over-long verbatim excerpt but keeps the entry and the extraction", async () => {
    const longText = "word ".repeat(100).trim();
    const result = await processOpportunityExtraction(
      { extract: async () => proposalWith(longText, "   ") },
      {
        operationId: "excerpt-operation",
        sources: [source("job-source", "job-posting", longText)],
      },
    );

    expect(longText.length).toBeGreaterThan(opportunityBriefMaximumExcerptLength);
    expect(result.issues).toEqual([]);
    expect(result.responsibilities).toHaveLength(1);
    expect(result.responsibilities[0]).not.toHaveProperty("excerpt");
    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0]).not.toHaveProperty("excerpt");
  });

  it("does not let excerpts change entry ids", async () => {
    const withExcerpt = await extract(
      proposalWith("lead platform reliability across teams.", null),
    );
    const without = await extract(proposalWith(null, null));

    expect(withExcerpt.responsibilities[0]?.id).toBe(without.responsibilities[0]?.id);
    expect(withExcerpt.requirements[0]?.id).toBe(without.requirements[0]?.id);
  });
});
