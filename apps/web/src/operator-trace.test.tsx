import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type ApiClient, ApiRequestError } from "./api-client.js";
import {
  type OperatorRunTrace,
  RunTraceResult,
  RunTraceSection,
  readRunTrace,
  spanRows,
} from "./operator-trace.js";

const route = "GET /v1/operator/organisations/{organisationId}/runs/{runId}/trace";

const trace = {
  organisation_id: "org-alder",
  run_id: "run-1",
  workspace_id: "ws-1",
  request_id: "4bf92f3577b34da6a3ce929d0e0e4736",
  spans: [
    {
      span_id: "s2",
      parent_span_id: "s1",
      name: "invoke_agent",
      started_at: "2026-11-19T08:00:01.000Z",
      ended_at: "2026-11-19T08:00:05.500Z",
      status: "error",
      attributes: {
        "draftloop.step": "author",
        "draftloop.attempt": 2,
        "gen_ai.provider.name": "anthropic",
        "gen_ai.request.model": "claude-haiku-5-5",
        "gen_ai.usage.input_tokens": 1200,
        "gen_ai.usage.output_tokens": 80,
        "draftloop.estimated_usd": 0.0125,
        "error.type": "provider_overloaded",
      },
    },
    {
      span_id: "s1",
      parent_span_id: null,
      name: "invoke_workflow",
      started_at: "2026-11-19T08:00:00.000Z",
      ended_at: null,
      status: null,
      attributes: {},
    },
  ],
} as unknown as OperatorRunTrace;

function fakeClient(answer: unknown, calls: unknown[] = []): ApiClient {
  return {
    call: (async (path: string, init: unknown) => {
      calls.push([path, init]);
      if (answer instanceof Error) throw answer;
      return answer;
    }) as ApiClient["call"],
  };
}

describe("the operator's run trace (#3111)", () => {
  it("reads the trace by organisation and run id", async () => {
    const calls: unknown[] = [];
    expect(await readRunTrace(fakeClient(trace, calls), "org-alder", "run-1")).toEqual({
      kind: "ready",
      trace,
    });
    expect(calls).toEqual([[route, { path: { organisationId: "org-alder", runId: "run-1" } }]]);
  });

  it("says plainly when there is no trace, or when reading fails", async () => {
    const missing = new ApiRequestError(404, "trace_not_found", "No trace.");
    expect(await readRunTrace(fakeClient(missing), "org-alder", "run-x")).toEqual({
      kind: "failed",
      message: "No trace for that run in that organisation.",
    });
    const broken = new ApiRequestError(500, "internal_error", "Boom.");
    expect((await readRunTrace(fakeClient(broken), "org-alder", "run-1")).kind).toBe("failed");
  });

  it("nests each step under the step it ran in", () => {
    expect(spanRows(trace.spans).map(({ span, depth }) => [span.span_id, depth])).toEqual([
      ["s1", 0],
      ["s2", 1],
    ]);
  });

  it("shows the request id, the failed step, its model, error, tokens, cost and duration", () => {
    const html = renderToStaticMarkup(<RunTraceResult trace={trace} />);
    expect(html).toContain("Request id 4bf92f3577b34da6a3ce929d0e0e4736.");
    expect(html).toContain("invoke_agent · author #2");
    expect(html).toContain("failed");
    expect(html).toContain("4.5 s");
    expect(html).toContain("anthropic · claude-haiku-5-5 · 1200 in / 80 out · US$0.0125");
    expect(html).toContain("provider_overloaded");
    expect(html).toContain("did not finish");
  });

  it("asks for an organisation id and a run id", () => {
    const html = renderToStaticMarkup(<RunTraceSection client={fakeClient(trace)} />);
    expect(html).toContain("Organisation id");
    expect(html).toContain("Run id");
    expect(html).toContain("Read trace");
  });
});
