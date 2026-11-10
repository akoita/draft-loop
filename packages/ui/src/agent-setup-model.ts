import { t } from "@lingui/core/macro";

/**
 * The ready-to-copy configuration that connects an agent to this server (#2427), and the
 * scopes a new agent token may hold (#2439). Each agent reads the same `draftloop-mcp` process with the same variables; only the
 * file or command that holds them differs.
 */

export type AgentHost = "plugin" | "claude-code" | "codex" | "json";

export const agentHosts: readonly AgentHost[] = ["plugin", "claude-code", "codex", "json"];

/** Whether the configuration holds the token, so it cannot be copied before one exists. */
export function agentConfigurationHoldsToken(host: AgentHost): boolean {
  return host !== "plugin";
}

const defaultServerUrl = "http://127.0.0.1:8080";

/** The public setup guide; it holds no address or identifier of any deployment. */
export const agentChannelGuideUrl =
  "https://github.com/akoita/draft-loop/blob/main/docs/reference/agent-channel.md";

/** Shown in place of the secret until a token is created. */
export const agentTokenPlaceholder = "<agent-token>";

export interface AgentConnection {
  /** The address the screen is served from, which is the API's. */
  readonly serverUrl: string;
  readonly workspaceId: string;
  /** The agent token's secret; the placeholder until one is created. */
  readonly token?: string | undefined;
}

/** What an agent token may do, as the API names it (ADR 0011 D17). */
export type AgentScope =
  | "journal"
  | "applications:read"
  | "jobs:write"
  | "drafts:read"
  | "runs:start";

export const agentScopes: readonly AgentScope[] = [
  "journal",
  "applications:read",
  "jobs:write",
  "drafts:read",
  "runs:start",
];

/**
 * A new token's scopes until the person changes them: what the plugin's skills and tools use
 * (#2534), so a first token is not refused. Reading CVs and drafts shares the candidate's
 * material with the agent (#2569), and starting runs spends money (#2599), so the person ticks
 * those themselves.
 */
export const defaultAgentScopes: readonly AgentScope[] = [
  "journal",
  "applications:read",
  "jobs:write",
];

export function agentScopeLabel(scope: AgentScope): string {
  switch (scope) {
    case "journal":
      return t`Record notable work in the Work journal and list their titles`;
    case "applications:read":
      return t`See your job applications and how their runs stand`;
    case "jobs:write":
      return t`Add a job application from a pasted job description`;
    case "drafts:read":
      return t`Read your exported CVs and saved cover letters and interview questions`;
    case "runs:start":
      return t`Start CV runs on jobs whose requirements you reviewed, and draft cover letters and interview questions, within a monthly spend limit`;
  }
}

/** A short name for a scope, for the token list. */
export function agentScopeName(scope: AgentScope): string {
  switch (scope) {
    case "journal":
      return t`Work journal`;
    case "applications:read":
      return t`Read applications`;
    case "jobs:write":
      return t`Add jobs`;
    case "drafts:read":
      return t`Read CVs and drafts`;
    case "runs:start":
      return t`Start runs and drafts`;
  }
}

/** The monthly spend limit a token that starts runs gets until the person changes it. */
export const defaultAgentMonthlyCapUsd = "5";

/** The spend limit the person typed, in US dollars; undefined unless 0.01 to 500 in cents. */
export function parseAgentMonthlyCap(text: string): number | undefined {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{1,2})?$/u.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= 0.01 && value <= 500 ? value : undefined;
}

/** One of the workspace's agent tokens, as the API lists it. */
export interface AgentTokenView {
  readonly id: string;
  readonly label: string;
  readonly scopes: readonly AgentScope[];
  readonly created_at: string;
  readonly expires_at: string;
  readonly active: boolean;
  /** With `runs:start`: the monthly spend limit and what this month used, in US dollars. */
  readonly monthly_cap_usd?: number | undefined;
  readonly spent_this_month_usd?: number | undefined;
}

const defaultWorkspace = "owner";

function variables(connection: AgentConnection): readonly (readonly [string, string])[] {
  return [
    ["DRAFT_LOOP_SERVER_URL", connection.serverUrl.replace(/\/+$/u, "")],
    ["DRAFT_LOOP_SERVER_TOKEN", connection.token ?? agentTokenPlaceholder],
    ...(connection.workspaceId === defaultWorkspace
      ? []
      : [["DRAFT_LOOP_SERVER_WORKSPACE", connection.workspaceId] as const]),
  ];
}

/** The configuration to paste into one agent, with the token in it once it exists. */
export function agentConfiguration(host: AgentHost, connection: AgentConnection): string {
  const env = variables(connection);
  switch (host) {
    case "plugin": {
      // The plugin's server reads the token `save-token` keeps; only other values are exported.
      const exports = env.filter(
        ([name, value]) =>
          name === "DRAFT_LOOP_SERVER_WORKSPACE" ||
          (name === "DRAFT_LOOP_SERVER_URL" && value !== defaultServerUrl),
      );
      return [
        "# In Claude Code",
        "/plugin marketplace add akoita/draft-loop",
        "/plugin install draftloop@draftloop",
        "# In a terminal: paste the token, then press Enter and Ctrl-D",
        "draftloop-mcp save-token",
        ...(exports.length === 0
          ? []
          : [
              "# In your shell profile, before starting Claude Code",
              ...exports.map(([name, value]) => `export ${name}=${value}`),
            ]),
      ].join("\n");
    }
    case "claude-code":
      return [
        "claude mcp add draftloop --scope user \\",
        ...env.map(([name, value]) => `  --env ${name}=${value} \\`),
        "  -- draftloop-mcp",
      ].join("\n");
    case "codex":
      return [
        "[mcp_servers.draftloop]",
        'command = "draftloop-mcp"',
        `env = { ${env.map(([name, value]) => `${name} = ${JSON.stringify(value)}`).join(", ")} }`,
      ].join("\n");
    case "json":
      return JSON.stringify(
        { mcpServers: { draftloop: { command: "draftloop-mcp", env: Object.fromEntries(env) } } },
        null,
        2,
      );
  }
}

export function agentHostLabel(host: AgentHost): string {
  switch (host) {
    case "plugin":
      return t`Claude Code plugin`;
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex";
    case "json":
      return t`Other MCP agents (JSON)`;
  }
}

/** Where the configuration goes, for one agent. */
export function agentHostHint(host: AgentHost): string {
  switch (host) {
    case "plugin":
      return t`Installs the DraftLoop tools, the /log-work and /tailor-cv skills and a reminder to record notable work. The token goes in your user folder, never in a project.`;
    case "claude-code":
      return t`Run it in a terminal. It saves the server in your user settings.`;
    case "codex":
      return t`Add it to ~/.codex/config.toml.`;
    case "json":
      return t`Add it to your agent's MCP settings file.`;
  }
}

/** The tokens that still work, newest first as the API lists them. */
export function activeAgentTokens(tokens: readonly AgentTokenView[]): readonly AgentTokenView[] {
  return tokens.filter((token) => token.active);
}
