import { describe, expect, it } from "vitest";

import { unsupportedNumbers } from "./application-material.js";

describe("amounts in thousands (walk #5 of #2623)", () => {
  it("matches 55k to 55,000 or 55 000, and back", () => {
    expect(unsupportedNumbers("A median of 55k to 72k.", ["From 55,000 to 72 000 EUR."])).toEqual(
      [],
    );
    expect(unsupportedNumbers("Do not quote 45,000 to 80,000.", ["A weak 45k-80k range."])).toEqual(
      [],
    );
    expect(unsupportedNumbers("About 1,5k a month.", ["1 500 a month."])).toEqual([]);
  });

  it("still flags an amount no source states", () => {
    expect(unsupportedNumbers("A median of 60k.", ["From 55,000 to 72,000 EUR."])).toEqual(["60"]);
  });
});
