import { describe, expect, it } from "vitest";

import { coverJoiningGaps } from "./joining-words.js";

function mask(pattern: string): boolean[] {
  return [...pattern].map((flag) => flag === "x");
}

describe("joining-word gaps", () => {
  it.each(["who", "which", "that", "while", "where", "with", "including"])(
    "covers a bounded '%s' gap",
    (word) => {
      expect(coverJoiningGaps(["a", word, "b"], mask("x.x"))).toEqual(mask("xxx"));
    },
  );

  it("covers a bounded 'as well as' gap as one phrase", () => {
    expect(coverJoiningGaps(["a", "as", "well", "as", "b"], mask("x...x"))).toEqual(mask("xxxxx"));
  });

  it("covers joining phrases separated by 'and'", () => {
    expect(coverJoiningGaps(["a", "with", "and", "including", "b"], mask("x...x"))).toEqual(
      mask("xxxxx"),
    );
  });

  it("leaves a gap containing any other word uncovered as a whole", () => {
    expect(coverJoiningGaps(["a", "who", "led", "b"], mask("x..x"))).toEqual(mask("x..x"));
    expect(coverJoiningGaps(["a", "as", "well", "b"], mask("x..x"))).toEqual(mask("x..x"));
  });

  it("leaves a joining word at the block start or end uncovered", () => {
    expect(coverJoiningGaps(["who", "a"], mask(".x"))).toEqual(mask(".x"));
    expect(coverJoiningGaps(["a", "while"], mask("x."))).toEqual(mask("x."));
    expect(coverJoiningGaps(["a", "and", "while"], mask("x.."))).toEqual(mask("x.."));
  });

  it("does not change 'and'-only gaps, which the caller already exempts", () => {
    expect(coverJoiningGaps(["a", "and", "b"], mask("x.x"))).toEqual(mask("x.x"));
  });
});
