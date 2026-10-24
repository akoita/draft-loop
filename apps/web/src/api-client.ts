import type { ApiOperations, ApiSchemas } from "./api-types.generated.js";

export type ApiOperation = keyof ApiOperations;
export type ApiResponse<K extends ApiOperation> = ApiOperations[K]["response"];
export type ApiInput<K extends ApiOperation> = Omit<ApiOperations[K], "response">;
export type { ApiSchemas };

/** The numbers and names a refusal carries beside its code, such as a plan limit; never content. */
export type ApiErrorDetails = Pick<
  ApiSchemas["ApiError"]["error"],
  "role" | "tier" | "cap" | "limit" | "value" | "estimate" | "remaining"
>;

const detailKeys = ["role", "tier", "cap", "limit", "value", "estimate", "remaining"] as const;

/** An answer the API refused, with its content-free code and message (`ApiError`). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  /** With a plan refusal, what it names: the tier, the cap, the limit, the estimate. */
  readonly details?: ApiErrorDetails;
  /** With `material_quarantined`, the stored screening results that hold the request. */
  readonly quarantined?: readonly ApiSchemas["QuarantinedMaterial"][];

  constructor(
    status: number,
    code: string,
    message: string,
    quarantined?: readonly ApiSchemas["QuarantinedMaterial"][],
    details?: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    if (quarantined !== undefined) this.quarantined = quarantined;
    if (details !== undefined && Object.keys(details).length > 0) this.details = details;
  }
}

export interface ApiClient {
  call<K extends ApiOperation>(operation: K, input: ApiInput<K>): Promise<ApiResponse<K>>;
}

export interface ApiClientOptions {
  /** The owner token or sign-in access token, sent as the bearer credential on every call. */
  readonly token?: string;
  /** Where the API is; empty for the origin that served the screen. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

interface CallInput {
  readonly path?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, string | number | undefined>>;
  readonly header?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly contentType?: string;
}

/** Fills a route's `{name}` segments, encoding each value. */
export function operationUrl(path: string, input: CallInput): string {
  const filled = path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = input.path?.[name];
    if (value === undefined) throw new Error(`The ${name} path parameter is missing.`);
    return encodeURIComponent(value);
  });
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {}))
    if (value !== undefined) query.set(key, String(value));
  const search = query.toString();
  return search === "" ? filled : `${filled}?${search}`;
}

async function refusal(response: Response): Promise<ApiRequestError> {
  try {
    const body = (await response.json()) as ApiSchemas["ApiError"];
    return new ApiRequestError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.quarantined,
      Object.fromEntries(
        detailKeys
          .filter((key) => body.error[key] !== undefined)
          .map((key) => [key, body.error[key]]),
      ),
    );
  } catch {
    return new ApiRequestError(
      response.status,
      "unreadable-error",
      `The API answered ${response.status}.`,
    );
  }
}

/** A client of the hosted API, typed by its OpenAPI document. */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl ?? "";
  return {
    async call(operation, input) {
      const [method, path] = operation.split(" ") as [string, string];
      const request = input as CallInput;
      const headers: Record<string, string> = { ...request.header };
      // Only public routes, such as how to sign in, are called without a credential.
      if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
      let body: BodyInit | undefined;
      if (request.body instanceof Blob) {
        body = request.body;
        headers["content-type"] = request.contentType ?? "application/octet-stream";
      } else if (request.body !== undefined) {
        body = JSON.stringify(request.body);
        headers["content-type"] = "application/json";
      }
      const response = await fetchImpl(`${baseUrl}${operationUrl(path, request)}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      });
      if (!response.ok) throw await refusal(response);
      const type = response.headers.get("content-type") ?? "";
      if (type.startsWith("application/json")) return (await response.json()) as never;
      return (await response.blob()) as never;
    },
  };
}

/** What to tell the owner about a failed call; the API's messages are written for them. */
export function describeError(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  return "The service could not be reached. Check your connection and try again.";
}
