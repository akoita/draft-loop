import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import { createHttpBridge } from "./http-bridge.js";
import { syntheticRun } from "./test-fixtures.js";

const workspaceId = "owner";
const runId = "run-1";
const projected = { workspaceId, runId, state: "awaiting-approval" };
// The owner token's workspace reads as "Your workspace" in the screens' headings.
const shown = { ...projected, workspaceName: "Your workspace" };

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
  const downloads: { bytes: Blob; fileName: string }[] = [];
  const bridge = createHttpBridge({
    client,
    idempotencyKey: () => "review-key-01",
    download: (bytes, fileName) => downloads.push({ bytes, fileName }),
  });
  const dispatch = (action: Record<string, unknown>) =>
    bridge.invoke({
      type: "review.dispatch",
      input: { workspaceId, runId, applicationId: "app-ledger", action },
    } as never);
  return { dispatch, calls, downloads };
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

    expect(result).toEqual({ ok: true, value: shown });
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

    expect(blocked).toEqual({ ok: true, value: shown });
    expect(unresolved).toMatchObject({
      ok: false,
      error: { message: "Resolve, reject, or override blocking findings before approval." },
    });
    expect(approved).toEqual({ ok: true, value: shown });
    expect(calls.at(-2)?.input).toEqual({
      path: { workspaceId, runId },
      body: { readinessOverrideRationale: "The employer asked for two pages." },
    });
  });

  it("shows edits that still fail the final checks as an error, since nothing was saved", async () => {
    const message =
      "Your edited draft still fails the final CV checks (missing-cv-header). Change the edits, or approve with an override reason.";
    const { dispatch } = portOver({
      ...reviewState,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/approve": () => {
        throw new ApiRequestError(409, "edits_readiness_blocked", message);
      },
    });

    await expect(dispatch({ type: "approve" })).resolves.toMatchObject({
      ok: false,
      error: { message },
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
      expect(await dispatch({ type })).toEqual({ ok: true, value: shown });
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

    expect(result).toEqual({ ok: true, value: shown });
    expect(calls).toEqual([reload]);
  });

  it("exports each format, Modern unless another template is chosen, and downloads it under the service's name", async () => {
    const document = new Blob(["synthetic document"]);
    const { dispatch, calls, downloads } = portOver({
      ...reviewState,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/exports": ({ body }) => ({
        id: `export-${(body as { format: string }).format}`,
        runId,
        format: (body as { format: string }).format,
        mimeType: "application/octet-stream",
        createdAt: "2026-10-25T06:00:00.000Z",
        checksum: "c".repeat(64),
        sizeBytes: 18,
        fileName: `Example-Ledger-CV-2026-10-25.${(body as { format: string }).format === "markdown" ? "md" : (body as { format: string }).format}`,
      }),
      "GET /v1/workspaces/{workspaceId}/runs/{runId}/exports/{exportId}/content": () => document,
    });

    for (const action of [
      { type: "export" },
      { type: "export", format: "docx" },
      { type: "export", format: "pdf", template: "compact" },
    ]) {
      expect(await dispatch(action)).toEqual({ ok: true, value: shown });
    }

    const exports = calls.filter(({ operation }) => operation.endsWith("/exports"));
    expect(exports.map(({ input }) => input.body)).toEqual([
      { format: "markdown" },
      { format: "docx", templateId: "modern" },
      { format: "pdf", templateId: "compact" },
    ]);
    expect(exports.every(({ input }) => input.header !== undefined)).toBe(true);
    expect(downloads.map(({ fileName }) => fileName)).toEqual([
      "Example-Ledger-CV-2026-10-25.md",
      "Example-Ledger-CV-2026-10-25.docx",
      "Example-Ledger-CV-2026-10-25.pdf",
    ]);
    expect(downloads.every(({ bytes }) => bytes === document)).toBe(true);
    expect(calls.at(-1)).toEqual(reload);
  });

  it("downloads nothing when the export is refused", async () => {
    const { dispatch, downloads } = portOver({
      ...reviewState,
      "POST /v1/workspaces/{workspaceId}/runs/{runId}/exports": () => {
        throw new ApiRequestError(
          409,
          "run_state_conflict",
          "Only an approved run can be exported.",
        );
      },
    });

    const refused = await dispatch({ type: "export", format: "docx" });

    expect(refused).toMatchObject({
      ok: false,
      error: { message: "Only an approved run can be exported." },
    });
    expect(downloads).toEqual([]);
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
