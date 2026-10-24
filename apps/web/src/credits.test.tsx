import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CreditBalancePanel, RunEstimatePanel } from "./credits.js";
import { RunPanel, type RunPanelProps } from "./run.js";
import { syntheticCredits, syntheticEstimate } from "./test-fixtures.js";

const runProps: RunPanelProps = {
  run: undefined,
  startProblem: undefined,
  messages: [],
  busy: false,
  onStart: () => {},
  onControl: () => {},
  onReview: () => {},
};

describe("credit balance line", () => {
  it("shows what is left, the allowance and the period end", () => {
    const html = renderToStaticMarkup(
      <CreditBalancePanel state={{ kind: "ready", credits: syntheticCredits }} locale="en-GB" />,
    );
    expect(html).toContain("38 of 50 credits left. The period ends on 24 Nov 2026.");
    expect(html).not.toContain("notice");
  });

  it("adds the warning at 80% used", () => {
    const html = renderToStaticMarkup(
      <CreditBalancePanel
        state={{
          kind: "ready",
          credits: { ...syntheticCredits, used: 40, remaining: 10, warning: true },
        }}
      />,
    );
    expect(html).toContain("10 of 50 credits left.");
    expect(html).toContain('class="notice"');
    expect(html).toContain("Most of this period&#x27;s credits are used");
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
    expect(html).toContain("Your plan has unlimited credits.");
    expect(html).not.toContain(" of ");
  });

  it("shows nothing while loading or in owner-token mode", () => {
    expect(renderToStaticMarkup(<CreditBalancePanel state={{ kind: "loading" }} />)).toBe("");
    expect(renderToStaticMarkup(<CreditBalancePanel state={{ kind: "hidden" }} />)).toBe("");
  });

  it("asks for a plan, or says the balance could not be read", () => {
    expect(renderToStaticMarkup(<CreditBalancePanel state={{ kind: "no-plan" }} />)).toContain(
      "no plan yet",
    );
    expect(renderToStaticMarkup(<CreditBalancePanel state={{ kind: "failed" }} />)).toContain(
      "could not be read",
    );
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

describe("run step with credits", () => {
  it("shows the balance above the run and the estimate before the start button", () => {
    const html = renderToStaticMarkup(
      <RunPanel {...runProps} credits={<p>Balance line</p>} estimate={<p>Estimate line</p>} />,
    );
    expect(html.indexOf("Balance line")).toBeGreaterThan(html.indexOf("<h2>Run</h2>"));
    expect(html.indexOf("Estimate line")).toBeGreaterThan(-1);
    expect(html.indexOf("Estimate line")).toBeLessThan(html.indexOf("Start a run"));
  });

  it("shows a plan refusal in place of generic error text", () => {
    const html = renderToStaticMarkup(
      <RunPanel
        {...runProps}
        messages={["This run needs 4 credits and you have 1 credit left."]}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("This run needs 4 credits");
  });
});
