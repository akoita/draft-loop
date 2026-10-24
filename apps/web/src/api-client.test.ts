import { describe, expect, it } from "vitest";

import { ApiRequestError, createApiClient, operationUrl } from "./api-client.js";

const token = "synthetic-owner-token-0123456789abcdef";

interface Recorded {
  readonly url: string;
  readonly init: RequestInit;
}

function stubFetch(response: Response): { fetch: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return response;
    },
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("operation URL", () => {
  it("fills and encodes path parameters and adds the query", () => {
    expect(
      operationUrl("/v1/workspaces/{workspaceId}/opportunities/{briefId}", {
        path: { workspaceId: "owner", briefId: "brief 1" },
        query: { version: 2, missing: undefined },
      }),
    ).toBe("/v1/workspaces/owner/opportunities/brief%201?version=2");
  });

  it("refuses a missing path parameter", () => {
    expect(() => operationUrl("/v1/workspaces/{workspaceId}", {})).toThrow(
      "The workspaceId path parameter is missing.",
    );
  });
});

describe("API client", () => {
  it("sends the bearer token and a JSON body, and reads a JSON answer", async () => {
    const stub = stubFetch(json(201, { runId: "run-1" }));
    const client = createApiClient({ token, fetch: stub.fetch });

    const run = await client.call("POST /v1/workspaces/{workspaceId}/runs", {
      path: { workspaceId: "owner" },
      header: { "idempotency-key": "synthetic-key-1" },
      body: { opportunityBrief: { briefId: "brief-1", version: 1 } },
    });

    expect(run).toEqual({ runId: "run-1" });
    const [call] = stub.calls;
    expect(call?.url).toBe("/v1/workspaces/owner/runs");
    expect(call?.init.method).toBe("POST");
    expect(call?.init.headers).toEqual({
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "idempotency-key": "synthetic-key-1",
    });
    expect(call?.init.body).toBe('{"opportunityBrief":{"briefId":"brief-1","version":1}}');
  });

  it("sends a file as the raw body with its media type", async () => {
    const stub = stubFetch(json(201, { id: "source-1" }));
    const client = createApiClient({
      token,
      baseUrl: "https://api.example.test",
      fetch: stub.fetch,
    });
    const file = new Blob(["# Synthetic notes"], { type: "text/markdown" });

    await client.call("POST /v1/knowledge-bases/{knowledgeBaseId}/sources", {
      path: { knowledgeBaseId: "kb-1" },
      query: { name: "notes.md" },
      body: file,
      contentType: "text/markdown",
    });

    const [call] = stub.calls;
    expect(call?.url).toBe(
      "https://api.example.test/v1/knowledge-bases/kb-1/sources?name=notes.md",
    );
    expect(call?.init.body).toBe(file);
    expect(call?.init.headers).toMatchObject({ "content-type": "text/markdown" });
  });

  it("sends no body when the operation takes none", async () => {
    const stub = stubFetch(json(200, { runId: "run-1" }));
    const client = createApiClient({ token, fetch: stub.fetch });

    await client.call("POST /v1/workspaces/{workspaceId}/runs/{runId}/pause", {
      path: { workspaceId: "owner", runId: "run-1" },
    });

    expect(stub.calls[0]?.init.body).toBeUndefined();
    expect(stub.calls[0]?.init.headers).toEqual({ authorization: `Bearer ${token}` });
  });

  it("sends no credential to a public route when it has no token", async () => {
    const stub = stubFetch(json(200, { mode: "owner" }));
    const client = createApiClient({ fetch: stub.fetch });

    expect(await client.call("GET /v1/auth/config", {})).toEqual({ mode: "owner" });
    expect(stub.calls[0]?.init.headers).toEqual({});
  });

  it("returns a document's bytes as a blob", async () => {
    const stub = stubFetch(
      new Response("# Draft", { status: 200, headers: { "content-type": "text/markdown" } }),
    );
    const client = createApiClient({ token, fetch: stub.fetch });

    const document = await client.call(
      "GET /v1/workspaces/{workspaceId}/runs/{runId}/exports/{exportId}/content",
      { path: { workspaceId: "owner", runId: "run-1", exportId: "export-1" } },
    );

    expect(await document.text()).toBe("# Draft");
  });

  it("turns a refusal into an error with the API's code and message", async () => {
    const stub = stubFetch(json(409, { error: { code: "stale-version", message: "Reload it." } }));
    const client = createApiClient({ token, fetch: stub.fetch });

    const refused = client.call("GET /v1/workspaces/{workspaceId}", {
      path: { workspaceId: "owner" },
    });

    await expect(refused).rejects.toEqual(new ApiRequestError(409, "stale-version", "Reload it."));
    await expect(refused).rejects.toMatchObject({ status: 409, code: "stale-version" });
  });

  it("keeps the numbers and names a plan refusal carries", async () => {
    const stub = stubFetch(
      json(402, {
        error: { code: "credits_insufficient", message: "Not enough.", estimate: 4, remaining: 1 },
      }),
    );
    const client = createApiClient({ token, fetch: stub.fetch });

    await expect(
      client.call("GET /v1/workspaces/{workspaceId}", { path: { workspaceId: "owner" } }),
    ).rejects.toMatchObject({ status: 402, details: { estimate: 4, remaining: 1 } });
  });

  it("keeps the quarantined material a refused run names", async () => {
    const quarantined = [
      {
        kind: "job-source",
        briefId: "brief-1",
        sourceId: "job-posting",
        resultId: "result-1",
        verdict: "flagged",
        signals: ["hidden-text"],
      },
    ];
    const stub = stubFetch(
      json(409, { error: { code: "material_quarantined", message: "Quarantined.", quarantined } }),
    );
    const client = createApiClient({ token, fetch: stub.fetch });

    await expect(
      client.call("POST /v1/workspaces/{workspaceId}/runs", {
        path: { workspaceId: "owner" },
        header: { "idempotency-key": "key-00000001" },
        body: {},
      }),
    ).rejects.toMatchObject({ status: 409, code: "material_quarantined", quarantined });
  });

  it("still reports a refusal whose body is not the error shape", async () => {
    const stub = stubFetch(new Response("<html>", { status: 502 }));
    const client = createApiClient({ token, fetch: stub.fetch });

    await expect(client.call("GET /v1/health", {})).rejects.toMatchObject({
      status: 502,
      code: "unreadable-error",
      message: "The API answered 502.",
    });
  });
});
