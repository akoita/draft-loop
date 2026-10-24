import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConsentPanel, type ConsentPanelProps } from "./consent.js";
import type { Consents } from "./consent-model.js";
import { syntheticConsents, syntheticTransmissionGrant } from "./test-fixtures.js";

const none: Consents = {
  current: { "material-storage": null, "provider-transmission": null },
  history: [],
};

const props: ConsentPanelProps = {
  kind: "material-storage",
  consents: none,
  providers: ["anthropic", "openai"],
  messages: [],
  busy: false,
  onGrant: () => {},
  onWithdraw: () => {},
  locale: "en-GB",
};

describe("consent panel", () => {
  it("asks for the storage basis before the first upload", () => {
    const html = renderToStaticMarkup(<ConsentPanel {...props} />);

    expect(html).toContain("Consent to store the candidate&#x27;s material");
    expect(html).toContain("Not recorded yet. Record this before the first upload.");
    expect(html).toContain("<legend>Basis for storing the material</legend>");
    expect(html).toContain('type="radio" name="consent-material-storage-basis" value="contract"');
    expect(html).toContain("A contract with the candidate");
    expect(html).toContain("Legitimate interest");
    expect(html).toContain('<label for="consent-material-storage-note">Note (optional)</label>');
    expect(html).toContain("Record consent");
    expect(html).not.toContain("Withdraw consent");
    expect(html).not.toContain("History");
  });

  it("shows a storage grant with its history and offers to withdraw it", () => {
    const html = renderToStaticMarkup(<ConsentPanel {...props} consents={syntheticConsents} />);

    expect(html).toContain(
      "Granted on 23 Oct 2026, 09:00 UTC. Basis: a contract with the candidate.",
    );
    expect(html).toContain("Withdraw consent");
    expect(html).not.toContain("Record consent");
    expect(html).toContain("<summary>History (1)</summary>");
    expect(html).toContain("by a member.");
    expect(html).not.toContain("member-1");
  });

  it("names the providers in plain words before the first run", () => {
    const html = renderToStaticMarkup(
      <ConsentPanel {...props} kind="provider-transmission" messages={["Confirm first."]} />,
    );

    expect(html).toContain("Consent to send material to model providers");
    expect(html).toContain("to Anthropic and OpenAI to draft and review the CV");
    expect(html).toContain("Record this before the first run.");
    expect(html).toContain(
      "The candidate agreed that runs send their material to Anthropic and OpenAI",
    );
    expect(html).not.toContain("<legend>");
    expect(html).toContain('role="alert">Confirm first.</p>');
  });

  it("shows a withdrawn transmission consent and asks again", () => {
    const html = renderToStaticMarkup(
      <ConsentPanel {...props} kind="provider-transmission" consents={syntheticConsents} />,
    );

    expect(html).toContain(
      "Withdrawn on 23 Oct 2026, 11:00 UTC. Record this before the first run.",
    );
    expect(html).toContain("<summary>History (2)</summary>");
    expect(html).toContain("(Anthropic and OpenAI) · The candidate consented · by the owner.");
    expect(html).toContain("Record consent");
  });

  it("warns when the grant does not name a provider the workspace now uses", () => {
    const grant = { ...syntheticTransmissionGrant, providers: ["anthropic"] };
    const html = renderToStaticMarkup(
      <ConsentPanel
        {...props}
        kind="provider-transmission"
        consents={{ ...none, current: { ...none.current, "provider-transmission": grant } }}
      />,
    );

    expect(html).toContain("The consent does not name OpenAI.");
    expect(html).toContain("Withdraw consent");
  });
});
