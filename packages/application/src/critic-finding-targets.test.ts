import type { ContextSnapshot } from "@draft-loop/domain";
import type { JsonObject } from "@draft-loop/providers";
import type { DraftArtifact } from "@draft-loop/schemas";
import { describe, expect, it } from "vitest";

import {
  createCriticAdjudicationPrompt,
  criticReadsCompactEvidenceTable,
  criticReportsFindingTargets,
} from "./critic-adjudication.js";
import {
  critiqueOutputSchemaFor,
  critiqueOutputSchemaWithCoverageJudgements,
  parseCritique,
  targetedCritiqueOutputSchemaWithCoverageJudgements,
  withResolvableFindingTargets,
} from "./critic-critique-contract.js";
import { blockingOmissionCheckFindings, omissionCheckScope } from "./critic-omission-check.js";
import { criticRunOutputSchemas } from "./critic-run-prefix.js";

const findingItems = (schema: JsonObject) =>
  ((schema.properties as JsonObject).findings as JsonObject).items as JsonObject;

const finding = (fields: Record<string, string>) => ({
  id: "f1",
  code: "unsupported-claim",
  category: "evidence",
  severity: "error",
  message: "Claim claim-1 lacks support.",
  ...fields,
});

const artifact = {
  claims: [{ id: "claim-1" }],
  sections: [{ id: "experience", blocks: [] }],
} as unknown as DraftArtifact;
const context = { requirements: [{ id: "req-1" }] } as unknown as ContextSnapshot;

describe("critic finding targets (cli-critic-v11, #2232)", () => {
  it("asks only v11 for targets, keeping v10's check and compact table", () => {
    expect(criticReportsFindingTargets("cli-critic-v11")).toBe(true);
    expect(criticReportsFindingTargets("cli-critic-v10")).toBe(false);
    expect(criticReadsCompactEvidenceTable("cli-critic-v11")).toBe(true);
    expect(omissionCheckScope("cli-critic-v11")).toBe("every-chunk");
    expect(blockingOmissionCheckFindings("cli-critic-v11")).toBe(
      blockingOmissionCheckFindings("cli-critic-v10"),
    );
  });

  it("swaps only the ids-in-the-message passage of the v6 prompt", () => {
    const v6 = createCriticAdjudicationPrompt("cli-critic-v6");
    const v11 = createCriticAdjudicationPrompt("cli-critic-v11");
    expect(v6).toContain("include the affected claim ID and cited evidence reference ID(s)");
    expect(v11).not.toContain("include the affected claim ID");
    expect(v11).toContain("claimId is the id of the artifact claim it concerns");
    expect(v11).toContain("leave a field as an empty string when it does not apply");
    const [before] = v6.split("Use the existing structured finding fields only;");
    expect(v11.startsWith(before ?? "")).toBe(true);
  });

  it("declares the targets as required strings only in the v11 schema", () => {
    const targeted = findingItems(targetedCritiqueOutputSchemaWithCoverageJudgements);
    expect(targeted.required).toEqual([
      "id",
      "code",
      "category",
      "severity",
      "message",
      "claimId",
      "sectionId",
      "requirementId",
    ]);
    expect(targeted.additionalProperties).toBe(false);
    expect(findingItems(critiqueOutputSchemaWithCoverageJudgements).properties).not.toHaveProperty(
      "claimId",
    );
    expect(critiqueOutputSchemaFor("cli-critic-v10")).toBe(
      critiqueOutputSchemaWithCoverageJudgements,
    );
    expect(criticRunOutputSchemas("cli-critic-v11").draft_critique).toBe(
      targetedCritiqueOutputSchemaWithCoverageJudgements,
    );
  });

  it("reads an empty target as none", () => {
    const parsed = parseCritique({
      findings: [finding({ claimId: " claim-1 ", sectionId: "", requirementId: "" })],
    });
    expect(parsed.findings[0]).toMatchObject({ claimId: "claim-1" });
    expect(parsed.findings[0]).not.toHaveProperty("sectionId");
    expect(parsed.findings[0]).not.toHaveProperty("requirementId");
  });

  it("drops a target the artifact or the job does not have", () => {
    const parsed = parseCritique({
      findings: [
        finding({ claimId: "claim-1", sectionId: "experience", requirementId: "req-1" }),
        finding({ claimId: "claim-404", sectionId: "missing", requirementId: "req-404" }),
      ],
    });
    const resolved = withResolvableFindingTargets(parsed, artifact, context);
    expect(resolved.findings[0]).toMatchObject({
      claimId: "claim-1",
      sectionId: "experience",
      requirementId: "req-1",
    });
    expect(resolved.findings[1]).not.toHaveProperty("claimId");
    expect(resolved.findings[1]).not.toHaveProperty("sectionId");
    expect(resolved.findings[1]).not.toHaveProperty("requirementId");
    expect(resolved.findings[1]?.message).toBe("Claim claim-1 lacks support.");
  });
});
