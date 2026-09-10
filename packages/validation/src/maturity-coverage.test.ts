import { describe, expect, it } from "vitest";
import { blockStatesMaturityQualifiers, requiredMaturityQualifiers } from "./maturity-coverage.js";

describe("stated organisation-maturity qualifiers", () => {
  it.each([
    ["Early-stage startup experience.", ["early stage"]],
    ["Experience at a seed stage company.", ["seed stage"]],
    ["Pre-seed founding experience.", ["pre seed"]],
    ["Series B scale-up experience.", ["series b", "scale up"]],
    ["Late-stage delivery ownership.", ["late stage"]],
    ["Growth stage hiring.", ["growth stage"]],
  ] as const)("reads the literal qualifier in %s", (requirement, qualifiers) => {
    expect(requiredMaturityQualifiers(requirement)).toEqual(qualifiers);
  });

  it.each([
    "Startup experience.",
    "Built internal tools at a 40-person startup, gaining broad experience.",
    "Experience at a company that raised 12 million dollars.",
    "Delivered a series of migrations.",
    "Seeded the reporting database.",
    "Python tooling.",
  ])("does not infer a qualifier from organisation type or size: %s", (requirement) => {
    expect(requiredMaturityQualifiers(requirement)).toBeUndefined();
  });

  it.each([
    ["Joined an early-stage startup as employee five.", ["early stage"], true],
    [
      "Built internal tools at a 40-person startup, gaining broad experience.",
      ["early stage"],
      false,
    ],
    ["Scaleup platform ownership.", ["scale up"], true],
    ["Raised a Series A round.", ["series a"], true],
    ["Raised a Series A round.", ["series b"], false],
    ["Worked at a large enterprise company, gaining experience.", ["seed stage"], false],
  ] as const)("requires the qualifier in the matched block: %s", (block, required, stated) => {
    expect(blockStatesMaturityQualifiers(block, required)).toBe(stated);
  });
});
