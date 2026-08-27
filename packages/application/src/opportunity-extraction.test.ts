import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createOpportunityExtractionProcessor,
  type OpportunityExtractionRequest,
  type OpportunityExtractionSource,
  processOpportunityExtraction,
} from "./opportunity-extraction.js";

const checksum = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");

const sources: readonly OpportunityExtractionSource[] = [
  {
    id: "job-source",
    classification: "job-posting",
    status: "available",
    mediaType: "text/markdown",
    checksum: checksum("private job source"),
    text: "private job source",
  },
  {
    id: "company-source",
    classification: "company-context",
    status: "partial",
    mediaType: "text/plain",
    checksum: checksum("private company source"),
    text: "private company source",
  },
];

function proposal() {
  return {
    schemaVersion: 1,
    role: { value: "Platform Engineer", sourceIds: ["job-source"] },
    employer: { value: "Example Systems", sourceIds: ["job-source", "company-source"] },
    responsibilities: [
      { text: "Lead platform reliability", sourceIds: ["job-source"] },
      { text: " Lead   platform reliability ", sourceIds: ["job-source"] },
    ],
    requirements: [
      {
        text: "Production systems experience",
        priority: "critical" as const,
        sourceIds: ["job-source"],
      },
    ],
    priorities: [{ text: "Operational ownership", sourceIds: ["company-source"] }],
    contradictions: [{ field: "employer" as const, sourceIds: ["job-source", "company-source"] }],
  };
}

function request(
  overrides: Partial<OpportunityExtractionRequest> = {},
): OpportunityExtractionRequest {
  return {
    operationId: "extraction-operation-1",
    sources,
    ...overrides,
  };
}

describe("opportunity extraction processor", () => {
  it("maps a proposal to deterministic safe ids, citations, and contradiction issues", async () => {
    const extract = vi.fn(async (input: OpportunityExtractionRequest) => {
      expect(input.sources).toEqual(sources);
      return proposal();
    });
    const first = await processOpportunityExtraction({ extract }, request());
    const second = await processOpportunityExtraction({ extract }, request());

    expect(first).toEqual(second);
    expect(first.role).toEqual({ value: "Platform Engineer", sourceIds: ["job-source"] });
    expect(first.employer).toEqual({
      value: "Example Systems",
      sourceIds: ["job-source", "company-source"],
    });
    expect(first.responsibilities).toHaveLength(1);
    expect(first.responsibilities[0]).toMatchObject({
      id: expect.stringMatching(/^extraction-responsibility-[a-f0-9]{32}$/u),
      text: "Lead platform reliability",
      sourceIds: ["job-source"],
    });
    expect(first.requirements[0]).toMatchObject({
      id: expect.stringMatching(/^extraction-requirement-[a-f0-9]{32}$/u),
      priority: "critical",
    });
    expect(first.priorities[0]).toMatchObject({
      id: expect.stringMatching(/^extraction-priority-[a-f0-9]{32}$/u),
    });
    expect(first.issues).toEqual([
      {
        id: expect.stringMatching(/^extraction-issue-[a-f0-9]{32}$/u),
        code: "contradiction",
        status: "open",
        severity: "warning",
        message: "Extracted employer evidence contains a contradiction.",
        sourceIds: ["job-source", "company-source"],
      },
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.responsibilities)).toBe(true);
    expect(Object.isFrozen(first.responsibilities[0])).toBe(true);
    expect(Object.isFrozen(first.issues[0])).toBe(true);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it("passes an abort signal through the sanitized request", async () => {
    const controller = new AbortController();
    const extract = vi.fn(async (input: OpportunityExtractionRequest) => {
      expect(input.signal).toBe(controller.signal);
      return {
        schemaVersion: 1,
        role: null,
        employer: null,
        responsibilities: [],
        requirements: [],
        priorities: [],
        contradictions: [],
      };
    });

    await processOpportunityExtraction(
      { extract },
      request({ operationId: "operation-with-signal", signal: controller.signal }),
    );
    expect(extract).toHaveBeenCalledOnce();
  });

  it("turns provider, schema, citation, and request failures into one fixed issue", async () => {
    const privateProviderDetail = "private provider response and source path";
    const cases = [
      async () => {
        throw new Error(privateProviderDetail);
      },
      async () => ({
        ...proposal(),
        responsibilities: [{ text: "Private provider output", sourceIds: ["missing-source"] }],
      }),
      async () => ({ ...proposal(), candidateInstructions: { tone: "candidate instruction" } }),
      async () => ({ ...proposal(), schemaVersion: 2 }),
    ];

    for (const extract of cases) {
      const result = await processOpportunityExtraction({ extract }, request());
      expect(result.role).toBeNull();
      expect(result.employer).toBeNull();
      expect(result.responsibilities).toEqual([]);
      expect(result.requirements).toEqual([]);
      expect(result.priorities).toEqual([]);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({
        code: "extraction-failure",
        status: "open",
        severity: "error",
        sourceIds: ["job-source", "company-source"],
        message: "Opportunity source extraction failed; no facts were applied.",
      });
      expect(JSON.stringify(result)).not.toContain(privateProviderDetail);
      expect(JSON.stringify(result)).not.toContain("Private provider output");
      expect(Object.isFrozen(result)).toBe(true);
    }
  });

  it("does not call a provider for an empty material request", async () => {
    const extract = vi.fn(async () => proposal());
    const result = await processOpportunityExtraction({ extract }, request({ sources: [] }));

    expect(extract).not.toHaveBeenCalled();
    expect(result.issues[0]?.code).toBe("extraction-failure");
    expect(result.issues[0]?.sourceIds).toEqual(["extraction-source"]);
  });

  it("returns a frozen processor object", async () => {
    const processor = createOpportunityExtractionProcessor({
      extract: async () => ({
        schemaVersion: 1,
        role: null,
        employer: null,
        responsibilities: [],
        requirements: [],
        priorities: [],
        contradictions: [],
      }),
    });

    expect(Object.isFrozen(processor)).toBe(true);
    await expect(
      processor.extract(request({ operationId: "processor-operation" })),
    ).resolves.toEqual({
      role: null,
      employer: null,
      responsibilities: [],
      requirements: [],
      priorities: [],
      issues: [],
    });
  });
});
