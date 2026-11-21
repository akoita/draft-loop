import { describe, expect, it } from "vitest";

import { PoolSizeError, readPoolSize } from "./pool-size.js";

describe("readPoolSize", () => {
  it("uses the runtime's fallback when unset or empty", () => {
    expect(readPoolSize({}, "DRAFT_LOOP_DATABASE_POOL_SIZE", 4)).toBe(4);
    expect(
      readPoolSize({ DRAFT_LOOP_DATABASE_POOL_SIZE: "" }, "DRAFT_LOOP_DATABASE_POOL_SIZE", 4),
    ).toBe(4);
  });

  it("reads a whole number of connections from 1 to 50", () => {
    expect(readPoolSize({ X: "1" }, "X", 4)).toBe(1);
    expect(readPoolSize({ X: "50" }, "X", 4)).toBe(50);
  });

  it.each(["0", "51", "2.5", "ten", "-3"])("refuses %j", (value) => {
    expect(() => readPoolSize({ X: value }, "X", 4)).toThrow(PoolSizeError);
  });
});
