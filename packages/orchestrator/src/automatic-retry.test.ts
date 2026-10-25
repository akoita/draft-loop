import { describe, expect, it } from "vitest";

import { retriesAutomatically } from "./automatic-retry.js";
import type { RunSnapshot } from "./index.js";

const failed = (code: string, retryable: boolean, state = "provider-error") =>
  ({ state, lastError: { code, retryable } }) as unknown as RunSnapshot;

describe("automatic retry", () => {
  it.each(["rate-limit", "timeout", "transient", "invalid-response"])(
    "retries a retryable %s without the person",
    (code) => {
      expect(retriesAutomatically(failed(code, true))).toBe(true);
    },
  );

  it("leaves a failure with no attempts left, a credential or a credit failure to the person", () => {
    expect(retriesAutomatically(failed("invalid-response", false))).toBe(false);
    expect(retriesAutomatically(failed("authentication", true))).toBe(false);
    expect(retriesAutomatically(failed("quota-exhausted", false))).toBe(false);
    expect(retriesAutomatically(failed("timeout", true, "paused"))).toBe(false);
  });
});
