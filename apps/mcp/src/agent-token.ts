import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/**
 * The agent token (#2147, #2160): what `draftloop-mcp` sends instead of the owner token. It reaches
 * only its scopes in one workspace (#2438), so an agent that reads an untrusted repository
 * cannot use it to reach the candidate's records or decisions. `init` asks the server for
 * one with the owner token and keeps it in a file outside the project, which no project file names.
 */

export const agentTokenPrefix = "dlagent_";

type Environment = Readonly<Record<string, string | undefined>>;

/** Where the agent token is kept: the user's configuration folder, never the project. */
export function defaultAgentTokenPath(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const configured = environment.XDG_CONFIG_HOME;
  const base =
    configured !== undefined && configured !== ""
      ? configured
      : platform === "win32" && environment.APPDATA !== undefined && environment.APPDATA !== ""
        ? environment.APPDATA
        : join(home, ".config");
  return join(base, "draftloop", "agent-token");
}

export async function readAgentTokenFile(path: string): Promise<string | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  return text?.trim() || undefined;
}

export function isAgentToken(token: string): boolean {
  return token.startsWith(agentTokenPrefix);
}

export interface IssueAgentTokenInput {
  readonly baseUrl: string;
  readonly workspaceId: string;
  readonly ownerToken: string;
  readonly label: string;
  /** What the token may do; the server's default, the work journal only, when absent. */
  readonly scopes?: readonly string[] | undefined;
  readonly fetch?: typeof fetch;
}

export interface IssuedAgentToken {
  readonly id: string;
  readonly token: string;
}

/** Asks the server for an agent token with the owner token; throws a sentence to print. */
export async function issueAgentToken(input: IssueAgentTokenInput): Promise<IssuedAgentToken> {
  const fetcher = input.fetch ?? fetch;
  const url = `${input.baseUrl.replace(/\/+$/u, "")}/v1/workspaces/${encodeURIComponent(input.workspaceId)}/agent-tokens`;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.ownerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        label: input.label,
        ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
      }),
    });
  } catch {
    throw new Error("The DraftLoop server did not answer; start it with `draft-loop-server up`.");
  }
  if (response.status === 401) {
    throw new Error(
      "The server refused the owner token; set the one `draft-loop-server token` prints.",
    );
  }
  if (response.status === 404) {
    throw new Error("This server issues no agent tokens; upgrade it to server-v0.15.0 or later.");
  }
  const body = (await response.json().catch(() => ({}))) as { id?: unknown; token?: unknown };
  if (response.status !== 201 || typeof body.id !== "string" || typeof body.token !== "string") {
    throw new Error(`The server could not issue an agent token (HTTP ${response.status}).`);
  }
  return { id: body.id, token: body.token };
}

/** The shape the server issues: the prefix and 43 URL-safe characters. */
export function isAgentTokenShape(token: string): boolean {
  return /^dlagent_[A-Za-z0-9_-]{43}$/u.test(token);
}

/**
 * `draftloop-mcp save-token` (#2441): keeps a token created under Agents in Workspace
 * settings where the server reads it, so a plugin install needs no file in the project. The
 * token comes on standard input, never as an argument, so it stays out of the shell history.
 * Returns the line to print.
 */
export async function saveTokenFromInput(input: string, path: string): Promise<string> {
  const token = input.trim();
  if (!isAgentTokenShape(token)) {
    throw new Error(
      "That is not a DraftLoop agent token; copy the one shown under Agents in Workspace settings.",
    );
  }
  await saveAgentToken(path, token);
  return `saved: the agent token, to ${path}`;
}

/** Writes the token readable by this user only. */
export async function saveAgentToken(path: string, token: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${token}\n`, { mode: 0o600 });
}

/** The label the server lists the token under: the host and the project folder's name. */
export function agentTokenLabel(host: string, root: string): string {
  return `${host} in ${basename(root) || "a project"}`.slice(0, 120);
}

/**
 * Whether the workspace accepts notes from agents, read with the owner token (#2170);
 * undefined when the server does not say, so the caller still names the switch.
 */
export async function readIntakeEnabled(
  input: Omit<IssueAgentTokenInput, "label">,
): Promise<boolean | undefined> {
  const fetcher = input.fetch ?? fetch;
  const url = `${input.baseUrl.replace(/\/+$/u, "")}/v1/workspaces/${encodeURIComponent(input.workspaceId)}/work-journal/intake`;
  try {
    const response = await fetcher(url, {
      headers: { authorization: `Bearer ${input.ownerToken}` },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { enabled?: unknown };
    return typeof body.enabled === "boolean" ? body.enabled : undefined;
  } catch {
    return undefined;
  }
}
