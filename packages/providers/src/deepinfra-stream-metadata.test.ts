import { describe, expect, it } from "vitest";
import { isCompatibleDeepInfraStreamTimestamp } from "./deepinfra-stream-metadata.js";

describe("DeepInfra optional stream timestamp metadata", () => {
  it.each([0, 1, 42.5, Number.MAX_SAFE_INTEGER])(
    "accepts finite nonnegative timestamp %s",
    (value) => {
      expect(isCompatibleDeepInfraStreamTimestamp(value)).toBe(true);
    },
  );

  it.each([
    undefined,
    null,
    "42",
    {},
    [],
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid timestamp metadata %s", (value) => {
    expect(isCompatibleDeepInfraStreamTimestamp(value)).toBe(false);
  });
});
