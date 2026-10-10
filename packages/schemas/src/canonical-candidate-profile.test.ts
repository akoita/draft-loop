import {
  createCanonicalCandidateProfile,
  maximumCanonicalCandidateProfileProvenanceQuoteLength,
} from "@draft-loop/domain";
import { describe, expect, it } from "vitest";

import {
  canonicalCandidateProfileSchema,
  parseCanonicalCandidateProfile,
  serializeCanonicalCandidateProfile,
} from "./index.js";

const timestamp = "2026-08-27T10:00:00.000Z";

function profilePayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "profile-1",
    version: 1,
    parentVersion: null,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    candidateKnowledgeSelection: {
      capturedAt: timestamp,
      entries: [
        {
          storeId: "store-1",
          knowledgeBaseId: "knowledge-1",
          sources: [
            {
              sourceId: "source-1",
              versionId: "version-1",
              lifecycleRevision: {
                knowledgeBaseState: "active",
                knowledgeBaseArchivedAt: null,
                versionId: "version-1",
                version: 1,
                createdAt: timestamp,
                managed: true,
                originBoundAt: timestamp,
                observation: null,
                retirement: null,
                provenanceFetchedAt: null,
                directory: null,
              },
            },
          ],
        },
      ],
    },
    facts: [
      {
        id: "fact-1",
        category: "role",
        field: "title",
        value: "Platform Engineer",
        provenance: [
          {
            storeId: "store-1",
            knowledgeBaseId: "knowledge-1",
            sourceId: "source-1",
            versionId: "version-1",
            kind: "candidate-provided",
          },
        ],
      },
    ],
    issues: [],
    ...extra,
  };
}

const identity = {
  company: "mistral",
  modelId: "synthetic-model",
  promptTemplateVersion: "synthetic-extraction-v1",
  extractionProfile: { id: "synthetic-extraction-profile", version: 2 },
};

describe("canonical profile extraction identity", () => {
  it("parses a payload persisted before the identity existed, without adding one", () => {
    const parsed = canonicalCandidateProfileSchema.parse(profilePayload());

    expect(parsed).not.toHaveProperty("extraction");
    expect(parseCanonicalCandidateProfile(serializeCanonicalCandidateProfile(parsed))).toEqual(
      parsed,
    );
  });

  it("round-trips the identity with and without an extraction profile", () => {
    const withProfile = canonicalCandidateProfileSchema.parse(
      profilePayload({ extraction: identity }),
    );
    const { extractionProfile: _extractionProfile, ...withoutProfileIdentity } = identity;
    const withoutProfile = canonicalCandidateProfileSchema.parse(
      profilePayload({ extraction: { ...withoutProfileIdentity, modelId: " padded-model " } }),
    );

    expect(withProfile.extraction).toEqual(identity);
    expect(parseCanonicalCandidateProfile(serializeCanonicalCandidateProfile(withProfile))).toEqual(
      withProfile,
    );
    expect(withoutProfile.extraction).toEqual({
      ...withoutProfileIdentity,
      modelId: "padded-model",
    });
    expect(Object.isFrozen(withProfile.extraction)).toBe(true);
    expect(Object.isFrozen(withProfile.extraction?.extractionProfile)).toBe(true);
  });

  it("rejects unknown, empty, and malformed identity fields", () => {
    for (const extraction of [
      { ...identity, apiKey: "secret" },
      { ...identity, modelId: " " },
      { ...identity, promptTemplateVersion: undefined },
      { ...identity, extractionProfile: { id: "profile", version: 0 } },
      { ...identity, extractionProfile: { id: "profile", version: 1, path: "/x" } },
      "synthetic-model",
    ]) {
      expect(() => canonicalCandidateProfileSchema.parse(profilePayload({ extraction }))).toThrow();
    }
  });

  it("round-trips the sensitivity record and still parses an identity without one", () => {
    const sensitivity = {
      excludedTiers: ["sensitive", "never-share"],
      rules: [
        {
          storeId: "store-1",
          knowledgeBaseId: "kb-1",
          rulesVersion: 2,
          rulesChecksum: "a".repeat(64),
        },
      ],
    };
    const parsed = canonicalCandidateProfileSchema.parse(
      profilePayload({ extraction: { ...identity, sensitivity } }),
    );

    expect(parsed.extraction?.sensitivity).toEqual(sensitivity);
    expect(Object.isFrozen(parsed.extraction?.sensitivity?.rules)).toBe(true);
    expect(parseCanonicalCandidateProfile(serializeCanonicalCandidateProfile(parsed))).toEqual(
      parsed,
    );
    expect(
      canonicalCandidateProfileSchema.parse(profilePayload({ extraction: identity })).extraction,
    ).not.toHaveProperty("sensitivity");
  });

  it("rejects unknown tiers, duplicates, bad checksums, and unsupported fields", () => {
    const rule = {
      storeId: "store-1",
      knowledgeBaseId: "kb-1",
      rulesVersion: 2,
      rulesChecksum: "a".repeat(64),
    };
    for (const sensitivity of [
      { excludedTiers: ["secret"], rules: [] },
      { excludedTiers: ["sensitive", "sensitive"], rules: [] },
      { excludedTiers: [], rules: [{ ...rule, rulesChecksum: "ABC" }] },
      { excludedTiers: [], rules: [{ ...rule, rulesVersion: 0 }] },
      { excludedTiers: [], rules: [{ ...rule, path: "/private" }] },
      { excludedTiers: [], rules: [rule, { ...rule, rulesVersion: 3 }] },
      { excludedTiers: [] },
    ]) {
      expect(() =>
        canonicalCandidateProfileSchema.parse(
          profilePayload({ extraction: { ...identity, sensitivity } }),
        ),
      ).toThrow();
    }
  });
});

describe("canonical profile fact provenance quotes", () => {
  const reference = {
    storeId: "store-1",
    knowledgeBaseId: "knowledge-1",
    sourceId: "source-1",
    versionId: "version-1",
    kind: "candidate-provided",
  };
  const fact = {
    id: "fact-1",
    category: "role",
    field: "title",
    value: "Platform Engineer",
  };

  function withQuote(quote: unknown) {
    return profilePayload({ facts: [{ ...fact, provenance: [{ ...reference, quote }] }] });
  }

  it("round-trips a fact quote and trims it", () => {
    const parsed = canonicalCandidateProfileSchema.parse(
      withQuote("Led the Platform Engineer team"),
    );
    expect(parsed.facts[0]?.provenance[0]?.quote).toBe("Led the Platform Engineer team");
    expect(parseCanonicalCandidateProfile(serializeCanonicalCandidateProfile(parsed))).toEqual(
      parsed,
    );
    const padded = canonicalCandidateProfileSchema.parse(withQuote("  padded quote \n"));
    expect(padded.facts[0]?.provenance[0]?.quote).toBe("padded quote");
  });

  it("keeps a payload without quotes valid and adds none", () => {
    const parsed = canonicalCandidateProfileSchema.parse(profilePayload());
    expect(parsed.facts[0]?.provenance[0]).not.toHaveProperty("quote");
  });

  it("rejects empty, oversized, and non-string quotes", () => {
    for (const quote of [
      "",
      "   ",
      "x".repeat(maximumCanonicalCandidateProfileProvenanceQuoteLength + 1),
      7,
      null,
    ]) {
      expect(() => canonicalCandidateProfileSchema.parse(withQuote(quote))).toThrow();
    }
    expect(() =>
      canonicalCandidateProfileSchema.parse(
        withQuote("x".repeat(maximumCanonicalCandidateProfileProvenanceQuoteLength)),
      ),
    ).not.toThrow();
  });

  it("does not let a quote change which references are duplicates", () => {
    expect(() =>
      canonicalCandidateProfileSchema.parse(
        profilePayload({
          facts: [
            {
              ...fact,
              provenance: [
                { ...reference, quote: "one" },
                { ...reference, quote: "two" },
              ],
            },
          ],
        }),
      ),
    ).toThrow(/unique/u);
  });

  it("never accepts a quote on an issue source reference", () => {
    const issue = {
      id: "issue-1",
      code: "omission",
      severity: "warning",
      status: "open",
      message: "Review required.",
      factIds: [],
      sourceRefs: [reference],
    };
    expect(() =>
      canonicalCandidateProfileSchema.parse(profilePayload({ issues: [issue] })),
    ).not.toThrow();
    const quoted = { ...issue, sourceRefs: [{ ...reference, quote: "Led the team" }] };
    expect(() =>
      canonicalCandidateProfileSchema.parse(profilePayload({ issues: [quoted] })),
    ).toThrow();

    // The domain validator rejects it too, independently of the schema.
    const parsed = canonicalCandidateProfileSchema.parse(profilePayload({ issues: [issue] }));
    expect(() =>
      createCanonicalCandidateProfile({
        ...parsed,
        issues: [{ ...issue, sourceRefs: [{ ...reference, quote: "Led the team" }] }],
      } as never),
    ).toThrow();
  });
});
