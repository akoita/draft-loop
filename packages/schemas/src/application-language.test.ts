import { describe, expect, it } from "vitest";

import { applicationLanguagesSchema, documentLanguageCodeSchema } from "./application-language.js";

describe("applicationLanguagesSchema", () => {
  it("accepts offered languages by application id", () => {
    const parsed = applicationLanguagesSchema.parse({
      schemaVersion: 1,
      languages: { "application-1": "fr", "application-2": "en" },
    });
    expect(parsed.languages["application-1"]).toBe("fr");
  });

  it("refuses a language that is not offered and unknown fields", () => {
    expect(documentLanguageCodeSchema.safeParse("klingon").success).toBe(false);
    expect(
      applicationLanguagesSchema.safeParse({ schemaVersion: 1, languages: { a: "xx" } }).success,
    ).toBe(false);
    expect(
      applicationLanguagesSchema.safeParse({ schemaVersion: 1, languages: {}, extra: 1 }).success,
    ).toBe(false);
  });
});
