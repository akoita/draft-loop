import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createCapabilityPort, type NativeBridge } from "./bridge.js";
import { createFixtureReviewState, type DesktopReviewState } from "./model.js";
import { ReviewWorkspace } from "./review.js";
import {
  applicationPlanCutKeys,
  applicationPlanThemeKeys,
  normalizeRunApplicationPlan,
  type RecordedApplicationPlan,
  type RunApplicationPlanView,
  runApplicationPlanDisplay,
  runApplicationPlanKeys,
  runApplicationPlanView,
} from "./run-application-plan.js";

const plan: RunApplicationPlanView = {
  themes: [
    {
      title: "Tokenisation",
      rationale: "The job centres on it.",
      requirements: ["Build tokenisation services"],
      proofCount: 2,
      gap: false,
    },
    {
      title: "Kubernetes",
      rationale: "No approved evidence supports it.",
      requirements: [],
      proofCount: 0,
      gap: true,
    },
  ],
  summaryAngle: "Lead with tokenisation delivery.",
  coreAreas: ["Tokenisation", "Payments"],
  cuts: [{ action: "compress", target: "Certification list", reason: "The job ignores it." }],
  review: "revised",
  reviewPoints: ["Lead with tokenisation."],
};

function render(applicationPlan?: RunApplicationPlanView | null): string {
  const state: DesktopReviewState = {
    ...createFixtureReviewState(),
    ...(applicationPlan === undefined ? {} : { applicationPlan }),
  };
  return renderToStaticMarkup(<ReviewWorkspace state={state} onAction={() => undefined} />);
}

function loadReview(value: unknown) {
  const bridge: NativeBridge = {
    capabilities: ["review.load"],
    invoke: async () => ({ ok: true, value }) as never,
  };
  return createCapabilityPort(bridge).execute({
    type: "review.load",
    input: { workspaceId: createFixtureReviewState().workspaceId },
  });
}

describe("Application plan in Run details", () => {
  it("shows themes, what leads, what is cut and the gaps", () => {
    const html = render(plan);
    expect(html).toContain("Application plan");
    expect(html).toContain("Tokenisation");
    expect(html).toContain("2 supporting accomplishments");
    expect(html).toContain("Lead with tokenisation delivery.");
    expect(html).toContain("Compress: Certification list — The job ignores it.");
    expect(html).toContain("Gaps: central themes your evidence does not support");
    expect(html).toContain("Kubernetes");
    expect(html).toContain("The critic asked for changes and the author revised the plan once.");
    expect(html).toContain("Lead with tokenisation.");
  });

  it("leaves a run that made no plan exactly as before", () => {
    const before = render();
    expect(render(null)).toBe(before);
    expect(before).not.toContain("Application plan");
  });

  it("keeps supported themes and gaps apart", () => {
    const display = runApplicationPlanDisplay(plan);
    expect(display?.themes.map(({ title }) => title)).toEqual(["Tokenisation"]);
    expect(display?.gaps.map(({ title }) => title)).toEqual(["Kubernetes"]);
  });
});

describe("review state application plan over the bridge", () => {
  it("accepts a real plan payload unchanged, and null or absent", async () => {
    const fixture = createFixtureReviewState();
    const state = { ...fixture, applicationPlan: plan };
    await expect(loadReview(state)).resolves.toEqual({ ok: true, value: state });
    await expect(loadReview({ ...fixture, applicationPlan: null })).resolves.toMatchObject({
      ok: true,
    });
    await expect(loadReview(fixture)).resolves.toEqual({ ok: true, value: fixture });
  });

  it("rejects unexpected keys, bad review states and oversized lists", async () => {
    const fixture = createFixtureReviewState();
    const theme = plan.themes[0];
    const malformed: readonly unknown[] = [
      { ...plan, evidenceChunkIds: ["a".repeat(64)] },
      { ...plan, review: "maybe" },
      { ...plan, themes: [{ ...theme, evidenceChunkIds: ["a"] }] },
      { ...plan, themes: [{ ...theme, proofCount: -1 }] },
      { ...plan, cuts: [{ ...plan.cuts[0], action: "delete" }] },
      { ...plan, themes: Array.from({ length: 6 }, () => theme) },
      "plan",
    ];
    for (const candidate of malformed) {
      await expect(loadReview({ ...fixture, applicationPlan: candidate })).resolves.toMatchObject({
        ok: false,
      });
    }
  });

  it("names exactly the interface's keys", () => {
    expect([...runApplicationPlanKeys].sort()).toEqual([
      "coreAreas",
      "cuts",
      "review",
      "reviewPoints",
      "summaryAngle",
      "themes",
    ]);
    expect([...applicationPlanThemeKeys].sort()).toEqual([
      "gap",
      "proofCount",
      "rationale",
      "requirements",
      "title",
    ]);
    expect([...applicationPlanCutKeys].sort()).toEqual(["action", "reason", "target"]);
  });
});

describe("run application plan view", () => {
  const recorded: RecordedApplicationPlan = {
    plan: {
      themes: [
        {
          title: "Tokenisation",
          rationale: "The job centres on it.",
          requirementIds: ["req-1", "req-unknown"],
          evidenceChunkIds: ["chunk-a", "chunk-b"],
          gap: false,
        },
      ],
      leads: { summaryAngle: "Lead with it.", coreAreas: [{ text: "Tokenisation" }] },
      cuts: [],
    },
    review: { verdict: "accept", points: [] },
    revised: false,
  };

  it("resolves requirement ids to text and never carries evidence ids", () => {
    const view = runApplicationPlanView(recorded, new Map([["req-1", "Build tokenisation"]]));
    expect(view?.themes[0]).toEqual({
      title: "Tokenisation",
      rationale: "The job centres on it.",
      requirements: ["Build tokenisation", "req-unknown"],
      proofCount: 2,
      gap: false,
    });
    expect(view?.review).toBe("accepted");
    expect(JSON.stringify(view)).not.toContain("chunk-a");
    expect(normalizeRunApplicationPlan(view)).toEqual(view);
  });

  it("reports a plan without a review as pending", () => {
    expect(runApplicationPlanView({ ...recorded, review: null }, new Map())?.review).toBe(
      "pending",
    );
  });
});
