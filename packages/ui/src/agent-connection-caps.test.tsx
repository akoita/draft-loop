import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentConnectionCaps, parseAssistantId } from "./agent-connection-caps.js";

const never = async () => undefined;
const claude = { client_id: "claude", monthly_cap_usd: 10, spent_this_month_usd: 4 };

describe("AgentConnectionCaps", () => {
  it("draws nothing until the limits are read", () => {
    expect(
      renderToStaticMarkup(
        <AgentConnectionCaps connections={undefined} onSet={never} onRemove={never} />,
      ),
    ).toBe("");
  });

  it("says that no assistant has a limit, and offers to set one", () => {
    const html = renderToStaticMarkup(
      <AgentConnectionCaps connections={[]} onSet={never} onRemove={never} />,
    );

    expect(html).toContain("No assistant has a spend limit.");
    expect(html).toContain("Set spend limit");
    expect(html).toContain("Without a limit it starts none.");
  });

  it("shows each assistant's state in words, with named buttons and no checkbox", () => {
    const html = renderToStaticMarkup(
      <AgentConnectionCaps connections={[claude]} onSet={never} onRemove={never} />,
    );

    expect(html).toContain('<span class="state-pill">On</span> claude');
    expect(html).toContain("US$4 of US$10 used this month.");
    expect(html).toContain("Change limit");
    expect(html).toContain("Stop spending");
    expect(html).not.toContain('type="checkbox"');
  });

  it("asks once before stopping an assistant, and says what stops", () => {
    const html = renderToStaticMarkup(
      <AgentConnectionCaps
        connections={[claude]}
        onSet={never}
        onRemove={never}
        confirmingStop="claude"
      />,
    );

    expect(html).toContain("Stop spending by claude?");
    expect(html).toContain("It will start no run or draft until you set a limit again.");
    expect(html).toContain("Keep the limit");
    expect(html).not.toContain("Change limit");
  });
});

describe("parseAssistantId", () => {
  it("takes visible characters only, trimmed, up to 200", () => {
    expect(parseAssistantId("  claude ")).toBe("claude");
    expect(parseAssistantId("https://assistant.example.test/client.json")).toBe(
      "https://assistant.example.test/client.json",
    );
    expect(parseAssistantId("")).toBe(undefined);
    expect(parseAssistantId("two words")).toBe(undefined);
    expect(parseAssistantId("a".repeat(201))).toBe(undefined);
  });
});
