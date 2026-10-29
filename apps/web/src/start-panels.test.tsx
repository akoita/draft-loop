import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApiClient } from "./api-client.js";
import { type ConsentState, ConsentView } from "./consent.js";
import { type Consents, transmissionBlockedReason } from "./consent-model.js";
import { RunEstimatePanel } from "./credits.js";
import { HeaderCredits } from "./start-panels.js";
import {
  syntheticConsents,
  syntheticEstimate,
  syntheticTransmissionGrant,
} from "./test-fixtures.js";

const unusedClient: ApiClient = {
  call: async () => {
    throw new Error("not called while rendering");
  },
};

const noConsent: Consents = {
  current: { "material-storage": null, "provider-transmission": null },
  history: [],
};
const granted: Consents = {
  current: { ...syntheticConsents.current, "provider-transmission": syntheticTransmissionGrant },
  history: [...syntheticConsents.history],
};
const pair = ["anthropic", "openai"] as const;

const stateOf = (consents: Consents | undefined): ConsentState => ({
  consents,
  messages: [],
  busy: false,
  providers: pair,
  grant: () => {},
  withdraw: () => {},
});

describe("the consent that holds Start", () => {
  it("blocks Start with the actual providers until the consent is recorded", () => {
    expect(transmissionBlockedReason(noConsent, pair)).toBe(
      "Record the candidate's consent to send material to Anthropic and OpenAI first.",
    );
    expect(transmissionBlockedReason(noConsent, ["anthropic"])).toBe(
      "Record the candidate's consent to send material to Anthropic first.",
    );
    expect(transmissionBlockedReason(syntheticConsents, pair)).toContain(
      "Record the candidate's consent",
    );
  });

  it("lifts the reason once the consent names every provider", () => {
    expect(transmissionBlockedReason(granted, pair)).toBeNull();
  });

  it("blocks again when the model pair brings a provider the consent does not name", () => {
    const anthropicOnly: Consents = {
      ...granted,
      current: {
        ...granted.current,
        "provider-transmission": { ...syntheticTransmissionGrant, providers: ["anthropic"] },
      },
    };

    expect(transmissionBlockedReason(anthropicOnly, pair)).toContain("does not name OpenAI");
  });

  it("waits while the consents are being read", () => {
    expect(transmissionBlockedReason(undefined, pair)).toContain("Checking");
  });

  it("asks with the form while missing, and reads as one line once granted", () => {
    const asking = renderToStaticMarkup(
      <ConsentView kind="provider-transmission" state={stateOf(noConsent)} compact />,
    );
    expect(asking).toContain("Permission to send material to model providers");
    expect(asking).toContain("Record consent");

    const done = renderToStaticMarkup(
      <ConsentView kind="provider-transmission" state={stateOf(granted)} compact />,
    );
    expect(done).toContain("Permission to send material to model providers</strong> ·");
    expect(done).toContain("Granted on");
    expect(done).not.toContain("<form");
  });
});

describe("credits in sign-in mode", () => {
  it("shows the run's cost beside the consent", () => {
    const html = renderToStaticMarkup(
      <RunEstimatePanel state={{ kind: "ready", estimate: syntheticEstimate }} />,
    );

    expect(html).toContain("credit");
  });

  it("puts the chip in the header in sign-in mode only", () => {
    expect(HeaderCredits({ client: unusedClient, mode: "owner" })).toBeNull();
    expect(HeaderCredits({ client: unusedClient, mode: "sign-in" })).not.toBeNull();
  });
});
