import { describe, expect, it } from "vitest";

import {
  type ApplicationPlan,
  type ApplicationPlanState,
  applicationPlanGaps,
  applicationPlanJsonSchema,
  applicationPlanJsonSchemaForReferences,
  applicationPlanReviewSchema,
  applicationPlanSchema,
  applicationPlanStateSchema,
  guidingApplicationPlan,
  isApplicationPlanComplete,
  validateApplicationPlan,
  validateApplicationPlanReview,
} from "./application-plan.js";

const references = { evidenceChunkIds: ["e1", "e2"], requirementIds: ["r1", "r2"] };

function theme(overrides: Partial<ApplicationPlan["themes"][number]> = {}) {
  return {
    title: "Tokenisation",
    rationale: "The job centres on it.",
    requirementIds: ["r1"],
    evidenceChunkIds: ["e1"],
    gap: false,
    ...overrides,
  };
}

function plan(overrides: Partial<ApplicationPlan> = {}): ApplicationPlan {
  return {
    themes: [theme(), theme({ title: "Payments", evidenceChunkIds: ["e2"] }), theme()],
    leads: {
      summaryAngle: "Lead with tokenisation delivery.",
      coreAreas: [
        { text: "Tokenisation", themeRank: 1 },
        { text: "Payments", themeRank: 2 },
        { text: "Platform", themeRank: 3 },
      ],
    },
    cuts: [{ action: "compress", target: "Certification list", reason: "The job ignores it." }],
    ...overrides,
  };
}

describe("application plan schema", () => {
  it("accepts a plan whose themes cite approved evidence and requirements", () => {
    const parsed = applicationPlanSchema.parse(plan());
    expect(validateApplicationPlan(parsed, references)).toEqual([]);
  });

  it("bounds the theme count to 3-5", () => {
    expect(applicationPlanSchema.safeParse(plan({ themes: [theme(), theme()] })).success).toBe(
      false,
    );
    expect(
      applicationPlanSchema.safeParse(plan({ themes: Array.from({ length: 6 }, () => theme()) }))
        .success,
    ).toBe(false);
    expect(
      applicationPlanSchema.safeParse(plan({ themes: Array.from({ length: 5 }, () => theme()) }))
        .success,
    ).toBe(true);
  });

  it("allows a gap theme without evidence and refuses one that cites evidence", () => {
    const gap = theme({ title: "Kubernetes", evidenceChunkIds: [], gap: true });
    const withGap = plan({ themes: [theme(), theme(), gap] });
    expect(applicationPlanSchema.safeParse(withGap).success).toBe(true);
    expect(applicationPlanGaps(withGap).map(({ title }) => title)).toEqual(["Kubernetes"]);
    expect(
      applicationPlanSchema.safeParse(
        plan({ themes: [theme(), theme(), { ...gap, evidenceChunkIds: ["e1"] }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses a supported theme without proof", () => {
    expect(
      applicationPlanSchema.safeParse(
        plan({ themes: [theme(), theme(), theme({ evidenceChunkIds: [] })] }),
      ).success,
    ).toBe(false);
  });

  it("rejects unknown evidence and requirement ids", () => {
    const issues = validateApplicationPlan(
      plan({
        themes: [
          theme({ evidenceChunkIds: ["e1", "ghost"] }),
          theme({ requirementIds: ["nope"] }),
          theme(),
        ],
      }),
      references,
    );
    expect(issues).toEqual([
      { code: "unknown-evidence-id", path: "themes.0.evidenceChunkIds.1" },
      { code: "unknown-requirement-id", path: "themes.1.requirementIds.0" },
    ]);
  });

  it("refuses a core area that serves a gap or a missing theme", () => {
    const gap = theme({ evidenceChunkIds: [], gap: true });
    const issues = validateApplicationPlan(
      plan({
        themes: [theme(), theme(), gap],
        leads: {
          summaryAngle: "x",
          coreAreas: [
            { text: "a", themeRank: 3 },
            { text: "b", themeRank: 5 },
            { text: "c", themeRank: 1 },
          ],
        },
      }),
      references,
    );
    expect(issues.map(({ code }) => code)).toEqual([
      "core-area-on-gap-theme",
      "core-area-theme-out-of-range",
    ]);
  });

  it("rejects extra members", () => {
    expect(applicationPlanSchema.safeParse({ ...plan(), extra: true }).success).toBe(false);
  });
});

describe("application plan review and state", () => {
  it("requires points for a revise and checks theme ranks", () => {
    expect(applicationPlanReviewSchema.safeParse({ verdict: "revise", points: [] }).success).toBe(
      false,
    );
    const accept = applicationPlanReviewSchema.parse({ verdict: "accept", points: [] });
    expect(accept.verdict).toBe("accept");
    const revise = applicationPlanReviewSchema.parse({
      verdict: "revise",
      points: [{ text: "Lead with payments.", themeRank: 5 }],
    });
    expect(validateApplicationPlanReview(revise, plan())).toEqual([
      { code: "review-point-theme-out-of-range", path: "points.0" },
    ]);
  });

  it("is complete after an accept, or after a revise and its one revision", () => {
    const base: ApplicationPlanState = {
      schemaVersion: 1,
      plan: plan(),
      review: null,
      revisedPlan: null,
      steps: [],
    };
    const revised = plan({ cuts: [] });
    expect(isApplicationPlanComplete(base)).toBe(false);
    expect(isApplicationPlanComplete({ ...base, review: { verdict: "accept", points: [] } })).toBe(
      true,
    );
    const asked = {
      ...base,
      review: { verdict: "revise" as const, points: [{ text: "x", themeRank: null }] },
    };
    expect(isApplicationPlanComplete(asked)).toBe(false);
    expect(isApplicationPlanComplete({ ...asked, revisedPlan: revised })).toBe(true);
    expect(guidingApplicationPlan({ ...asked, revisedPlan: revised })).toBe(revised);
    expect(applicationPlanStateSchema.safeParse({ ...asked, revisedPlan: revised }).success).toBe(
      true,
    );
  });

  it("narrows the structured-output schema to the request's ids", () => {
    const narrowed = JSON.stringify(
      applicationPlanJsonSchemaForReferences(applicationPlanJsonSchema, {
        evidenceChunkIds: ["E1", "E2"],
        requirementIds: ["r1"],
      }),
    );
    expect(narrowed).toContain('"enum":["E1","E2"]');
    expect(narrowed).toContain('"enum":["r1"]');
  });
});
