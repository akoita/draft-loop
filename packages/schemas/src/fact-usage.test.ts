import { factUsageKey } from "@draft-loop/domain/fact-usage";
import { describe, expect, it } from "vitest";
import { factUsageChangeSchema, factUsageSettingsSchema } from "./fact-usage.js";

const key = factUsageKey({ category: "skill", field: "language", value: "TypeScript" });

describe("fact usage schemas", () => {
  it("accepts levels by section and fact key", () => {
    const settings = {
      schemaVersion: 1,
      sections: { achievement: "interview-only" },
      facts: { [key]: "never-say" },
    };
    expect(factUsageSettingsSchema.parse(settings)).toEqual(settings);
  });

  it("refuses fact text as a key, unknown levels, sections and fields", () => {
    const base = { schemaVersion: 1, sections: {}, facts: {} };
    expect(
      factUsageSettingsSchema.safeParse({ ...base, facts: { "my salary": "cv" } }).success,
    ).toBe(false);
    expect(factUsageSettingsSchema.safeParse({ ...base, facts: { [key]: "public" } }).success).toBe(
      false,
    );
    expect(factUsageSettingsSchema.safeParse({ ...base, sections: { salary: "cv" } }).success).toBe(
      false,
    );
    expect(factUsageSettingsSchema.safeParse({ ...base, note: "x" }).success).toBe(false);
  });

  it("parses a change that sets or clears one level", () => {
    expect(factUsageChangeSchema.parse({ kind: "fact", key, level: null })).toEqual({
      kind: "fact",
      key,
      level: null,
    });
    expect(
      factUsageChangeSchema.safeParse({ kind: "section", category: "skill", level: "cv" }).success,
    ).toBe(true);
    expect(factUsageChangeSchema.safeParse({ kind: "fact", key: "x", level: "cv" }).success).toBe(
      false,
    );
  });
});
