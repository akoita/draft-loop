import { describe, expect, it } from "vitest";
import { explicitDegreeCoverage } from "./degree-coverage.js";

const requirement = "Computer-science or quantitative degree preferred.";

describe("explicit degree alternatives", () => {
  it.each([
    "MSc in Computer Science, Distributed Systems, 2012 to 2014",
    "BSc in Computer Science",
    "Earned a bachelor's degree in computer science.",
    "Master’s degree in Computer Science",
    "PhD in Computer Science, 2016",
    "Degree in quantitative field",
  ])("matches an explicit permitted credential: %s", (text) => {
    expect(explicitDegreeCoverage(requirement, [text])).toBe(true);
  });

  it.each([
    "MSc in Literature",
    "Computer science coursework for a quantitative degree",
    "No degree in Computer Science",
    "MSc in Computer Science, not completed",
    "MSc in Computer Science, in progress",
    "MSc in Computer Science, expected",
    "MSc in Computer Science, candidate",
    "MSc in Computer Science, incomplete",
    "MSc in Computer Science, honorary",
    "MSc in Computer Science, required",
    "Studying for a degree in Computer Science",
    "MSc in Literature, Computer Science",
    "MSc in Mathematics",
    "Computer Science",
    "MSc in",
  ])("does not establish the permitted degree: %s", (text) => {
    expect(explicitDegreeCoverage(requirement, [text])).toBe(false);
  });

  it("does not join a degree and subject across blocks", () => {
    expect(explicitDegreeCoverage(requirement, ["MSc", "Computer Science"])).toBe(false);
  });

  it("respects the permitted subject instead of treating every degree as equivalent", () => {
    expect(
      explicitDegreeCoverage("Quantitative degree required", ["MSc in Computer Science"]),
    ).toBe(false);
    expect(
      explicitDegreeCoverage("Computer science degree required", ["MSc in quantitative field"]),
    ).toBe(false);
  });

  it("leaves compound, level-specific, and unrelated requirements to existing coverage", () => {
    for (const text of [
      "Master's degree in computer science required",
      "Computer science degree and production experience",
      "Python tooling",
    ]) {
      expect(explicitDegreeCoverage(text, [])).toBeUndefined();
    }
  });
});
