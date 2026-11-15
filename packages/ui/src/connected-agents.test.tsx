import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { assistantName, ConnectedAgents } from "./connected-agents.js";

const token = {
  id: "dlat_active01",
  label: "Claude Code on my laptop",
  scopes: ["journal", "runs:start"] as const,
  created_at: "2026-11-07T10:00:00.000Z",
  expires_at: "2027-02-05T10:00:00.000Z",
  active: true,
  monthly_cap_usd: 5,
  spent_this_month_usd: 1.5,
};

const noop = async () => undefined;

describe("connected agents", () => {
  it("names an assistant by its company or its address, never by a raw id when it can", () => {
    expect(assistantName("draftloop-claude")).toBe("Claude");
    expect(assistantName("chatgpt-connector")).toBe("ChatGPT");
    expect(assistantName("https://assistant.example.test/client.json")).toBe(
      "assistant.example.test",
    );
    expect(assistantName("other-client")).toBe("other-client");
  });

  it("shows each token's scopes, spending and a way to disconnect it, in one table", () => {
    const html = renderToStaticMarkup(
      <ConnectedAgents tokens={[token]} assistants={undefined} onRevoke={noop} />,
    );
    expect(html).toContain('<th scope="row" data-label="Agent">');
    expect(html).toContain("Claude Code on my laptop");
    expect(html).toContain("Work journal · Start runs and drafts");
    expect(html).toContain("US$1.5 of US$5 this month");
    expect(html).toContain(">Disconnect</button>");
  });

  it("offers to set a limit on an assistant that waits for one, and to change one it has", () => {
    const html = renderToStaticMarkup(
      <ConnectedAgents
        tokens={undefined}
        assistants={[
          { client_id: "draftloop-claude", monthly_cap_usd: 5, spent_this_month_usd: 0 },
          { client_id: "chatgpt-connector", spent_this_month_usd: 0 },
        ]}
        onRevoke={noop}
        onSetLimit={noop}
        onRemoveAssistant={noop}
      />,
    );
    expect(html).toContain(">Change limit</button>");
    expect(html).toContain(">Set a limit</button>");
    expect(html).toContain(">Stop spending</button>");
    expect(html).toContain(">Remove</button>");
  });

  it("says nothing is connected, or draws nothing where the server keeps neither", () => {
    expect(
      renderToStaticMarkup(<ConnectedAgents tokens={[]} assistants={[]} onRevoke={noop} />),
    ).toContain("No agent is connected yet");
    expect(
      renderToStaticMarkup(
        <ConnectedAgents tokens={undefined} assistants={undefined} onRevoke={noop} />,
      ),
    ).toBe("");
  });
});
