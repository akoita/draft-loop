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
});
