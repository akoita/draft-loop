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

export interface RemoteMcpOptions {
  /** The DraftLoop API the tools call. */
  readonly baseUrl: string;
  /** The workspace the tools act in. */
  readonly workspaceId: string;
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
  return {
    baseUrl: environment.DRAFT_LOOP_SERVER_URL ?? defaultServerUrl,
    workspaceId: environment.DRAFT_LOOP_SERVER_WORKSPACE ?? defaultServerWorkspace,
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
    if (path !== remoteMcpPath) return answer(response, 404, "Not found.");
    if (request.method !== "POST") {
      return answer(response, 405, "Use POST: this server keeps no session.", { allow: "POST" });
    }
    const token = bearerToken(request);
    if (token === undefined) {
      return answer(response, 401, "A DraftLoop credential is required.", {
        "www-authenticate": "Bearer",
      });
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
      workspaceId: options.workspaceId,
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
