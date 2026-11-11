import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentSetup, type AgentSetupProps } from "./agent-setup.js";
import {
  activeAgentTokens,
  agentChannelGuideUrl,
  agentConfiguration,
  agentConfigurationHoldsToken,
  agentTokenPlaceholder,
  parseAgentMonthlyCap,
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

  it("installs the Claude Code plugin and keeps the token outside the project", () => {
    expect(agentConfiguration("plugin", connection)).toBe(
      [
        "# In Claude Code",
        "/plugin marketplace add akoita/draft-loop",
        "/plugin install draftloop@draftloop",
        "# In a terminal: paste the token, then press Enter and Ctrl-D",
        "draftloop-mcp save-token",
      ].join("\n"),
    );
    expect(agentConfigurationHoldsToken("plugin")).toBe(false);
    expect(agentConfigurationHoldsToken("claude-code")).toBe(true);
    const elsewhere = agentConfiguration("plugin", {
      ...connection,
      serverUrl: "http://127.0.0.1:8081",
      workspaceId: "side-projects",
    });
    expect(elsewhere).toContain("export DRAFT_LOOP_SERVER_URL=http://127.0.0.1:8081");
    expect(elsewhere).toContain("export DRAFT_LOOP_SERVER_WORKSPACE=side-projects");
    expect(elsewhere).not.toContain("dlagent_");
  });

  it("holds a placeholder until a token is created", () => {
    const configuration = agentConfiguration("claude-code", { ...connection, token: undefined });
    expect(configuration).toContain(`DRAFT_LOOP_SERVER_TOKEN=${agentTokenPlaceholder}`);
  });

  it("keeps only the tokens that still work", () => {
    const token = {
      label: "Claude Code",
      scopes: ["journal" as const],
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

describe("monthly spend limit", () => {
  it("reads 0.01 to 500 US dollars in cents, with a comma or a point", () => {
    expect(parseAgentMonthlyCap(" 5 ")).toBe(5);
    expect(parseAgentMonthlyCap("12,50")).toBe(12.5);
    expect(parseAgentMonthlyCap("500")).toBe(500);
    for (const refused of ["0", "500.01", "1.234", "-3", "abc", ""]) {
      expect(parseAgentMonthlyCap(refused), refused).toBeUndefined();
    }
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
    expect(html).toContain("Connect an agent");
    expect(html).toContain("Create agent token");
    // The plugin comes first; its steps hold no token, so they can be copied at once.
    expect(html).toContain("/plugin marketplace add akoita/draft-loop");
    expect(html).toContain("draftloop-mcp save-token");
    expect(html).not.toContain("&lt;agent-token&gt;");
    expect(html).toMatch(/<button type="button">Copy<\/button>/u);
    expect(html).toContain("Active agent tokens: 0");
    expect(html).toContain(agentChannelGuideUrl);
  });

  it("offers each scope with the journal ticked, and lists a token's scopes", () => {
    const html = renderToStaticMarkup(
      <AgentSetup
        {...props}
        open
        tokens={[
          {
            id: "dlat_active01",
            label: "Claude Code",
            scopes: ["journal", "applications:read"],
            created_at: "2026-11-07T10:00:00.000Z",
            expires_at: "2027-02-05T10:00:00.000Z",
            active: true,
          },
        ]}
      />,
    );
    expect(html).toContain('id="coding-agents"');
    expect(html).toContain("<h3>Agents</h3>");
    expect(html).toContain('<details class="agent-setup" open="">');
    expect(html.match(/type="checkbox"/gu)).toHaveLength(5);
    expect(html.match(/checked=""/gu)).toHaveLength(3);
    // Starting runs spends money: never ticked unasked, and its limit shows once it is ticked.
    expect(html).not.toMatch(/checked=""[^>]*\/> Start CV runs/u);
    expect(html).not.toContain("Monthly spend limit");
    expect(html).not.toMatch(/checked=""[^>]*\/> Read your exported CVs/u);
    expect(html).toMatch(/checked=""[^>]*\/> Record notable work/u);
    expect(html).toContain("See your job applications");
    expect(html).toContain("Add a job application from a pasted job description");
    expect(html).toContain("Active agent tokens: 1");
  });

  it("shows the host's work journal switch above Connect an agent", () => {
    const html = renderToStaticMarkup(<AgentSetup {...props} workJournal={<p>the switch</p>} />);
    expect(html.indexOf("the switch")).toBeGreaterThan(-1);
    expect(html.indexOf("the switch")).toBeLessThan(html.indexOf("Connect an agent"));
  });

  it("shows what connected assistants may spend where the host keeps their limits", () => {
    const html = renderToStaticMarkup(
      <AgentSetup {...props} available={false} connections={<p>the limits</p>} />,
    );
    expect(html).toContain("the limits");
    expect(html).not.toContain("is not available yet");
    expect(html).not.toContain("Connect an agent</summary>");
  });

  it("says the hosted service cannot connect an agent yet, with only the guide", () => {
    const html = renderToStaticMarkup(<AgentSetup {...props} available={false} />);
    expect(html).toContain("is not available yet");
    expect(html).toContain(agentChannelGuideUrl);
    expect(html).not.toContain("Create agent token");
    expect(html).not.toContain("draftloop-mcp");
    expect(html).toContain("<h3>Agents</h3>");
  });

  it("shows nothing until the server says which applies", () => {
    expect(renderToStaticMarkup(<AgentSetup {...props} available={undefined} />)).toBe("");
  });
});
