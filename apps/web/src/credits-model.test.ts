import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError, type ApiSchemas } from "./api-client.js";
import {
  balanceLine,
  balanceWarning,
  creditCount,
  describeStartError,
  estimateLine,
  estimateNotes,
  planRefusalMessage,
  readCredits,
  readEstimate,
} from "./credits-model.js";
import { syntheticCredits, syntheticEstimate } from "./test-fixtures.js";

function refusal(
  status: number,
  code: string,
  details: ConstructorParameters<typeof ApiRequestError>[4] = {},
) {
  return new ApiRequestError(status, code, "The API's own words.", undefined, details);
}

function clientAnswering(answer: () => unknown): ApiClient {
  return {
    call: async () => {
      const value = answer();
      if (value instanceof Error) throw value;
      return value as never;
    },
  };
}

describe("credit balance", () => {
  it("reads the remaining credits, the allowance and the period end", () => {
    expect(balanceLine(syntheticCredits, "en-GB")).toBe(
      "38 of 50 credits left. The period ends on 24 Nov 2026.",
    );
    expect(balanceWarning(syntheticCredits)).toBeUndefined();
  });

  it("names granted credits and a single credit", () => {
    const line = balanceLine({
      ...syntheticCredits,
      allowance: 1,
      remaining: 1,
      grantsRemaining: 1,
    });
    expect(line).toContain("1 of 1 credit left.");
    expect(line).toContain("1 credit granted to you");
  });

  it("warns at 80% and again when the credits are used up", () => {
    const warned = { ...syntheticCredits, used: 40, remaining: 10, warning: true };
    expect(balanceWarning(warned)).toContain("Most of this period's credits are used");
    expect(balanceWarning({ ...warned, used: 50, remaining: 0 })).toContain("used up");
  });

  it("says plainly that an unlimited plan has no limit", () => {
    const unlimited = { ...syntheticCredits, unlimited: true, allowance: null, remaining: null };
    expect(balanceLine(unlimited)).toBe("Your plan has unlimited credits.");
    expect(balanceWarning(unlimited)).toBeUndefined();
  });

  it("is hidden when the route answers 404, as in owner-token mode", async () => {
    const state = await readCredits(clientAnswering(() => refusal(404, "not_found")));
    expect(state).toEqual({ kind: "hidden" });
  });

  it("reports a missing plan and other failures apart", async () => {
    expect(await readCredits(clientAnswering(() => refusal(403, "plan_required")))).toEqual({
      kind: "no-plan",
    });
    expect(await readCredits(clientAnswering(() => new Error("offline")))).toEqual({
      kind: "failed",
    });
    expect(await readCredits(clientAnswering(() => syntheticCredits))).toEqual({
      kind: "ready",
      credits: syntheticCredits,
    });
  });
});

describe("run estimate", () => {
  it("states the credits the run uses", () => {
    expect(estimateLine(syntheticEstimate)).toBe("This run uses 2 credits.");
    expect(estimateLine({ ...syntheticEstimate, credits: 1 })).toBe("This run uses 1 credit.");
    expect(estimateNotes(syntheticEstimate)).toEqual([]);
  });

  it("adds no note in owner-token mode, where the estimate has no plan or balance", () => {
    const { plan: _plan, balance: _balance, ...bare } = syntheticEstimate;
    expect(estimateNotes(bare)).toEqual([]);
  });

  it("adds no note for an unlimited plan", () => {
    const unlimited: ApiSchemas["RunEstimate"] = {
      ...syntheticEstimate,
      balance: { unlimited: true, remaining: null, sufficient: true },
    };
    expect(estimateNotes(unlimited)).toEqual([]);
  });

  it("notes a tier the plan does not allow", () => {
    expect(
      estimateNotes({
        ...syntheticEstimate,
        authorTier: "premium",
        plan: { allowed: false, code: "model_tier_not_in_plan", role: "author", tier: "premium" },
      }),
    ).toEqual([
      "Your plan does not include premium models for the author. Choose another preset or model.",
    ]);
  });

  it("notes a missing plan", () => {
    expect(
      estimateNotes({ ...syntheticEstimate, plan: { allowed: false, code: "plan_required" } }),
    ).toEqual(["Your organisation has no plan yet."]);
  });

  it("notes a balance that is not enough, with what is left", () => {
    expect(
      estimateNotes({
        ...syntheticEstimate,
        credits: 4,
        balance: { unlimited: false, remaining: 1, sufficient: false },
      }),
    ).toEqual(["There are not enough credits left for this run. You have 1 credit."]);
  });

  it("reads the estimate for the application, or explains a refusal", async () => {
    const calls: unknown[] = [];
    const client: ApiClient = {
      call: async (operation, input) => {
        calls.push([operation, input]);
        return syntheticEstimate as never;
      },
    };
    expect(await readEstimate(client, "record-a", "app-1")).toEqual({
      kind: "ready",
      estimate: syntheticEstimate,
    });
    expect(calls).toEqual([
      [
        "GET /v1/workspaces/{workspaceId}/runs/estimate",
        { path: { workspaceId: "record-a" }, query: { applicationId: "app-1" } },
      ],
    ]);
    const unknown = await readEstimate(
      clientAnswering(() => refusal(422, "model_tier_unknown")),
      "record-a",
      undefined,
    );
    expect(unknown).toMatchObject({ kind: "failed" });
    expect(unknown.kind === "failed" && unknown.message).toContain("cannot price");
    const offline = await readEstimate(
      clientAnswering(() => new Error("offline")),
      "record-a",
      undefined,
    );
    expect(offline).toEqual({ kind: "failed", message: "The credit estimate could not be read." });
  });
});

describe("plan refusal messages", () => {
  it("explains insufficient credits with the estimate and what is left", () => {
    expect(
      planRefusalMessage(refusal(402, "credits_insufficient", { estimate: 4, remaining: 1 })),
    ).toBe(
      "This run needs 4 credits and you have 1 credit left. Ask the owner for more credits, or wait for the next period.",
    );
    expect(planRefusalMessage(refusal(402, "credits_insufficient"))).toContain(
      "needs more credits",
    );
  });

  it("names the role and tier the plan does not include", () => {
    const message = planRefusalMessage(
      refusal(403, "model_tier_not_in_plan", { role: "critic", tier: "premium" }),
    );
    expect(message).toContain("does not include premium models for the critic");
    expect(message).toContain("Ask the owner about a bigger plan.");
  });

  it("explains a missing plan and an unknown model tier", () => {
    expect(planRefusalMessage(refusal(403, "plan_required"))).toBe(
      "Your organisation has no plan yet. Ask the owner to choose one.",
    );
    expect(planRefusalMessage(refusal(422, "model_tier_unknown"))).toContain("cannot price");
  });

  it("explains each run cap", () => {
    expect(
      planRefusalMessage(refusal(429, "run_cap_reached", { cap: "concurrent", limit: 2 })),
    ).toBe(
      "Your plan allows 2 runs at the same time, and they are running. Wait for one to finish, then try again.",
    );
    expect(planRefusalMessage(refusal(429, "run_cap_reached", { cap: "per_day", limit: 1 }))).toBe(
      "Your plan allows 1 run a day, and today's are used. Try again later.",
    );
    expect(planRefusalMessage(refusal(429, "run_cap_reached", { cap: "per_day" }))).toBe(
      "Your plan's runs for today are used. Try again later.",
    );
  });

  it("explains a full plan for invites and for new records", () => {
    expect(
      planRefusalMessage(refusal(409, "plan_limit_reached", { limit: "seats", value: 3 })),
    ).toBe(
      "Your plan allows 3 seats, and all are taken. Remove a member, or ask the owner for a bigger plan, before inviting someone.",
    );
    expect(
      planRefusalMessage(
        refusal(409, "plan_limit_reached", { limit: "candidateRecords", value: 1 }),
      ),
    ).toBe(
      "Your plan allows 1 candidate record, and all are in use. Delete a record you no longer need, or ask the owner for a bigger plan, before creating another.",
    );
    expect(planRefusalMessage(refusal(409, "plan_limit_reached"))).toContain("limit is reached");
  });

  it("leaves other errors to the generic text, and puts plan refusals first", () => {
    expect(planRefusalMessage(refusal(409, "run_active"))).toBeUndefined();
    expect(planRefusalMessage(new Error("offline"))).toBeUndefined();
    expect(describeStartError(refusal(409, "run_active"))).toBe("The API's own words.");
    expect(describeStartError(refusal(409, "storage_consent_required"))).toContain(
      "cannot be stored yet",
    );
    expect(describeStartError(refusal(402, "credits_insufficient"))).not.toBe(
      "The API's own words.",
    );
  });

  it("counts credits plainly", () => {
    expect(creditCount(0)).toBe("0 credits");
  });
});
