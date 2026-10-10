import { describe, expect, it } from "vitest";

import {
  createCanonicalCandidateProfile,
  SemanticValidationError,
  validateCanonicalCandidateProfile,
} from "./index.js";

const timestamp = "2026-08-27T10:00:00.000Z";

function input(extra: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    version: 1,
    parentVersion: null,
    status: "draft" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    facts: [],
    ...extra,
  };
}

const sensitivity = {
  excludedTiers: ["sensitive", "never-share"],
  rules: [
    { storeId: "store-1", knowledgeBaseId: "kb-1", rulesVersion: 2, rulesChecksum: "a".repeat(64) },
    { storeId: "store-1", knowledgeBaseId: "kb-2", rulesVersion: 1, rulesChecksum: "b".repeat(64) },
  ],
};
const routeIdentity = { company: "mistral", modelId: "m", promptTemplateVersion: "v1" };
const badSensitivities: readonly unknown[] = [
  { ...sensitivity, excludedTiers: ["sensitive", "secret"] },
  { ...sensitivity, excludedTiers: ["sensitive", "sensitive"] },
  { ...sensitivity, rules: [{ ...sensitivity.rules[0], rulesChecksum: "A".repeat(64) }] },
  { ...sensitivity, rules: [{ ...sensitivity.rules[0], rulesChecksum: "abc" }] },
  { ...sensitivity, rules: [{ ...sensitivity.rules[0], rulesVersion: 0 }] },
  { ...sensitivity, rules: [{ ...sensitivity.rules[0], path: "/private" }] },
  { ...sensitivity, rules: [sensitivity.rules[0], sensitivity.rules[0]] },
  { ...sensitivity, extra: true },
  { excludedTiers: [] },
  "sensitive",
];

describe("canonical candidate profile extraction identity", () => {
  it("omits the identity when none is supplied", () => {
    expect(createCanonicalCandidateProfile(input())).not.toHaveProperty("extraction");
  });

  it("trims and freezes the identity, keeping an optional extraction profile", () => {
    const profile = createCanonicalCandidateProfile(
      input({
        extraction: {
          company: " mistral ",
          modelId: " synthetic-model ",
          promptTemplateVersion: " v1 ",
          extractionProfile: { id: " profile ", version: 3 },
        },
      }),
    );

    expect(profile.extraction).toEqual({
      company: "mistral",
      modelId: "synthetic-model",
      promptTemplateVersion: "v1",
      extractionProfile: { id: "profile", version: 3 },
    });
    expect(Object.isFrozen(profile.extraction)).toBe(true);
  });

  it("rejects an incomplete or unsupported identity", () => {
    const bad = [
      { company: "mistral", modelId: "m" },
      { company: "mistral", modelId: "m", promptTemplateVersion: "v1", extra: true },
      {
        company: "mistral",
        modelId: "m",
        promptTemplateVersion: "v1",
        extractionProfile: { id: "p", version: 1.5 },
      },
      "m",
    ];
    for (const extraction of bad) {
      expect(validateCanonicalCandidateProfile(input({ extraction })).valid).toBe(false);
      expect(() => createCanonicalCandidateProfile(input({ extraction }) as never)).toThrow(
        SemanticValidationError,
      );
    }
  });

  it("copies and freezes the sensitivity record, and accepts an empty rules list", () => {
    const profile = createCanonicalCandidateProfile(
      input({ extraction: { ...routeIdentity, sensitivity } }),
    );
    const none = createCanonicalCandidateProfile(
      input({
        extraction: { ...routeIdentity, sensitivity: { excludedTiers: [], rules: [] } },
      }),
    );

    expect(profile.extraction?.sensitivity).toEqual(sensitivity);
    expect(profile.extraction?.sensitivity).not.toBe(sensitivity);
    expect(Object.isFrozen(profile.extraction?.sensitivity?.rules[0])).toBe(true);
    expect(none.extraction?.sensitivity).toEqual({ excludedTiers: [], rules: [] });
    expect(
      createCanonicalCandidateProfile(input({ extraction: routeIdentity })).extraction,
    ).toEqual(routeIdentity);
  });

  it("rejects a malformed sensitivity record", () => {
    for (const bad of badSensitivities) {
      const extraction = { ...routeIdentity, sensitivity: bad };
      expect(validateCanonicalCandidateProfile(input({ extraction })).valid).toBe(false);
    }
  });
});
