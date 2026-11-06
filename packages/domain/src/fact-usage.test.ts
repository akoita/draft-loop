import { describe, expect, it } from "vitest";
import {
  emptyFactUsageSettings,
  factUsageAllows,
  factUsageKey,
  factUsageKeyPattern,
  filterFactsForUsage,
  resolveFactUsage,
  withFactUsage,
} from "./fact-usage.js";

const salary = { category: "achievement", field: "Previous salary", value: "Paid well" } as const;
const skill = { category: "skill", field: "language", value: "TypeScript" } as const;

describe("fact usage level", () => {
  it("keys a fact by its normalized content, not its text", () => {
    const key = factUsageKey(salary);
    expect(key).toMatch(factUsageKeyPattern);
    expect(key).not.toContain("salary");
    expect(factUsageKey({ ...salary, field: "  previous   SALARY " })).toBe(key);
    expect(factUsageKey({ ...salary, value: "Paid less" })).not.toBe(key);
    expect(factUsageKey({ ...salary, category: "project" })).not.toBe(key);
  });

  it("reads an unset level as cv", () => {
    expect(resolveFactUsage(emptyFactUsageSettings, salary)).toBe("cv");
  });

  it("lets a fact's own level win over its section's", () => {
    let settings = withFactUsage(
      emptyFactUsageSettings,
      { kind: "section", category: "achievement" },
      "interview-only",
    );
    expect(resolveFactUsage(settings, salary)).toBe("interview-only");
    settings = withFactUsage(settings, { kind: "fact", key: factUsageKey(salary) }, "never-say");
    expect(resolveFactUsage(settings, salary)).toBe("never-say");
    settings = withFactUsage(settings, { kind: "fact", key: factUsageKey(salary) }, undefined);
    expect(resolveFactUsage(settings, salary)).toBe("interview-only");
    expect(emptyFactUsageSettings.facts).toEqual({});
  });

  it("allows cv facts everywhere, interview-only facts in interviews, never-say facts nowhere", () => {
    expect(factUsageAllows("cv", "cv")).toBe(true);
    expect(factUsageAllows("cv", "interview")).toBe(true);
    expect(factUsageAllows("interview-only", "cv")).toBe(false);
    expect(factUsageAllows("interview-only", "interview")).toBe(true);
    expect(factUsageAllows("never-say", "cv")).toBe(false);
    expect(factUsageAllows("never-say", "interview")).toBe(false);
  });

  it("filters facts for a purpose in their order", () => {
    const settings = withFactUsage(
      emptyFactUsageSettings,
      { kind: "fact", key: factUsageKey(salary) },
      "interview-only",
    );
    expect(filterFactsForUsage([salary, skill], settings, "cv")).toEqual([skill]);
    expect(filterFactsForUsage([salary, skill], settings, "interview")).toEqual([salary, skill]);
  });
});
