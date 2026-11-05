import { resolve } from "node:path";
import type {
  PreferenceSuggestion,
  PreferenceSuggestions,
} from "@draft-loop/application/preference-suggestions";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

import { registerPreferenceCommands } from "./preference-commands.js";
import type { ApplicationService } from "./workflow.js";

const id = "preference-0123456789abcdef";
const suggestion: PreferenceSuggestion = {
  id,
  kind: "forbidden-term",
  term: "passionate",
  occurrences: 3,
  applications: 2,
  reason: 'You removed "passionate" from 3 drafts across 2 applications.',
};

function run(args: string[], listed: PreferenceSuggestion[] = [suggestion]) {
  const lines: string[] = [];
  const suggestions: PreferenceSuggestions = {
    list: vi.fn(async () => listed),
    accept: vi.fn(async () => suggestion),
    dismiss: vi.fn(async () => undefined),
  };
  const program = new Command().exitOverride();
  registerPreferenceCommands(
    program,
    {} as ApplicationService,
    { write: (line: string) => lines.push(line) },
    suggestions,
  );
  return { done: program.parseAsync(["node", "draft-loop", ...args]), lines, suggestions };
}

describe("preferences commands", () => {
  it("lists suggestions with their reasons", async () => {
    const { done, lines, suggestions } = run(["preferences", "list", "ws"]);
    await done;
    expect(suggestions.list).toHaveBeenCalledWith(resolve("ws"));
    expect(lines).toEqual([
      `${id}: forbid the word "passionate"`,
      '  why: You removed "passionate" from 3 drafts across 2 applications.',
      'Accept one with "draft-loop preferences accept <workspace> <id>".',
    ]);
  });

  it("says when nothing is suggested, and prints JSON on request", async () => {
    const empty = run(["preferences", "list", "ws"], []);
    await empty.done;
    expect(empty.lines[0]).toMatch(/^No suggested preferences/u);
    const json = run(["preferences", "list", "ws", "--json"]);
    await json.done;
    expect(JSON.parse(json.lines[0] ?? "")).toEqual([suggestion]);
  });

  it("accepts and dismisses by id", async () => {
    const accepted = run(["preferences", "accept", "ws", id]);
    await accepted.done;
    expect(accepted.suggestions.accept).toHaveBeenCalledWith(resolve("ws"), id);
    expect(accepted.lines).toEqual([
      'Writing policy updated: forbid the word "passionate". New runs follow it.',
    ]);
    const dismissed = run(["preferences", "dismiss", "ws", id]);
    await dismissed.done;
    expect(dismissed.suggestions.dismiss).toHaveBeenCalledWith(resolve("ws"), id);
  });
});
