import { describe, expect, it } from "vitest";

import { extractProtectedValues, supportsProtectedValue } from "./author-grounding.js";

describe("acronym grounding (#3089)", () => {
  it("accepts a spelled-out phrase when the source holds its acronym", () => {
    const teacher = "Class teacher for Year 5 at Brookmere Primary School, KS2, since 2020.";
    expect(supportsProtectedValue(teacher, "Key Stage 2")).toBe(true);
    expect(supportsProtectedValue(teacher, "Key Stage 1")).toBe(false);
    expect(supportsProtectedValue("Six months in the ICU.", "Intensive Care Unit")).toBe(true);
    expect(
      supportsProtectedValue("Hold current ALS and BLS.", "Current Advanced Life Support"),
    ).toBe(true);
  });

  it("keeps a numbered name such as Key Stage 2 as one protected value", () => {
    const values = extractProtectedValues("Pupils in Key Stage 2 gained 3 grades.");
    expect(values).toContain("Key Stage 2");
    expect(values).toContain("3");
    expect(values).not.toContain("2");
    expect(extractProtectedValues("Raised Key Stage 2 results.")).not.toContain("2");
  });

  it("accepts an acronym when the source spells out its phrase", () => {
    expect(supportsProtectedValue("Qualified Teacher Status awarded in 2019.", "QTS")).toBe(true);
  });

  it("keeps working for a software acronym", () => {
    expect(
      supportsProtectedValue(
        "Ran the SRE rota for the payments team.",
        "Site Reliability Engineering",
      ),
    ).toBe(true);
    expect(supportsProtectedValue("Built CI/CD pipelines.", "Continuous Integration")).toBe(true);
  });

  it("refuses initials or numbers that do not match exactly", () => {
    expect(supportsProtectedValue("Hold a current BLS certificate.", "Advanced Life Support")).toBe(
      false,
    );
    expect(
      supportsProtectedValue("Hold a current ALS certificate.", "Paediatric Life Support"),
    ).toBe(false);
    expect(supportsProtectedValue("Taught KS2 for four years.", "2")).toBe(false);
    expect(supportsProtectedValue("Qualified Teacher Status awarded in 2019.", "QTP")).toBe(false);
    expect(supportsProtectedValue("Taught Key Stage 2.", "KS3")).toBe(false);
  });
});
