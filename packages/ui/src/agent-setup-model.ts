import { t } from "@lingui/core/macro";

/**
 * The ready-to-copy configuration that connects a coding agent to this server's work journal
 * (#2427). Each agent reads the same `draftloop-mcp` process with the same variables; only the
 * file or command that holds them differs.
 */

export type AgentHost = "claude-code" | "codex" | "json";

export const agentHosts: readonly AgentHost[] = ["claude-code", "codex", "json"];

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

/** One of the workspace's agent tokens, as the API lists it. */
export interface AgentTokenView {
  readonly id: string;
  readonly label: string;
  readonly created_at: string;
  readonly expires_at: string;
  readonly active: boolean;
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
