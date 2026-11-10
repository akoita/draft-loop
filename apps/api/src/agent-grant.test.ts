import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";

import { admitAgentGrant, agentGrantId, agentGrantOf } from "./agent-grant.js";

const workspace = "/v1/workspaces/:workspaceId";

function request(method: string, url: string, extra: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    method,
    routeOptions: { url },
    params: { workspaceId: "ws-1" },
    query: {},
    ...extra,
  } as unknown as FastifyRequest;
}

describe("agentGrantOf", () => {
  it("is none for the web screen's own client and for a token that names no client", () => {
    expect(agentGrantOf({ clientId: "web", grantedScopes: ["draftloop:journal"] }, "web")).toBe(
      undefined,
    );
    expect(agentGrantOf({ grantedScopes: [] }, "web")).toBe(undefined);
  });

  it("reads only known scopes under the prefix, and none is still a grant", () => {
    expect(
      agentGrantOf(
        {
          clientId: "assistant",
          grantedScopes: ["openid", "journal", "draftloop:drafts:read", "draftloop:everything"],
        },
        "web",
      ),
    ).toEqual({ clientId: "assistant", scopes: ["drafts:read"] });
    expect(agentGrantOf({ clientId: "other", grantedScopes: ["openid"] }, "web")).toEqual({
      clientId: "other",
      scopes: [],
    });
  });

  it("names a grant like an agent token id, the same for one client", () => {
    const id = agentGrantId({ clientId: "assistant", scopes: [] });

    expect(id).toMatch(/^dlat_[A-Za-z0-9_-]{8,64}$/u);
    expect(agentGrantId({ clientId: "assistant", scopes: ["journal"] })).toBe(id);
    expect(agentGrantId({ clientId: "another", scopes: [] })).not.toBe(id);
  });
});

describe("admitAgentGrant", () => {
  const grant = { clientId: "assistant", scopes: ["applications:read", "runs:start"] } as const;

  it("admits an agent route the grant's scopes cover, in the workspace asked for", () => {
    expect(admitAgentGrant(request("GET", `${workspace}/applications`), grant)).toEqual({
      outcome: "allowed",
      scope: "applications:read",
      workspaceId: "ws-1",
    });
  });

  it("refuses a human-only route, an unknown route and a route outside a workspace", () => {
    for (const [method, url] of [
      ["POST", `${workspace}/runs/:runId/approve`],
      ["GET", "/v1/not-a-route"],
      ["GET", "/v1/workspaces"],
    ] as const) {
      expect(admitAgentGrant(request(method, url, { params: {} }), grant).outcome).toBe("refused");
      expect(admitAgentGrant(request(method, url), grant).outcome).toBe("refused");
    }
  });

  it("refuses a scope the person did not grant, and names it", () => {
    expect(admitAgentGrant(request("GET", `${workspace}/runs/:runId/exports`), grant)).toEqual({
      outcome: "refused",
      message: expect.stringContaining('"drafts:read"'),
    });
  });

  it("refuses a route that spends, even with runs:start", () => {
    expect(admitAgentGrant(request("POST", `${workspace}/runs`), grant).outcome).toBe("refused");
    expect(
      admitAgentGrant(request("POST", `${workspace}/applications/:applicationId/material`), grant)
        .outcome,
    ).toBe("refused");
  });

  it("applies a route's own rule, such as note titles only", () => {
    const journal = { clientId: "assistant", scopes: ["journal"] } as const;
    const notes = `${workspace}/work-journal/notes`;

    expect(admitAgentGrant(request("GET", notes), journal).outcome).toBe("allowed");
    expect(admitAgentGrant(request("GET", notes, { query: { fields: "all" } }), journal)).toEqual({
      outcome: "refused",
      message: "An agent token lists work journal notes by title only.",
    });
  });
});
