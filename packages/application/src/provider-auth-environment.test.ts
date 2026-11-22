import { describe, expect, it } from "vitest";

import { providerAuthModesFromEnvironment } from "./provider-auth-environment.js";

describe("providerAuthModesFromEnvironment", () => {
  it("defaults both providers to API keys", () => {
    expect(providerAuthModesFromEnvironment({})).toEqual({
      anthropic: "api-key",
      openai: "api-key",
    });
  });

  it("reads each provider's mode on its own, treating empty as unset", () => {
    expect(
      providerAuthModesFromEnvironment({
        DRAFT_LOOP_ANTHROPIC_AUTH_MODE: "user-session",
        DRAFT_LOOP_OPENAI_AUTH_MODE: "",
      }),
    ).toEqual({ anthropic: "user-session", openai: "api-key" });
  });

  it("refuses an unknown mode", () => {
    expect(() =>
      providerAuthModesFromEnvironment({ DRAFT_LOOP_OPENAI_AUTH_MODE: "oauth" }),
    ).toThrow("Unsupported provider authentication mode: oauth");
  });
});
