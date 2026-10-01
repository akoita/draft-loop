import { describe, expect, it } from "vitest";

import {
  anthropicBillingLimitDiagnosticCode,
  classifyAnthropicBillingError,
} from "./anthropic-billing-error.js";

describe("Anthropic billing error classification", () => {
  it.each([
    { message: "Your credit balance is too low to make this request." },
    { message: "Your credit balance too low to make this request." },
    { message: "Insufficient credits are available for this request." },
    { message: "You have reached your specified API usage limits. Access will resume later." },
    { error: { message: "You have reached your specified workspace API usage limits." } },
    { error: { type: "enforced_spend_limit_reached" } },
    { error: { error: { code: "enforced_spend_limit_reached" } } },
    { error: { error: { details: { error_code: "enforced_spend_limit_reached" } } } },
    { type: "enforced_spend_limit_reached" },
  ])("recognizes an explicit bounded credit or spend-limit marker", (error) => {
    expect(classifyAnthropicBillingError(error)).toBe(anthropicBillingLimitDiagnosticCode);
  });

  it.each([
    { message: "The account has not reached a limit." },
    { message: "The credit balance is not too low for this request." },
    { message: "You have not reached your specified API usage limits." },
    { message: "You have reached your specified API usage limits_extra." },
    { message: "You have reached unrelated API usage limits." },
    { code: "insufficient_quota" },
    { error: { message: "Insufficient quota" }, type: "unrelated" },
    { code: "prefix_enforced_spend_limit_reached" },
    { type: "enforced_spend_limit_reached_suffix" },
    { error: { error: { error: { code: "enforced_spend_limit_reached" } } } },
    { message: `${"x".repeat(4_096)} credit balance is too low` },
  ])("leaves unrecognized or out-of-bound errors unclassified", (error) => {
    expect(classifyAnthropicBillingError(error)).toBeNull();
  });

  it("does not fail when a known error property getter throws", () => {
    const error = Object.defineProperty({}, "message", {
      get() {
        throw new Error("private getter detail");
      },
    });

    expect(classifyAnthropicBillingError(error)).toBeNull();
  });
});
