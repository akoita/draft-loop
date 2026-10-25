import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import { createHttpBridge } from "./http-bridge.js";
import { syntheticRun } from "./test-fixtures.js";

const workspaceId = "owner";
const runId = "run-1";
const projected = { workspaceId, runId, state: "awaiting-approval" };

type Handler = (input: Record<string, unknown>) => unknown;

function portOver(handlers: Readonly<Record<string, Handler>>) {
  const calls: { operation: string; input: Record<string, unknown> }[] = [];
  const client: ApiClient = {
    call: async (operation, input) => {
      calls.push({ operation, input: input as Record<string, unknown> });
      const handler = handlers[operation];
      if (handler === undefined) throw new Error(`unexpected call: ${operation}`);
      return (await handler(input as Record<string, unknown>)) as never;
    },
  };
  // The bridge itself: the port would also check the projected state, which these stubs leave out.
  const bridge = createHttpBridge({ client, idempotencyKey: () => "review-key-01" });
  const dispatch = (action: Record<string, unknown>) =>
    bridge.invoke({
      type: "review.dispatch",
      input: { workspaceId, runId, applicationId: "app-ledger", action },
    } as never);
  return { dispatch, calls };
}

const reviewState = { "GET /v1/workspaces/{workspaceId}/review-state": () => projected };
const reload = {
  operation: "GET /v1/workspaces/{workspaceId}/review-state",
  input: { path: { workspaceId }, query: { applicationId: "app-ledger", runId } },
};

describe("the shared review screen's actions over HTTP", () => {
  it("records a finding decision with its reason, then reads the run again", async () => {
    const { dispatch, calls } = portOver({
      ...reviewState,
      "PUT /v1/workspaces/{workspaceId}/runs/{runId}/findings/{findingId}/decision": () => ({}),
    });

    const result = await dispatch({
      type: "finding-decision",
      findingId: "run-1:finding:0:unsupported-claim",
      decision: "overridden",
      rationale: "The source covers it.",
    });

    expect(result).toEqual({ ok: true, value: projected });
    expect(calls).toEqual([
      {
        operation: "PUT /v1/workspaces/{workspaceId}/runs/{runId}/findings/{findingId}/decision",
        input: {
          path: { workspaceId, runId, findingId: "run-1:finding:0:unsupported-claim" },
          body: { decision: "overridden", rationale: "The source covers it." },
        },
      },
      reload,
    ]);
  });

  it("saves a block edit", async () => {
    const { dispatch, calls } = portOver({
      ...reviewState,
      "PUT /v1/workspaces/{workspaceId}/runs/{runId}/edits/{blockId}": () => ({}),
    });

    await dispatch({ type: "edit-block", blockId: "block-1", text: "Built tested services." });

    expect(calls[0]?.input).toEqual({
      path: { workspaceId, runId, blockId: "block-1" },
      body: { text: "Built tested services." },
    });
  });

  it("approves, and shows failing final checks rather than an error", async () => {
    let approvals = 0;
    const { dispatch, calls } = portOver({
      ...reviewState,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/approve": () => {
        approvals += 1;
        if (approvals === 1) {
          throw new ApiRequestError(409, "readiness_blocked", "The final CV checks fail.");
        }
        if (approvals === 2) {
          throw new ApiRequestError(
            409,
            "findings_unresolved",
            "Resolve, reject, or override blocking findings before approval.",
          );
        }
        return syntheticRun;
      },
    });

    const blocked = await dispatch({ type: "approve" });
    const unresolved = await dispatch({ type: "approve" });
    const approved = await dispatch({
      type: "approve",
      readinessOverrideRationale: "The employer asked for two pages.",
    });

    expect(blocked).toEqual({ ok: true, value: projected });
    expect(unresolved).toMatchObject({
      ok: false,
      error: { message: "Resolve, reject, or override blocking findings before approval." },
    });
    expect(approved).toEqual({ ok: true, value: projected });
    expect(calls.at(-2)?.input).toEqual({
      path: { workspaceId, runId },
      body: { readinessOverrideRationale: "The employer asked for two pages." },
    });
  });

  it("asks for another round with the person's direction, once per key", async () => {
    const { dispatch, calls } = portOver({
      ...reviewState,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/revision": () => syntheticRun,
    });

    await dispatch({ type: "request-revision", candidateDirection: "Lead with platform work." });

    expect(calls[0]?.input).toEqual({
      path: { workspaceId, runId },
      header: { "idempotency-key": "review-key-01" },
      body: { candidateDirection: "Lead with platform work." },
    });
  });

  it("pauses, resumes and stops the run", async () => {
    const { dispatch, calls } = portOver({
      ...reviewState,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/pause": () => syntheticRun,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/resume": () => syntheticRun,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/stop": () => syntheticRun,
    });

    for (const type of ["pause", "resume", "stop"]) {
      expect(await dispatch({ type })).toEqual({ ok: true, value: projected });
    }

    expect(calls.filter(({ operation }) => operation.startsWith("POST"))).toEqual([
      {
        operation: "POST /v1/workspaces/{workspaceId}/runs/{runId}/pause",
        input: { path: { workspaceId, runId } },
      },
      {
        operation: "POST /v1/workspaces/{workspaceId}/runs/{runId}/resume",
        input: { path: { workspaceId, runId }, header: { "idempotency-key": "review-key-01" } },
      },
      {
        operation: "POST /v1/workspaces/{workspaceId}/runs/{runId}/stop",
        input: { path: { workspaceId, runId } },
      },
    ]);
  });

  it("records nothing for a transmission acknowledgement, which the server's consent covers", async () => {
    const { dispatch, calls } = portOver(reviewState);

    const result = await dispatch({
      type: "acknowledge-provider-transmission",
      fingerprint: "a".repeat(64),
    });

    expect(result).toEqual({ ok: true, value: projected });
    expect(calls).toEqual([reload]);
  });

  it("refuses what the hosted service does not do yet, calling nothing", async () => {
    const { dispatch, calls } = portOver(reviewState);

    const refusals = await Promise.all([
      dispatch({ type: "set-autopilot", enabled: true }),
      dispatch({ type: "recover-to-review" }),
      dispatch({ type: "recover-round-limit" }),
    ]);

    for (const refused of refusals) {
      expect(refused).toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
    expect(calls).toEqual([]);
  });
});
