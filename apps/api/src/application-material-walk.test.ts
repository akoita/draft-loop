import type { AnthropicRouteBuilder } from "@draft-loop/model-gateway";
import { describe, expect, it } from "vitest";

import { runApplicationMaterialWalk } from "./application-material-walk.js";

/** A scripted Claude route: one valid draft per kind, at a fixed invented cost. */
function scriptedRoute(costUsd: number): AnthropicRouteBuilder {
  return () => ({
    provider: "anthropic",
    route: "anthropic-api",
    execute: async (request) => {
      const kind = (request.input as { kind: string }).kind;
      const output =
        kind === "cover-letter"
          ? {
              items: [
                {
                  question: "",
                  text: "As an Analyst I cut the monthly loan report from ten working days to two.",
                  fact_ids: ["t1", "o1"],
                },
              ],
            }
          : {
              items: [
                {
                  question: "How have you used SQL for finance reporting?",
                  text: "I use SQL for loan reporting.",
                  fact_ids: ["s1"],
                },
              ],
            };
      return {
        output,
        contextSnapshotId: request.contextSnapshotId,
        provider: "anthropic",
        company: "anthropic",
        route: "anthropic-api",
        modelId: "claude-sonnet-5-5",
        providerRequestId: null,
        structuredOutputSha256: "0".repeat(64),
        usage: { inputTokens: 900, outputTokens: 300, totalTokens: 1200 },
        cost: { estimatedUsd: costUsd },
      } as never;
    },
  });
}

describe("the application material walk", () => {
  it("drafts both kinds through the route without sending withheld facts", async () => {
    const result = await runApplicationMaterialWalk(scriptedRoute(0.01), 1);
    expect(result.calls).toHaveLength(2);
    expect(result.leaked).toBe(false);
    expect(result.spentUsd).toBeCloseTo(0.02);
    expect(result.transcript).toContain("## cover-letter (200)");
    expect(result.transcript).toContain("### How have you used SQL for finance reporting?");
    expect(result.transcript).toContain("Cites: t1, o1");
    expect(result.transcript).toContain("Withheld facts sent to the model: none.");
  });

  it("stops before a call once the cap is spent", async () => {
    const result = await runApplicationMaterialWalk(scriptedRoute(2), 1);
    expect(result.calls).toHaveLength(1);
    expect(result.transcript).toContain("## interview-questions (500)");
  });
});
