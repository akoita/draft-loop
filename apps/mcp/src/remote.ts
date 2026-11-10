import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createApplicationsApi } from "./applications.js";
import {
  createWorkJournalApi,
  createWorkspaceApiCall,
  defaultServerUrl,
  defaultServerWorkspace,
  type WorkJournalApiConfig,
} from "./client.js";
import { createDraftsApi } from "./drafts.js";
import { createMaterialApi } from "./material.js";
import { createRunsApi } from "./runs.js";
import { createWorkJournalMcpServer } from "./server.js";

/**
 * The remote transport (ADR 0011 D17, #2647): the same tools over Streamable HTTP on one URL,
 * for assistants that connect to an MCP server by address. Each request carries the caller's
 * own bearer credential, which this process only forwards to the API: it keeps no token, no
 * session and no candidate data, and the API alone decides what the credential may do.
 */

/** The one path the tools answer on. */
export const remoteMcpPath = "/mcp";
export const defaultRemotePort = 8090;
/** A tool call is small; a larger body is refused before it is read whole. */
export const maximumRemoteBodyBytes = 1_048_576;

/** The agent scopes a connection may ask for, spelled as the API reads them from a token. */
export const remoteScopes = [
  "draftloop:journal",
  "draftloop:applications:read",
  "draftloop:jobs:write",
  "draftloop:drafts:read",
] as const;
/** What a connection asks for unless the client names scopes; reading drafts is opt-in. */
export const remoteDefaultScopes = remoteScopes.filter(
  (scope) => scope !== "draftloop:drafts:read",
);

/** Where the protected resource metadata is served (RFC 9728). */
export const protectedResourcePath = "/.well-known/oauth-protected-resource";

/** OAuth sign-in (#2648): set on the hosted service, unset where callers hold agent tokens. */
export interface RemoteOAuthOptions {
  /** This server's MCP URL exactly as a person enters it in their assistant. */
  readonly resource: string;
  /** The identity provider's issuer, which signs people in and issues the tokens. */
  readonly issuer: string;
}

export interface RemoteMcpOptions {
  /** The DraftLoop API the tools call. */
  readonly baseUrl: string;
  /** The workspace the tools act in; with `oauth`, the signed-in person's own instead. */
  readonly workspaceId: string;
  readonly oauth?: RemoteOAuthOptions;
  readonly fetch?: typeof fetch;
}

/** The address, workspace, port and bind address from the environment. */
export function remoteOptionsFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RemoteMcpOptions & { readonly port: number; readonly host: string } {
  const port = Number(environment.DRAFT_LOOP_MCP_PORT ?? defaultRemotePort);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("DRAFT_LOOP_MCP_PORT must be a port number.");
  }
  const resource = environment.DRAFT_LOOP_MCP_PUBLIC_URL?.trim() || undefined;
  const issuer = environment.DRAFT_LOOP_OIDC_ISSUER?.trim() || undefined;
  if ((resource === undefined) !== (issuer === undefined)) {
    throw new Error("Set DRAFT_LOOP_MCP_PUBLIC_URL and DRAFT_LOOP_OIDC_ISSUER together.");
  }
  for (const url of [resource, issuer]) {
    if (url !== undefined && !/^https:\/\/[^\s?#]+$/u.test(url)) {
      throw new Error("DRAFT_LOOP_MCP_PUBLIC_URL and DRAFT_LOOP_OIDC_ISSUER must be https URLs.");
    }
  }
  if (resource !== undefined && new URL(resource).pathname !== remoteMcpPath) {
    throw new Error(`DRAFT_LOOP_MCP_PUBLIC_URL must end with ${remoteMcpPath}.`);
  }
  return {
    baseUrl: environment.DRAFT_LOOP_SERVER_URL ?? defaultServerUrl,
    workspaceId: environment.DRAFT_LOOP_SERVER_WORKSPACE ?? defaultServerWorkspace,
    ...(resource === undefined || issuer === undefined ? {} : { oauth: { resource, issuer } }),
    port,
    // This computer only unless the operator binds it behind a TLS proxy on purpose.
    host: environment.DRAFT_LOOP_MCP_HOST ?? "127.0.0.1",
  };
}

/** Every tool, calling the API with one configuration. */
export function createDraftLoopMcpServer(config: WorkJournalApiConfig): McpServer {
  const call = createWorkspaceApiCall(config);
  return createWorkJournalMcpServer(
    createWorkJournalApi(config),
    createApplicationsApi(call),
    createDraftsApi(call),
    createRunsApi(call),
    createMaterialApi(call),
  );
}

function bearerToken(request: IncomingMessage): string | undefined {
  return /^Bearer ([^\s]+)$/u.exec(request.headers.authorization ?? "")?.[1];
}

function answer(
  response: ServerResponse,
  status: number,
  message: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  response
    .writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...headers,
    })
    .end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > maximumRemoteBodyBytes) throw new RangeError("too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** The metadata an assistant reads to find where to sign the person in (RFC 9728). */
export function protectedResourceMetadata(oauth: RemoteOAuthOptions) {
  return {
    resource: oauth.resource,
    authorization_servers: [oauth.issuer],
    scopes_supported: [...remoteScopes],
    bearer_methods_supported: ["header"],
    resource_name: "DraftLoop",
  };
}

/** The `401` challenge: where the metadata is, and which scopes to ask for by default. */
function challenge(oauth: RemoteOAuthOptions | undefined, error?: string): string {
  if (oauth === undefined) return "Bearer";
  const metadata = `${new URL(oauth.resource).origin}${protectedResourcePath}`;
  return [
    `Bearer resource_metadata="${metadata}"`,
    `scope="${remoteDefaultScopes.join(" ")}"`,
    ...(error === undefined ? [] : [`error="${error}"`]),
  ].join(", ");
}

type WorkspaceLookup =
  | { readonly outcome: "found"; readonly workspaceId: string }
  | { readonly outcome: "refused"; readonly status: 401 | 403 | 502; readonly message: string };

/**
 * The signed-in person's workspace, asked of the API with their own token. It also proves the
 * token before any tool runs: a dead one answers `401` here, which is how an assistant knows
 * to refresh it. A person who reaches several workspaces gets the first by id.
 */
async function workspaceOf(options: RemoteMcpOptions, token: string): Promise<WorkspaceLookup> {
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(
      `${options.baseUrl.replace(/\/+$/u, "")}/v1/workspaces`,
      { headers: { authorization: `Bearer ${token}` } },
    );
  } catch {
    return { outcome: "refused", status: 502, message: "DraftLoop could not be reached." };
  }
  if (response.status === 401) {
    return { outcome: "refused", status: 401, message: "The sign-in has expired or is not valid." };
  }
  if (response.status === 403) {
    return {
      outcome: "refused",
      status: 403,
      message: "This account has no DraftLoop workspace, or the connection was granted no scope.",
    };
  }
  const body = response.ok
    ? ((await response.json().catch(() => undefined)) as
        | { readonly workspaces?: readonly { readonly id?: unknown }[] }
        | undefined)
    : undefined;
  const id = body?.workspaces?.[0]?.id;
  if (typeof id !== "string") {
    return response.ok
      ? { outcome: "refused", status: 403, message: "This account has no DraftLoop workspace." }
      : { outcome: "refused", status: 502, message: "DraftLoop could not answer." };
  }
  return { outcome: "found", workspaceId: id };
}

/**
 * The HTTP handler: `POST /mcp` with a bearer credential runs one MCP exchange, stateless, with
 * a JSON answer. A request without a credential gets `401`, which is where a client starts
 * sign-in; the credential itself is never logged or kept.
 */
export function createRemoteMcpHandler(
  options: RemoteMcpOptions,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const path = (request.url ?? "").split("?")[0];
    if (path === "/healthz" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" }).end('{"status":"ok"}');
      return;
    }
    const { oauth } = options;
    if (
      oauth !== undefined &&
      request.method === "GET" &&
      (path === protectedResourcePath || path === `${protectedResourcePath}${remoteMcpPath}`)
    ) {
      response
        .writeHead(200, { "content-type": "application/json", "cache-control": "max-age=3600" })
        .end(JSON.stringify(protectedResourceMetadata(oauth)));
      return;
    }
    if (path !== remoteMcpPath) return answer(response, 404, "Not found.");
    if (request.method !== "POST") {
      return answer(response, 405, "Use POST: this server keeps no session.", { allow: "POST" });
    }
    const token = bearerToken(request);
    if (token === undefined) {
      return answer(response, 401, "A DraftLoop credential is required.", {
        "www-authenticate": challenge(oauth),
      });
    }
    let { workspaceId } = options;
    if (oauth !== undefined) {
      const lookup = await workspaceOf(options, token);
      if (lookup.outcome === "refused") {
        return answer(
          response,
          lookup.status,
          lookup.message,
          lookup.status === 401 ? { "www-authenticate": challenge(oauth, "invalid_token") } : {},
        );
      }
      ({ workspaceId } = lookup);
    }
    let body: unknown;
    try {
      body = await readJson(request);
    } catch (error) {
      return error instanceof RangeError
        ? answer(response, 413, "The request is too large.")
        : answer(response, 400, "The request is not JSON.");
    }
    const server = createDraftLoopMcpServer({
      baseUrl: options.baseUrl,
      workspaceId,
      token: async () => token,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    // No session id generator: each request is its own exchange.
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request, response, body);
  };
}

/** Starts the remote server and resolves once it listens. */
export async function serveRemoteMcp(
  options: RemoteMcpOptions & { readonly port: number; readonly host: string },
): Promise<Server> {
  const handle = createRemoteMcpHandler(options);
  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) answer(response, 500, "The server could not answer.");
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
  return server;
}
