import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentSetup, type AgentSetupProps } from "./agent-setup.js";
import {
  activeAgentTokens,
  agentChannelGuideUrl,
  agentConfiguration,
  agentTokenPlaceholder,
} from "./agent-setup-model.js";

// A fictional token: the real secrets are random and shown only once.
const connection = {
  serverUrl: "http://127.0.0.1:8080/",
  workspaceId: "owner",
  token: "dlagent_fictional-token",
};

describe("agent configuration", () => {
  it("is a user-scoped Claude Code command with the token and the address", () => {
    expect(agentConfiguration("claude-code", connection)).toBe(
      [
        "claude mcp add draftloop --scope user \\",
        "  --env DRAFT_LOOP_SERVER_URL=http://127.0.0.1:8080 \\",
        "  --env DRAFT_LOOP_SERVER_TOKEN=dlagent_fictional-token \\",
        "  -- draftloop-mcp",
      ].join("\n"),
    );
  });

  it("is a Codex table", () => {
    expect(agentConfiguration("codex", connection)).toBe(
      [
        "[mcp_servers.draftloop]",
        'command = "draftloop-mcp"',
        'env = { DRAFT_LOOP_SERVER_URL = "http://127.0.0.1:8080", DRAFT_LOOP_SERVER_TOKEN = "dlagent_fictional-token" }',
      ].join("\n"),
    );
  });

  it("is an mcpServers entry for other agents, naming a workspace other than the owner's", () => {
    expect(
      JSON.parse(agentConfiguration("json", { ...connection, workspaceId: "side-projects" })),
    ).toEqual({
      mcpServers: {
        draftloop: {
          command: "draftloop-mcp",
          env: {
            DRAFT_LOOP_SERVER_URL: "http://127.0.0.1:8080",
            DRAFT_LOOP_SERVER_TOKEN: "dlagent_fictional-token",
            DRAFT_LOOP_SERVER_WORKSPACE: "side-projects",
          },
        },
      },
    });
  });

  it("holds a placeholder until a token is created", () => {
    const configuration = agentConfiguration("claude-code", { ...connection, token: undefined });
    expect(configuration).toContain(`DRAFT_LOOP_SERVER_TOKEN=${agentTokenPlaceholder}`);
  });

  it("keeps only the tokens that still work", () => {
    const token = {
      label: "Claude Code",
      created_at: "2026-11-07T10:00:00.000Z",
      expires_at: "2027-02-05T10:00:00.000Z",
    };
    expect(
      activeAgentTokens([
        { ...token, id: "dlat_active01", active: true },
        { ...token, id: "dlat_revoked1", active: false },
      ]).map((each) => each.id),
    ).toEqual(["dlat_active01"]);
  });
});

const props: AgentSetupProps = {
  available: true,
  serverUrl: "http://127.0.0.1:8080",
  workspaceId: "owner",
  tokens: [],
  onIssue: async () => ({ problem: "unused" }),
  onRevoke: async () => undefined,
};

describe("AgentSetup", () => {
  it("shows the steps, the placeholder configuration and the guide where tokens are issued", () => {
    const html = renderToStaticMarkup(<AgentSetup {...props} />);
    expect(html).toContain("Connect a coding agent");
    expect(html).toContain("Create agent token");
    expect(html).toContain("claude mcp add draftloop --scope user");
    expect(html).toContain("&lt;agent-token&gt;");
    expect(html).toContain("Active agent tokens: 0");
    expect(html).toContain(agentChannelGuideUrl);
    // Nothing to copy before a token exists.
    expect(html).toMatch(/<button type="button" disabled="">Copy<\/button>/u);
  });

  it("says the hosted service cannot connect an agent yet, with only the guide", () => {
    const html = renderToStaticMarkup(<AgentSetup {...props} available={false} />);
    expect(html).toContain("is not available yet");
    expect(html).toContain(agentChannelGuideUrl);
    expect(html).not.toContain("Create agent token");
    expect(html).not.toContain("draftloop-mcp");
  });

  it("shows nothing until the server says which applies", () => {
    expect(renderToStaticMarkup(<AgentSetup {...props} available={undefined} />)).toBe("");
  });
});
