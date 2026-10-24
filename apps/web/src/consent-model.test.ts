import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api-client.js";
import {
  type Consents,
  consentHistory,
  consentRefusal,
  consentSummary,
  describeActionError,
  grantRequest,
  historyLine,
  isGranted,
  providerList,
  unconsentedProviders,
  withdrawRequest,
  workspaceProviders,
} from "./consent-model.js";
import { syntheticConsents, syntheticTransmissionGrant } from "./test-fixtures.js";

const none: Consents = {
  current: { "material-storage": null, "provider-transmission": null },
  history: [],
};

describe("consent requests", () => {
  it("records storage with any lawful basis and a trimmed note", () => {
    expect(grantRequest("material-storage", { basis: undefined })).toEqual({
      problem: "Choose the basis for storing the candidate's material.",
    });
    expect(
      grantRequest("material-storage", { basis: "contract", note: "  Signed 2026  " }),
    ).toEqual({
      body: { kind: "material-storage", action: "granted", basis: "contract", note: "Signed 2026" },
    });
    expect(grantRequest("material-storage", { basis: "contract", note: "x".repeat(501) })).toEqual({
      problem: "Keep the note to 500 characters.",
    });
  });

  it("records transmission on the candidate's consent, naming the workspace's providers", () => {
    const providers = workspaceProviders({
      author: { company: "openai", model: "author-model" },
      critic: { company: "anthropic", model: "critic-model" },
    });
    expect(providers).toEqual(["anthropic", "openai"]);
    expect(
      grantRequest("provider-transmission", { basis: "candidate-consent", providers }),
    ).toEqual({ problem: "Confirm that the candidate agreed to send their material." });
    expect(
      grantRequest("provider-transmission", {
        basis: "contract",
        providers,
        confirmed: true,
      }),
    ).toEqual({
      body: {
        kind: "provider-transmission",
        action: "granted",
        basis: "candidate-consent",
        providers: ["anthropic", "openai"],
      },
    });
    expect(
      grantRequest("provider-transmission", {
        basis: "candidate-consent",
        providers: [],
        confirmed: true,
      }),
    ).toEqual({ problem: "Set up the workspace's author and critic models first." });
  });

  it("names Anthropic and OpenAI by default, and one company once", () => {
    expect(workspaceProviders(undefined)).toEqual(["anthropic", "openai"]);
    expect(
      workspaceProviders({
        author: { company: "anthropic", model: "a" },
        critic: { company: "anthropic", model: "b" },
      }),
    ).toEqual(["anthropic"]);
    expect(providerList(["anthropic", "openai"])).toBe("Anthropic and OpenAI");
    expect(providerList(["openai"])).toBe("OpenAI");
  });

  it("withdraws the current grant on its basis, and only a grant", () => {
    expect(withdrawRequest("material-storage", syntheticConsents)).toEqual({
      body: { kind: "material-storage", action: "withdrawn", basis: "contract" },
    });
    expect(withdrawRequest("provider-transmission", syntheticConsents)).toEqual({
      problem: "There is no consent to withdraw.",
    });
    expect(withdrawRequest("material-storage", none)).toEqual({
      problem: "There is no consent to withdraw.",
    });
  });
});

describe("consent state", () => {
  it("summarises each kind's current entry", () => {
    expect(isGranted(syntheticConsents, "material-storage")).toBe(true);
    expect(isGranted(syntheticConsents, "provider-transmission")).toBe(false);
    expect(consentSummary(none, "material-storage")).toBe("Not recorded yet.");
    expect(consentSummary(syntheticConsents, "material-storage", "en-GB")).toBe(
      "Granted on 23 Oct 2026, 09:00 UTC. Basis: a contract with the candidate.",
    );
    expect(consentSummary(syntheticConsents, "provider-transmission", "en-GB")).toBe(
      "Withdrawn on 23 Oct 2026, 11:00 UTC.",
    );
  });

  it("lists a kind's history newest first, with who and when but no ids", () => {
    const lines = consentHistory(syntheticConsents, "provider-transmission").map((entry) =>
      historyLine(entry, "en-GB"),
    );
    expect(lines).toEqual([
      "23 Oct 2026, 11:00 UTC · Withdrawn: sending to providers · The candidate consented · by a member.",
      "23 Oct 2026, 10:00 UTC · Granted: sending to providers (Anthropic and OpenAI) · The candidate consented · by the owner. Note: Agreed by email.",
    ]);
    expect(lines.join(" ")).not.toContain("member-1");
    expect(lines.join(" ")).not.toContain("consent-");
  });

  it("flags providers the current grant does not name", () => {
    const granted: Consents = {
      ...syntheticConsents,
      current: {
        ...syntheticConsents.current,
        "provider-transmission": { ...syntheticTransmissionGrant },
      },
    };
    expect(unconsentedProviders(granted, ["anthropic", "openai"])).toEqual([]);
    expect(
      unconsentedProviders(
        {
          ...granted,
          current: {
            ...granted.current,
            "provider-transmission": { ...syntheticTransmissionGrant, providers: ["anthropic"] },
          },
        },
        ["anthropic", "openai"],
      ),
    ).toEqual(["openai"]);
    expect(unconsentedProviders(syntheticConsents, ["openai"])).toEqual([]);
  });
});

describe("consent refusals", () => {
  it("points a refused upload or run to the missing consent", () => {
    const storage = new ApiRequestError(409, "storage_consent_required", "Consent is required.");
    const transmission = new ApiRequestError(
      409,
      "transmission_consent_required",
      "Consent is required.",
    );
    expect(consentRefusal(storage)?.kind).toBe("material-storage");
    expect(describeActionError(storage)).toContain(
      "Record the basis for storing it in the Sources step",
    );
    expect(consentRefusal(transmission)?.kind).toBe("provider-transmission");
    expect(describeActionError(transmission)).toContain("Record their consent in the Run step");
    const other = new ApiRequestError(409, "run_active", "A run is already active.");
    expect(consentRefusal(other)).toBeUndefined();
    expect(describeActionError(other)).toBe("A run is already active.");
  });
});
