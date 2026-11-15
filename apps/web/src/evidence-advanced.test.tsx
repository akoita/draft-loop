import { describe, expect, it } from "vitest";

import { privateRulesNote } from "./evidence-advanced.js";

describe("the folded Advanced options line for private sections", () => {
  it("stays silent while every section can be used", () => {
    expect(privateRulesNote({})).toBeNull();
    expect(privateRulesNote({ "kb-1": 0 })).toBeNull();
  });

  it("counts the rules of every selected base", () => {
    expect(privateRulesNote({ "kb-1": 1 })).toBe("1 private-section rule");
    expect(privateRulesNote({ "kb-1": 1, "kb-2": 2 })).toBe("3 private-section rules");
  });
});
