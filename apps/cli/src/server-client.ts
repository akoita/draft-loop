import { CliUserError } from "./workflow.js";

/** The `fetch` the server import calls; replaced in tests. */
export type ServerFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface ServerConnection {
  /** The server's address, such as `http://127.0.0.1:8080`. */
  readonly baseUrl: string;
  /** The owner token or a signed-in user's bearer token. */
  readonly token: string;
  readonly fetch: ServerFetch;
}

export interface ServerResponse<Body> {
  readonly status: number;
  readonly body: Body;
}

function serverError(status: number, body: unknown): CliUserError {
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  const code = typeof error?.code === "string" ? error.code : `http_${status}`;
  const message = typeof error?.message === "string" ? ` ${error.message}` : "";
  if (status === 401) {
    return new CliUserError(
      "The server refused the token (401). Check --token-file or DRAFT_LOOP_SERVER_TOKEN.",
    );
  }
  return new CliUserError(`The server answered ${status} (${code}).${message}`);
}

/**
 * One JSON or file request to the DraftLoop server's HTTP API. Any answer other than 2xx becomes a
 * user error that names the status and the API's error code, never the request's content.
 */
export async function serverRequest<Body>(
  connection: ServerConnection,
  path: string,
  init: {
    readonly method: "GET" | "POST";
    readonly json?: unknown;
    readonly file?: { readonly bytes: Uint8Array; readonly mediaType: string };
  },
): Promise<ServerResponse<Body>> {
  const headers: Record<string, string> = { authorization: `Bearer ${connection.token}` };
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.file !== undefined) {
    headers["content-type"] = init.file.mediaType;
    body = new Blob([init.file.bytes as Uint8Array<ArrayBuffer>]);
  }
  let response: Response;
  try {
    response = await connection.fetch(new URL(path, connection.baseUrl).toString(), {
      method: init.method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
  } catch {
    throw new CliUserError(
      `The server at ${connection.baseUrl} could not be reached. Is it running? Start it with \`draft-loop-server up\`.`,
    );
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) throw serverError(response.status, parsed);
  return { status: response.status, body: parsed as Body };
}
