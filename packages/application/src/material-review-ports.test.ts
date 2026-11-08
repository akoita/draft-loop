import { describe, expect, it } from "vitest";

import { type MaterialReviewCall, materialReviewPorts } from "./material-review-ports.js";

/** A scripted OpenAI-compatible local endpoint: each call answers the next reply. */
function scripted(replies: unknown[]) {
  const bodies: Record<string, unknown>[] = [];
  const transport = async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const reply = replies.shift();
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: `call-${bodies.length}`,
        choices: [{ message: { content: JSON.stringify(reply) } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
    };
  };
  return { bodies, transport };
}

describe("material review ports", () => {
  it("routes the critic and the author to their own models and logs each call", async () => {
    const { bodies, transport } = scripted([
      { findings: [{ paragraph: 0, sentence: "One.", reason: "flat" }] },
      { items: [{ question: "", text: "Two.", fact_ids: [] }] },
    ]);
    const calls: MaterialReviewCall[] = [];
    const ports = materialReviewPorts({
      author: { company: "local", model: "author-model" },
      critic: { company: "local", model: "critic-model" },
      applicationId: "app_fixture0001",
      allowProviderData: true,
      local: {
        providerClientFactories: {
          local: () => ({ fetch: transport as unknown as typeof fetch }),
        },
      },
      onCall: (call) => calls.push(call),
    });
    const review = await ports.critic.review({ paragraphs: ["One."], language: "en" });
    expect(review.findings).toEqual([{ paragraph: 0, sentence: "One.", reason: "flat" }]);
    await ports.author.draft({
      context: { kind: "cover-letter", facts: [], requirements: [], language: "en" } as never,
      refusedRules: [],
    });
    expect(bodies.map((body) => body.model)).toEqual(["critic-model", "author-model"]);
    expect(calls.map((call) => call.role)).toEqual(["critic", "author"]);
    expect(ports.spentUsd()).toBeGreaterThanOrEqual(0);
  });

  it("refuses to send the letter when provider data is not allowed", async () => {
    const { bodies, transport } = scripted([]);
    const ports = materialReviewPorts({
      author: { company: "local", model: "author-model" },
      critic: { company: "local", model: "critic-model" },
      applicationId: "app_fixture0001",
      allowProviderData: false,
      local: {
        providerClientFactories: {
          local: () => ({ fetch: transport as unknown as typeof fetch }),
        },
      },
    });
    await expect(ports.critic.review({ paragraphs: ["One."] })).rejects.toThrow();
    expect(bodies).toHaveLength(0);
  });
});
