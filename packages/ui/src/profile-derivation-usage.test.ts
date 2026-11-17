import { describe, expect, it } from "vitest";

import {
  normalizeProfileDerivationUsage,
  profileDerivationUsageSummary,
} from "./profile-derivation-usage.js";

const invalid = (): never => {
  throw new Error("invalid");
};

const usage = {
  calls: 3,
  failedCalls: 0,
  inputTokens: 50_000,
  outputTokens: 2_400,
  estimatedUsd: 0.08,
};

describe("profile derivation usage", () => {
  it("reads a host's usage and refuses a malformed one", () => {
    expect(normalizeProfileDerivationUsage(undefined, invalid)).toBeUndefined();
    expect(normalizeProfileDerivationUsage(usage, invalid)).toEqual(usage);
    expect(() => normalizeProfileDerivationUsage({ ...usage, extra: 1 }, invalid)).toThrow();
    expect(() => normalizeProfileDerivationUsage({ ...usage, failedCalls: 4 }, invalid)).toThrow();
    expect(() =>
      normalizeProfileDerivationUsage({ ...usage, estimatedUsd: -1 }, invalid),
    ).toThrow();
  });

  it("names the calls, tokens and cost in one line", () => {
    expect(profileDerivationUsageSummary(usage)).toBe(
      `3 model calls, ${(52_400).toLocaleString()} tokens, about $0.08.`,
    );
    expect(profileDerivationUsageSummary({ ...usage, failedCalls: 1, estimatedUsd: null })).toBe(
      `3 model calls (1 failed), ${(52_400).toLocaleString()} tokens; the cost is unknown for this model.`,
    );
  });
});
