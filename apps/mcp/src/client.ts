import { readFile } from "node:fs/promises";
import type { WorkJournalNoteListItem } from "@draft-loop/schemas/work-journal";

import { defaultAgentTokenPath, readAgentTokenFile } from "./agent-token.js";

/**
 * The MCP server's HTTP client of the DraftLoop API (ADR 0011 D17): the self-hosted stack with
 * an agent token that reaches only the work journal (#2160), the cloud with a signed-in token
 * later. It holds no domain logic and
 * never returns the token.
 */

export const defaultServerUrl = "http://127.0.0.1:8080";
export const defaultServerWorkspace = "owner";
export const signInCommand = "draft-loop-server token";

export interface WorkJournalApiConfig {
  readonly baseUrl: string;
  /** Read on each call, so a renewed token in its file is picked up without a restart. */
  readonly token: () => Promise<string | undefined>;
  readonly workspaceId: string;
  readonly fetch?: typeof fetch;
}

/**
 * The address, token and workspace from the host's environment. The token is read, in order, from
 * `DRAFT_LOOP_SERVER_TOKEN_FILE`, the agent token `init` saved, then `DRAFT_LOOP_SERVER_TOKEN`,
 * which an older setup holds the owner token in and which keeps working.
 */
export function configFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  agentTokenPath: string = defaultAgentTokenPath(environment),
): WorkJournalApiConfig {
  const tokenFile = environment.DRAFT_LOOP_SERVER_TOKEN_FILE;
  return {
    baseUrl: environment.DRAFT_LOOP_SERVER_URL ?? defaultServerUrl,
    workspaceId: environment.DRAFT_LOOP_SERVER_WORKSPACE ?? defaultServerWorkspace,
    token: async () => {
      if (tokenFile !== undefined && tokenFile !== "") {
        const text = await readFile(tokenFile, "utf8").catch(() => undefined);
        return text?.trim() || undefined;
      }
      return (
        (await readAgentTokenFile(agentTokenPath)) ??
        (environment.DRAFT_LOOP_SERVER_TOKEN?.trim() || undefined)
      );
    },
  };
}

/** A refusal the agent can repeat: the API's content-free code and one sentence. */
export class WorkJournalApiError extends Error {
  readonly code: string;
  readonly fields: readonly string[];

  constructor(code: string, message: string, fields: readonly string[] = []) {
    super(message);
    this.name = "WorkJournalApiError";
    this.code = code;
    this.fields = fields;
  }
}

const notSignedIn = () =>
  new WorkJournalApiError(
    "not_signed_in",
    `DraftLoop has no valid token for this server; run \`draftloop-mcp init\` again with the owner token that \`${signInCommand}\` prints.`,
  );

export interface RecordWorkResult {
  readonly note_id?: string;
  readonly status: "pending" | "amended" | "duplicate" | "previously_discarded" | "validated";
  readonly duplicate_of?: string;
  readonly possible_duplicate_of: readonly string[];
  readonly screening?: "clear" | "flagged" | "unscreened";
  readonly review_url?: string;
  readonly message: string;
}

export interface ListWorkQuery {
  readonly project?: string | undefined;
  readonly since?: string | undefined;
  readonly status?: WorkJournalNoteListItem["status"] | undefined;
  readonly limit?: number | undefined;
}

export interface WorkJournalApi {
  record(note: unknown, idempotencyKey?: string): Promise<RecordWorkResult>;
  list(query: ListWorkQuery): Promise<readonly WorkJournalNoteListItem[]>;
}

interface ErrorBody {
  readonly error?: {
    readonly code?: unknown;
    readonly message?: unknown;
    readonly issues?: readonly { readonly path?: unknown }[];
  };
}

export function createWorkJournalApi(config: WorkJournalApiConfig): WorkJournalApi {
  const fetcher = config.fetch ?? fetch;
  const base = `${config.baseUrl.replace(/\/+$/u, "")}/v1/workspaces/${encodeURIComponent(config.workspaceId)}/work-journal`;

  const call = async (path: string, init: RequestInit): Promise<unknown> => {
    const token = await config.token();
    if (token === undefined) throw notSignedIn();
    let response: Response;
    try {
      response = await fetcher(`${base}${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      });
    } catch {
      throw new WorkJournalApiError(
        "server_unreachable",
        "The DraftLoop server did not answer; start it with `draft-loop-server up`.",
      );
    }
    const body = (await response.json().catch(() => ({}))) as unknown;
    if (response.status === 401) throw notSignedIn();
    if (!response.ok) {
      const error = (body as ErrorBody).error;
      throw new WorkJournalApiError(
        typeof error?.code === "string" ? error.code : `http_${response.status}`,
        typeof error?.message === "string"
          ? error.message
          : "The DraftLoop server refused the call.",
        (error?.issues ?? []).flatMap((issue) =>
          typeof issue.path === "string" ? [issue.path] : [],
        ),
      );
    }
    return body;
  };

  return {
    record: async (note, idempotencyKey) =>
      (await call("/notes", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
        },
        body: JSON.stringify(note),
      })) as RecordWorkResult,
    list: async (query) => {
      const parameters = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) parameters.set(key, String(value));
      }
      const suffix = parameters.size === 0 ? "" : `?${parameters.toString()}`;
      const body = (await call(`/notes${suffix}`, { method: "GET" })) as {
        readonly notes?: readonly WorkJournalNoteListItem[];
      };
      return body.notes ?? [];
    },
  };
}
