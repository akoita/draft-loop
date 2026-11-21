import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  maximumRemoteBodyBytes,
  protectedResourcePath,
  remoteMcpPath,
  remoteOptionsFromEnvironment,
  serveRemoteMcp,
} from "./remote.js";

interface ApiCall {
  readonly url: string;
  readonly authorization: string | null;
}

let server: Server | undefined;

afterEach(async () => {
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
  server = undefined;
});

/** A remote server over a scripted API that lists no applications. */
async function remote(calls: ApiCall[] = []): Promise<string> {
  server = await serveRemoteMcp({
    baseUrl: "http://api.example.test",
    workspaceId: "ws-1",
    port: 0,
    host: "127.0.0.1",
    fetch: async (input, init) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({ applications: [] });
    },
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function connect(origin: string, token: string): Promise<Client> {
  const client = new Client({ name: "remote-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${origin}${remoteMcpPath}`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

describe("the remote MCP server", () => {
  it("serves every tool with a title and explicit hints", async () => {
    const client = await connect(await remote(), "credential-a");

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["record_work", "list_applications", "get_cv", "start_cv_run"]),
    );
    for (const tool of tools) {
      expect(tool.title ?? "", tool.name).not.toBe("");
      expect(typeof tool.annotations?.readOnlyHint, tool.name).toBe("boolean");
      expect(typeof tool.annotations?.openWorldHint, tool.name).toBe("boolean");
      if (tool.annotations?.readOnlyHint === false) {
        expect(typeof tool.annotations.destructiveHint, tool.name).toBe("boolean");
      }
    }
    await client.close();
  });

  it("forwards each caller's own credential to the API, in the configured workspace", async () => {
    const calls: ApiCall[] = [];
    const origin = await remote(calls);
    const first = await connect(origin, "credential-a");
    const second = await connect(origin, "credential-b");

    await first.callTool({ name: "list_applications", arguments: {} });
    await second.callTool({ name: "list_applications", arguments: {} });

    expect(calls.map((call) => call.authorization)).toEqual([
      "Bearer credential-a",
      "Bearer credential-b",
    ]);
    expect(calls[0]?.url).toContain("http://api.example.test/v1/workspaces/ws-1/applications");
    await first.close();
    await second.close();
  });

  it("answers 401 with a Bearer challenge when no credential is sent, before any API call", async () => {
    const calls: ApiCall[] = [];
    const origin = await remote(calls);

    const response = await fetch(`${origin}${remoteMcpPath}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: initialize,
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(calls).toEqual([]);
  });

  it("refuses other methods, other paths, oversized and malformed bodies", async () => {
    const origin = await remote();
    const headers = { authorization: "Bearer credential-a", "content-type": "application/json" };

    expect((await fetch(`${origin}${remoteMcpPath}`, { headers })).status).toBe(405);
    expect((await fetch(`${origin}/v1/workspaces`, { headers })).status).toBe(404);
    expect(
      (await fetch(`${origin}${remoteMcpPath}`, { method: "POST", headers, body: "{" })).status,
    ).toBe(400);
    expect(
      (
        await fetch(`${origin}${remoteMcpPath}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ padding: "x".repeat(maximumRemoteBodyBytes) }),
        })
      ).status,
    ).toBe(413);
    expect((await fetch(`${origin}/healthz`)).status).toBe(200);
  });
});

describe("with OAuth sign-in", () => {
  const oauth = {
    resource: "https://draftloop.example.test/mcp",
    issuer: "https://id.example.test/realms/draft-loop",
  };
  let tokenKeys: JWTVerifyGetKey;
  /** Tokens for this server, named for how the scripted API answers them. */
  const tokens = { member: "", expired: "", unscoped: "", foreign: "" };

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    tokenKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1" }] });
    const sign = (sub: string, aud: readonly string[] = ["draft-loop-api", oauth.resource]) =>
      new SignJWT({ iss: oauth.issuer, aud: [...aud], sub })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setExpirationTime("5m")
        .sign(privateKey);
    tokens.member = await sign("member");
    tokens.expired = await sign("expired");
    tokens.unscoped = await sign("unscoped");
    // Issued for the API alone: valid there, but not for this server.
    tokens.foreign = await sign("member", ["draft-loop-api"]);
  });

  /** A remote server whose API knows one signed-in person, with the workspaces given. */
  async function signedIn(workspaces: readonly string[], calls: ApiCall[] = []): Promise<string> {
    server = await serveRemoteMcp({
      baseUrl: "http://api.example.test",
      workspaceId: "owner",
      oauth,
      tokenKeys,
      port: 0,
      host: "127.0.0.1",
      fetch: async (input, init) => {
        const authorization = new Headers(init?.headers).get("authorization");
        calls.push({ url: String(input), authorization });
        if (authorization === `Bearer ${tokens.expired}`)
          return new Response("{}", { status: 401 });
        if (authorization === `Bearer ${tokens.unscoped}`)
          return new Response("{}", { status: 403 });
        return String(input).endsWith("/v1/workspaces")
          ? Response.json({ workspaces: workspaces.map((id) => ({ id })) })
          : Response.json({ applications: [] });
      },
    });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const post = (origin: string, token?: string) =>
    fetch(`${origin}${remoteMcpPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: initialize,
    });

  it("publishes where to sign in, at both well-known paths", async () => {
    const origin = await signedIn(["ws-1"]);

    for (const path of [protectedResourcePath, `${protectedResourcePath}${remoteMcpPath}`]) {
      const response = await fetch(`${origin}${path}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        resource: oauth.resource,
        authorization_servers: [oauth.issuer],
        scopes_supported: expect.arrayContaining([
          "draftloop:journal",
          "draftloop:drafts:read",
          "draftloop:runs:start",
        ]),
      });
    }
  });

  it("points an unauthenticated caller at the metadata and asks for the default scopes", async () => {
    const response = await post(await signedIn(["ws-1"]));
    const header = response.headers.get("www-authenticate") ?? "";

    expect(response.status).toBe(401);
    expect(header).toContain(
      'resource_metadata="https://draftloop.example.test/.well-known/oauth-protected-resource"',
    );
    expect(header).toContain("draftloop:applications:read");
    expect(header).not.toContain("drafts:read");
    expect(header).not.toContain("runs:start");
  });

  it("answers 401 invalid_token for a dead sign-in and 403 for one without access", async () => {
    const origin = await signedIn(["ws-1"]);

    const expired = await post(origin, tokens.expired);
    const unscoped = await post(origin, tokens.unscoped);

    expect(expired.status).toBe(401);
    expect(expired.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(unscoped.status).toBe(403);
    expect((await post(await signedInAgain([]), tokens.member)).status).toBe(403);
  });

  /** A second server in one test replaces the first. */
  async function signedInAgain(workspaces: readonly string[]): Promise<string> {
    await new Promise((resolve) => server?.close(resolve));
    return signedIn(workspaces);
  }

  it("runs the tools in the signed-in person's own workspace, not the configured one", async () => {
    const calls: ApiCall[] = [];
    const client = await connect(await signedIn(["ws-b", "ws-c"], calls), tokens.member);

    await client.callTool({ name: "list_applications", arguments: {} });

    const toolCall = calls.find((call) => call.url.includes("/applications"));
    expect(toolCall?.url).toContain("/v1/workspaces/ws-b/applications");
    expect(toolCall?.authorization).toBe(`Bearer ${tokens.member}`);
    await client.close();
  });

  it("refuses a token not issued for this server before it reaches the API", async () => {
    const calls: ApiCall[] = [];
    const origin = await signedIn(["ws-1"], calls);

    for (const token of [tokens.foreign, "not-a-jwt"]) {
      const response = await post(origin, token);

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
    }
    expect(calls).toEqual([]);
  });

  it("answers 503 and calls no API when the issuer's keys cannot be had", async () => {
    const calls: ApiCall[] = [];
    server = await serveRemoteMcp({
      baseUrl: "http://api.example.test",
      workspaceId: "owner",
      oauth,
      tokenKeys: async () => {
        throw new TypeError("fetch failed");
      },
      port: 0,
      host: "127.0.0.1",
      fetch: async (input) => {
        calls.push({ url: String(input), authorization: null });
        return Response.json({});
      },
    });

    const response = await post(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      tokens.member,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(calls).toEqual([]);
  });
});

describe("remoteOptionsFromEnvironment", () => {
  it("turns OAuth on only with both https addresses, and the public URL ending in /mcp", () => {
    const both = {
      DRAFT_LOOP_MCP_PUBLIC_URL: "https://draftloop.example.test/mcp",
      DRAFT_LOOP_OIDC_ISSUER: "https://id.example.test/realms/draft-loop",
    };

    expect(remoteOptionsFromEnvironment({}).oauth).toBeUndefined();
    expect(remoteOptionsFromEnvironment(both).oauth).toEqual({
      resource: both.DRAFT_LOOP_MCP_PUBLIC_URL,
      issuer: both.DRAFT_LOOP_OIDC_ISSUER,
    });
    for (const broken of [
      { DRAFT_LOOP_MCP_PUBLIC_URL: both.DRAFT_LOOP_MCP_PUBLIC_URL },
      { ...both, DRAFT_LOOP_MCP_PUBLIC_URL: "http://draftloop.example.test/mcp" },
      { ...both, DRAFT_LOOP_MCP_PUBLIC_URL: "https://draftloop.example.test/" },
    ]) {
      expect(() => remoteOptionsFromEnvironment(broken)).toThrow();
    }
  });

  it("binds this computer only by default and reads the port", () => {
    expect(remoteOptionsFromEnvironment({})).toMatchObject({ host: "127.0.0.1", port: 8090 });
    expect(remoteOptionsFromEnvironment({ DRAFT_LOOP_MCP_PORT: "9000" }).port).toBe(9000);
    expect(() => remoteOptionsFromEnvironment({ DRAFT_LOOP_MCP_PORT: "many" })).toThrow();
  });
});
