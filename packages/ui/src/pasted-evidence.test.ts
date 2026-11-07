import { describe, expect, it } from "vitest";

import { validateBridgeCommand } from "./bridge.js";
import {
  isPastedText,
  pastedSourceTitle,
  pastedTextMaxLength,
  pastedTextProblem,
} from "./pasted-evidence.js";

const now = new Date(2026, 10, 7, 17, 5);

describe("pasted career evidence", () => {
  it("takes text with something besides blanks, within the limit and without NUL", () => {
    expect(isPastedText("Led a migration.\n\tWrote the plan.")).toBe(true);
    expect(isPastedText(" \n ")).toBe(false);
    expect(isPastedText("a".repeat(pastedTextMaxLength + 1))).toBe(false);
    expect(isPastedText("before\u0000after")).toBe(false);
    expect(isPastedText(42)).toBe(false);
  });

  it("says why the text cannot be saved yet", () => {
    expect(pastedTextProblem("")).toBe("Paste or type some text first.");
    expect(pastedTextProblem("a".repeat(pastedTextMaxLength + 1))).toContain("too long");
    expect(pastedTextProblem("Some notes")).toBeUndefined();
  });

  it("makes the title safe for a file name, or names the paste by date and time", () => {
    expect(pastedSourceTitle("  Project: notes / 2023\n", now)).toBe("Project notes 2023");
    expect(pastedSourceTitle("x".repeat(300), now)).toHaveLength(120);
    expect(pastedSourceTitle(" ", now)).toBe("Pasted text 2026-11-07 17.05");
  });

  it("validates the bridge command: title on one line, text within the limit", () => {
    const input = { storeId: "store-1", knowledgeBaseId: "base-1", title: "Notes", text: "a\nb" };
    expect(validateBridgeCommand({ type: "knowledge.import-text", input })).toEqual({
      type: "knowledge.import-text",
      input,
    });
    for (const invalid of [
      { ...input, title: "two\nlines" },
      { ...input, text: "  " },
      { ...input, extra: true },
    ]) {
      expect(() =>
        validateBridgeCommand({ type: "knowledge.import-text", input: invalid }),
      ).toThrow();
    }
  });
});
