import type { JsonObject } from "@draft-loop/providers";
import { describe, expect, it } from "vitest";

import { promptTemplateVersion } from "./author-adjudication.js";
import {
  createCriticAdjudicationPrompt,
  criticReadsCompactEvidenceTable,
} from "./critic-adjudication.js";
import { parseCritique } from "./critic-critique-contract.js";
import { emphasisReviewInstructions, emphasisThemeBuriedCode } from "./critic-emphasis.js";
import {
  capBlockingOmissions,
  focusedOmissionReviewInstructions,
  isOmissionFindingCode,
  maximumBlockingOmissionFindings,
  maximumFocusedOmissionFindings,
  maximumOmissionFindings,
  omissionReviewInstructions,
  omittedAccomplishmentCode,
} from "./critic-omission.js";

function omissionFinding(overrides: Record<string, unknown>): JsonObject {
  return {
    id: "f1",
    code: omittedAccomplishmentCode,
    category: "coverage",
    severity: "error",
    message:
      '"cut settlement latency by 40%" (chunk-12, payments platform role) proves theme 1; add it as a bullet of that role and shorten its context paragraph.',
    ...overrides,
  } as JsonObject;
}

describe("critic prompt v8", () => {
  it("keeps v7 unchanged and swaps only the omission review; new runs record v9 (#2031, #2039)", () => {
    const v7 = createCriticAdjudicationPrompt("cli-critic-v7");
    const v8 = createCriticAdjudicationPrompt("cli-critic-v8");

    expect(promptTemplateVersion("critic")).toBe("cli-critic-v9");
    expect(v8.replace(focusedOmissionReviewInstructions, omissionReviewInstructions)).toBe(v7);
    expect(v7).not.toContain("chunk by chunk");
    expect(criticReadsCompactEvidenceTable("cli-critic-v8")).toBe(true);
  });

  it("names the candidate chunks, asks for an enumeration per chunk and keeps the rules", () => {
    const v8 = createCriticAdjudicationPrompt("cli-critic-v8");

    expect(v8).toContain(
      "The candidate chunks are the retrievedEvidence chunks that applicationPlan.themes cite in evidenceChunkIds when the input carries the plan, otherwise the chunks achievementPlan names.",
    );
    expect(v8).toContain(
      "list every accomplishment it states with its scope, method or result, and decide for each whether the CV states it with that substance, mentions it only, or leaves it out",
    );
    expect(v8).toContain("A citation is not a statement");
    expect(v8).toContain(`code ${omittedAccomplishmentCode}`);
    expect(v8).toContain("(at most 80 characters)");
    expect(v8).toContain("a plan theme with gap false");
    expect(v8).toContain(`Report at most ${maximumFocusedOmissionFindings} omission findings`);
    expect(maximumFocusedOmissionFindings).toBe(8);
    expect(maximumFocusedOmissionFindings).toBeGreaterThan(maximumOmissionFindings);
    expect(v8).toContain("Never report what applicationPlan.cuts drops or compresses");
    expect(v8).toContain("not also as editorial-missing-evidence or as an emphasis finding");
  });
});

describe("critic prompt v7", () => {
  it("keeps v6 unchanged and adds only the omission review, which new runs record (#2026)", () => {
    const v6 = createCriticAdjudicationPrompt("cli-critic-v6");
    const v7 = createCriticAdjudicationPrompt("cli-critic-v7");

    expect(v6).not.toContain(omittedAccomplishmentCode);
    expect(
      v7
        .replace(omissionReviewInstructions, "")
        .replace(
          "the editorial missing-evidence check, the job emphasis review and the omission review are the only uses",
          "the editorial missing-evidence check and the job emphasis review are the only uses",
        ),
    ).toBe(v6);
    // The omission review follows the emphasis review and precedes the output rules.
    const omissionAt = v7.indexOf(omissionReviewInstructions);
    expect(omissionAt).toBeGreaterThan(v7.indexOf(emphasisReviewInstructions));
    expect(omissionAt).toBeLessThan(v7.indexOf("Do not rewrite content."));
    expect(criticReadsCompactEvidenceTable("cli-critic-v7")).toBe(true);
  });

  it("states what to compare, what to report, the severity rule and the limits", () => {
    const v7 = createCriticAdjudicationPrompt("cli-critic-v7");

    expect(v7).toContain("Compare the whole CV with retrievedEvidence, role by role");
    expect(v7).toContain(
      "applicationPlan.themes when the input carries the plan, otherwise the job's requirements and responsibilities",
    );
    expect(v7).toContain("leaves out or reduces to a bare mention");
    expect(v7).toContain(`coverage finding with code ${omittedAccomplishmentCode}`);
    expect(v7).toContain(
      "quotes the accomplishment in the evidence's words (at most 80 characters)",
    );
    expect(v7).toContain(
      "the descriptive detail to shorten when the CV is already at its length target",
    );
    expect(v7).toContain(
      "Severity is error when the accomplishment proves a supported central theme (a plan theme with gap false, or without a plan a requirement of critical or high priority)",
    );
    expect(v7).toContain(`Report at most ${maximumOmissionFindings} omission findings`);
    expect(v7).toContain("Never report what applicationPlan.cuts drops or compresses");
    expect(v7).toContain("not also as editorial-missing-evidence or as an emphasis finding");
  });

  it("does not leak into earlier template versions", () => {
    for (const version of ["cli-critic-v3", "cli-critic-v4", "cli-critic-v5", "cli-critic-v6"]) {
      expect(createCriticAdjudicationPrompt(version)).not.toContain("omission");
    }
  });
});

describe("omission finding severity", () => {
  it("keeps the first blocking omissions and demotes the rest to warnings", () => {
    const findings = Array.from({ length: maximumOmissionFindings }, (_, index) => ({
      code: omittedAccomplishmentCode,
      severity: "error",
      id: `f${index}`,
    }));

    expect(capBlockingOmissions(findings).map(({ severity }) => severity)).toEqual([
      ...Array.from({ length: maximumBlockingOmissionFindings }, () => "error"),
      ...Array.from(
        { length: maximumOmissionFindings - maximumBlockingOmissionFindings },
        () => "warning",
      ),
    ]);
  });

  it("counts only omission errors against the cap and leaves other findings alone", () => {
    const other = { code: emphasisThemeBuriedCode, severity: "error" };
    const warning = { code: omittedAccomplishmentCode, severity: "warning" };
    const findings = [
      other,
      warning,
      ...Array.from({ length: maximumBlockingOmissionFindings + 1 }, (_, index) => ({
        code: omittedAccomplishmentCode,
        severity: "error",
        id: `f${index}`,
      })),
    ];

    const capped = capBlockingOmissions(findings);

    expect(capped[0]).toBe(other);
    expect(capped[1]).toBe(warning);
    expect(capped.slice(2).map(({ severity }) => severity)).toEqual([
      ...Array.from({ length: maximumBlockingOmissionFindings }, () => "error"),
      "warning",
    ]);
    expect(isOmissionFindingCode(omittedAccomplishmentCode)).toBe(true);
    expect(isOmissionFindingCode("editorial-missing-evidence")).toBe(false);
  });
});

describe("omission findings from the critic", () => {
  it("keeps a blocking omission so the round revises instead of ending ready", () => {
    const critique = parseCritique({ findings: [omissionFinding({})] });

    expect(critique.findings).toHaveLength(1);
    expect(critique.findings[0]).toMatchObject({
      code: omittedAccomplishmentCode,
      category: "coverage",
      severity: "error",
    });
  });

  it("lets at most the cap block in one critique", () => {
    const critique = parseCritique({
      findings: Array.from({ length: maximumOmissionFindings }, (_, index) =>
        omissionFinding({ id: `f${index}` }),
      ),
    });

    expect(critique.findings.filter(({ severity }) => severity === "error")).toHaveLength(
      maximumBlockingOmissionFindings,
    );
    expect(critique.findings.filter(({ severity }) => severity === "warning")).toHaveLength(
      maximumOmissionFindings - maximumBlockingOmissionFindings,
    );
  });
});
