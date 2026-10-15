import type { JsonObject } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { promptTemplateVersion } from "./author-adjudication.js";
import { createCriticAdjudicationPrompt, maximumCritiqueFindings } from "./critic-adjudication.js";
import { parseCritique } from "./critic-critique-contract.js";
import {
  emphasisFindingCodes,
  emphasisOrderCode,
  emphasisPaddingCode,
  emphasisReviewInstructions,
  emphasisThemeBuriedCode,
  emphasisThemeGapCode,
  isEmphasisFindingCode,
  normalizeEmphasisSeverity,
} from "./critic-emphasis.js";

function emphasisFinding(overrides: Record<string, unknown>): JsonObject {
  return {
    id: "f1",
    code: emphasisThemeBuriedCode,
    category: "coverage",
    severity: "warning",
    message: "Expand tokenisation.",
    ...overrides,
  } as JsonObject;
}

describe("critic prompt v5", () => {
  it("is what new runs record, and keeps v4 unchanged", () => {
    const v4 = createCriticAdjudicationPrompt("cli-critic-v4");
    const v5 = createCriticAdjudicationPrompt("cli-critic-v5");

    expect(promptTemplateVersion("critic")).toBe("cli-critic-v5");
    expect(v4).not.toContain("emphasis");
    expect(v4).toContain("This source-to-CV completeness check and the editorial missing-evidence");
    expect(v5).not.toBe(v4);
    // v5 keeps the whole v4 review and adds the emphasis block before the output rules.
    expect(v5).toContain("(code editorial-missing-evidence)");
    expect(v5).toContain("the editorial missing-evidence check and the job emphasis review");
    const emphasisAt = v5.indexOf(emphasisReviewInstructions);
    expect(emphasisAt).toBeGreaterThan(v5.indexOf("Also review the CV as an editor"));
    expect(emphasisAt).toBeLessThan(v5.indexOf("Do not rewrite content."));
  });

  it("states the codes, the moves, the severity rule and the unsupported-theme rule", () => {
    const v5 = createCriticAdjudicationPrompt("cli-critic-v5");

    for (const code of emphasisFindingCodes) {
      expect(v5).toContain(code);
    }
    expect(v5).toContain("weighting them by priority and by how often the job repeats them");
    expect(v5).toContain("what it expands, and what it compresses or pads");
    expect(v5).toContain("names one concrete move");
    expect(v5).toContain("quoting the requirement id when one applies");
    expect(v5).toContain("Severity is warning by default");
    expect(v5).toContain(
      `Use error only for ${emphasisThemeBuriedCode} when the job's top-priority theme is missing from the summary and core areas and retrievedEvidence clearly supports it`,
    );
    expect(v5).toContain("do not ask for a move");
    expect(v5).toContain("never ask for content the evidence lacks");
  });

  it("does not leak into earlier template versions", () => {
    for (const version of ["cli-critic-v1", "cli-critic-v2", "cli-critic-v3", "cli-critic-v4"]) {
      expect(createCriticAdjudicationPrompt(version)).not.toContain("emphasis-");
    }
  });
});

describe("emphasis finding severity", () => {
  it("lets only the buried-theme finding block", () => {
    expect(normalizeEmphasisSeverity({ code: emphasisThemeBuriedCode, severity: "error" })).toEqual(
      { code: emphasisThemeBuriedCode, severity: "error" },
    );
    for (const code of [emphasisPaddingCode, emphasisOrderCode, emphasisThemeGapCode]) {
      expect(normalizeEmphasisSeverity({ code, severity: "error" })).toEqual({
        code,
        severity: "warning",
      });
    }
  });

  it("leaves other codes alone and recognises the family", () => {
    const finding = { code: "editorial-fragment", severity: "error" };
    expect(normalizeEmphasisSeverity(finding)).toBe(finding);
    expect(emphasisFindingCodes.every(isEmphasisFindingCode)).toBe(true);
    expect(isEmphasisFindingCode("editorial-fragment")).toBe(false);
  });
});

// Fixture critic outputs for the three cases the strategic review must separate.
describe("emphasis findings from the critic", () => {
  it("keeps a blocking finding when the summary omits a supported top theme", () => {
    const critique = parseCritique({
      findings: [
        emphasisFinding({
          severity: "error",
          message:
            "Move tokenisation (req-1, chunk-7) up into the summary and core areas; it is the job's top theme and the evidence supports it.",
        }),
      ],
    });

    expect(critique.findings).toHaveLength(1);
    expect(critique.findings[0]).toMatchObject({
      code: emphasisThemeBuriedCode,
      category: "coverage",
      severity: "error",
    });
  });

  it("keeps padding as a warning and demotes a blocking padding finding", () => {
    const critique = parseCritique({
      findings: [
        emphasisFinding({
          id: "f1",
          code: emphasisPaddingCode,
          message: "Compress or drop the four certifications; the job does not ask for them.",
        }),
        emphasisFinding({
          id: "f2",
          code: emphasisPaddingCode,
          severity: "error",
          message: "Drop the unrelated hobby bullets.",
        }),
      ],
    });

    expect(critique.findings.map((finding) => finding.severity)).toEqual(["warning", "warning"]);
  });

  it("reports an unsupported theme as a gap warning, never a blocking move", () => {
    const critique = parseCritique({
      findings: [
        emphasisFinding({
          code: emphasisThemeGapCode,
          severity: "error",
          message:
            "The job centres on settlement work (req-3), but the approved evidence does not support it. This is a gap, not something to add.",
        }),
      ],
    });

    expect(critique.findings[0]).toMatchObject({
      code: emphasisThemeGapCode,
      severity: "warning",
    });
  });

  it("counts emphasis findings in the shared findings limit", () => {
    const findings = Array.from({ length: maximumCritiqueFindings + 1 }, (_, index) =>
      emphasisFinding({ id: `f${index}` }),
    );

    expect(() => parseCritique({ findings })).toThrow("too many findings");
  });
});
