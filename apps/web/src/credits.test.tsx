import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreditBalancePanel, RunEstimatePanel } from "./credits.js";
import { syntheticCredits, syntheticEstimate } from "./test-fixtures.js";

describe("credit balance chip", () => {
  it("shows what is left, with the period end as its tooltip", () => {
    const html = renderToStaticMarkup(
      <CreditBalancePanel state={{ kind: "ready", credits: syntheticCredits }} locale="en-GB" />,
    );
    expect(html).toContain("38 of 50 credits left</span>");
    expect(html).toContain("The period ends on 24 Nov 2026.");
    expect(html).not.toContain("credit-chip-warning");
  });

  it("turns amber at 80% used", () => {
    const html = renderToStaticMarkup(
      <CreditBalancePanel
        state={{
          kind: "ready",
          credits: { ...syntheticCredits, used: 40, remaining: 10, warning: true },
        }}
      />,
    );
    expect(html).toContain("10 of 50 credits left");
    expect(html).toContain("credit-chip-warning");
  });

  it("says plainly that the plan is unlimited", () => {
    const html = renderToStaticMarkup(
      <CreditBalancePanel
        state={{
          kind: "ready",
          credits: { ...syntheticCredits, unlimited: true, allowance: null, remaining: null },
        }}
      />,
    );
    expect(html).toContain("Unlimited credits");
    expect(html).not.toContain(" of ");
  });

  it("shows nothing while loading, in owner-token mode, without a plan or on a failure", () => {
    for (const kind of ["loading", "hidden", "no-plan", "failed"] as const)
      expect(renderToStaticMarkup(<CreditBalancePanel state={{ kind }} />)).toBe("");
  });
});

describe("run estimate", () => {
  it("shows the credits and no note when the plan and balance allow the run", () => {
    const html = renderToStaticMarkup(
      <RunEstimatePanel state={{ kind: "ready", estimate: syntheticEstimate }} />,
    );
    expect(html).toContain("This run uses 2 credits.");
    expect(html).not.toContain("notice");
  });

  it("notes a tier the plan does not allow", () => {
    const html = renderToStaticMarkup(
      <RunEstimatePanel
        state={{
          kind: "ready",
          estimate: {
            ...syntheticEstimate,
            plan: {
              allowed: false,
              code: "model_tier_not_in_plan",
              role: "critic",
              tier: "premium",
            },
          },
        }}
      />,
    );
    expect(html).toContain("This run uses 2 credits.");
    expect(html).toContain("Your plan does not include premium models for the critic.");
  });

  it("notes a balance that is not enough", () => {
    const html = renderToStaticMarkup(
      <RunEstimatePanel
        state={{
          kind: "ready",
          estimate: {
            ...syntheticEstimate,
            balance: { unlimited: false, remaining: 1, sufficient: false },
          },
        }}
      />,
    );
    expect(html).toContain("not enough credits left for this run. You have 1 credit.");
  });

  it("shows nothing while loading, and a refusal's message when it fails", () => {
    expect(renderToStaticMarkup(<RunEstimatePanel state={{ kind: "loading" }} />)).toBe("");
    expect(
      renderToStaticMarkup(<RunEstimatePanel state={{ kind: "failed", message: "Not priced." }} />),
    ).toContain("Not priced.");
  });
});
