import { describe, expect, it } from "vitest";

import { writeRunPreflight } from "./run-model-profiles.js";
import { requirementsSourcePreflightLine } from "./run-requirements-source.js";

const requirement = (id: string) => ({ id, text: `Private requirement ${id}`, priority: "high" });

describe("requirements source preflight line", () => {
  it("names the exact reviewed brief version and requirement count without requirement text", () => {
    const line = requirementsSourcePreflightLine({
      requirements: [requirement("r1"), requirement("r2")],
      opportunityBriefReference: { briefId: "target-role", version: 3, checksum: "a".repeat(64) },
    } as never);
    expect(line).toBe("Requirements: reviewed opportunity brief target-role v3 (2 requirements)");
    expect(line).not.toContain("Private");
  });

  it("says the requirements are unreviewed source units when no brief is bound", () => {
    expect(requirementsSourcePreflightLine({ requirements: [requirement("r1")] } as never)).toBe(
      "Requirements: job description (unreviewed source units)",
    );
  });

  it("is written between the provider pairing and the budget", () => {
    const lines: string[] = [];
    writeRunPreflight(
      {
        authorCompany: "anthropic",
        authorModel: "a",
        criticCompany: "openai",
        criticModel: "b",
        fixtureMode: true,
      },
      (line) => lines.push(line),
      { maxRounds: 2 },
      {
        requirements: [requirement("r1")],
        modelConfiguration: {
          author: { company: "anthropic", modelId: "a" },
          critic: { company: "openai", modelId: "b" },
        },
      } as never,
    );
    expect(lines[0]).toMatch(/^Provider pairing:/u);
    expect(lines[1]).toBe("Requirements: job description (unreviewed source units)");
    expect(lines[2]).toMatch(/^Budget:/u);
  });
});
