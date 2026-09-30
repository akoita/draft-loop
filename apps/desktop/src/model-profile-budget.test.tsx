import { estimateModelProfileApiScenario } from "@draft-loop/application/model-profile-budget";
import type {
  ModelProfileReferences,
  RunProviderAuthModeConfiguration,
} from "@draft-loop/application/model-profile-selection";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ModelProfileBudget,
  type ModelProfileScenarioTextPair,
  modelProfileScenarioInputFromText,
} from "./model-profile-budget.js";

const standard: ModelProfileReferences = {
  author: { id: "standard-anthropic-author", version: 1 },
  critic: { id: "standard-openai-critic", version: 2 },
};
const apiKeyModes: RunProviderAuthModeConfiguration = {
  anthropic: "api-key",
  openai: "api-key",
};

function renderBudget(
  references: ModelProfileReferences,
  authModes?: RunProviderAuthModeConfiguration,
): string {
  return renderToStaticMarkup(
    <ModelProfileBudget
      references={references}
      {...(authModes === undefined ? {} : { authModes })}
    />,
  );
}

describe("desktop model profile API budget scenario", () => {
  it("shows editable illustrative calls, catalog rates, scope, formula, and the standard estimate", () => {
    const html = renderBudget(standard, apiKeyModes);
    expect(html).toContain("Illustrative public API token-cost scenario");
    expect(html).toContain("10,000 input and 1,000 output tokens per call");
    expect(html).toContain("2 author calls and 1 critic call");
    expect(html).toContain("standard-anthropic-author@1");
    expect(html).toContain("$4/1M input · $20/1M output");
    expect(html).toContain("standard-openai-critic@2");
    expect(html).toContain("$2/1M input · $10/1M output");
    expect(html).toContain("up to 200,000 input tokens per call");
    expect(html).toContain("Formula: calls ×");
    expect(html).toContain("Combined scenario estimate</dt><dd>$0.150000");
    expect(html).toContain("Actual costs may differ");
    expect(html).toContain("does not change the selected profiles or their runtime budgets");
  });

  it("shows public rates but no combined estimate for subscription or unknown authentication", () => {
    const subscriptionModes = { anthropic: "api-key", openai: "user-session" } as const;
    const subscriptionHtml = renderBudget(standard, subscriptionModes);
    expect(subscriptionHtml).toContain("Public uncached API list rates");
    expect(subscriptionHtml).toContain("do not estimate subscription quota or charges");
    expect(subscriptionHtml).not.toContain("Combined scenario estimate");

    const unknownHtml = renderBudget(standard);
    expect(unknownHtml).toContain("configured authentication route is not known");
    expect(unknownHtml).toContain("Public rates remain reference information only");
    expect(unknownHtml).not.toContain("Combined scenario estimate");
  });

  it("keeps empty text invalid instead of coercing it to a zero-token scenario", () => {
    const values: ModelProfileScenarioTextPair = {
      author: { inputTokens: "", outputTokens: "1000", calls: "2" },
      critic: { inputTokens: "10000", outputTokens: "1000", calls: "1" },
    };
    expect(
      estimateModelProfileApiScenario(
        modelProfileScenarioInputFromText(standard, apiKeyModes, values),
      ),
    ).toEqual({ status: "unavailable", reason: "invalid-scenario" });
  });
});
