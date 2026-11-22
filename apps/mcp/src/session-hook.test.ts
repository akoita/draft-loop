import type { WorkJournalNoteListItem } from "@draft-loop/schemas/work-journal";
import { describe, expect, it, vi } from "vitest";

import {
  catchUpAdvice,
  catchUpContext,
  catchUpSince,
  runSessionStartHook,
  type SessionStartDependencies,
} from "./session-hook.js";

const now = new Date("2026-11-22T20:00:00Z");

function note(project: string, createdAt: string): WorkJournalNoteListItem {
  return {
    id: `wjn_${createdAt}`,
    title: "Card payments",
    period: { start: "2026-11-01" },
    project,
    technologies: [],
    category: "feature",
    status: "pending",
    kind: "note",
    created_at: createdAt,
  } as WorkJournalNoteListItem;
}

/** A git that answers like a repository at /repo with origin/main and `count` merges. */
function fakeGit(count: string, remoteHead = "origin/main"): SessionStartDependencies["git"] {
  return async (_cwd, args) => {
    const command = args.join(" ");
    if (command === "rev-parse --show-toplevel") return "/home/me/draft-loop";
    if (command.startsWith("symbolic-ref")) {
      if (remoteHead === "") throw new Error("no origin/HEAD");
      return remoteHead;
    }
    if (command === "rev-parse --verify --quiet main") return "abc";
    if (command.startsWith("rev-list --count")) return count;
    throw new Error(`unexpected git ${command}`);
  };
}

const input = (fields: Record<string, unknown>) =>
  JSON.stringify({ cwd: "/home/me/draft-loop/apps", source: "startup", ...fields });

describe("catchUpSince", () => {
  it("starts from the newest note of the same project, whatever its case", () => {
    const notes = [
      note("Draft-Loop", "2026-11-15T09:00:00Z"),
      note("draft-loop", "2026-11-18T09:00:00Z"),
      note("other", "2026-11-21T09:00:00Z"),
    ];
    expect(catchUpSince("draft-loop", notes, now)).toBe("2026-11-18");
  });

  it("looks back 14 days without a note for the project", () => {
    expect(catchUpSince("draft-loop", [note("other", "2026-11-21T09:00:00Z")], now)).toBe(
      "2026-11-08",
    );
  });

  it("never looks back more than 30 days", () => {
    expect(catchUpSince("draft-loop", [note("draft-loop", "2026-08-01T09:00:00Z")], now)).toBe(
      "2026-10-23",
    );
  });
});

describe("runSessionStartHook", () => {
  it("tells the agent how many merges are missing and the command to offer", async () => {
    const listWork = vi.fn(async () => [note("draft-loop", "2026-11-18T09:00:00Z")]);
    const output = await runSessionStartHook(input({}), "record", {
      git: fakeGit("4\n"),
      listWork,
      now: () => now,
    });

    expect(listWork).toHaveBeenCalledWith("draft-loop");
    expect(JSON.parse(output)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: catchUpContext(4, "origin/main", "draft-loop", "2026-11-18"),
      },
    });
    expect(catchUpContext(4, "origin/main", "draft-loop", "2026-11-18")).toContain(
      "/redakloop:log-work since 2026-11-18",
    );
  });

  it("falls back to a local main without origin/HEAD, and shows the person a line in advise mode", async () => {
    const output = await runSessionStartHook(input({}), "advise", {
      git: fakeGit("1", ""),
      listWork: async () => [],
      now: () => now,
    });
    expect(JSON.parse(output)).toEqual({ systemMessage: catchUpAdvice(1, "main", "2026-11-08") });
  });

  it.each([
    ["no merges since the newest note", input({}), "record", fakeGit("0")],
    ["off mode", input({}), "off", fakeGit("4")],
    ["a resumed session", input({ source: "resume" }), "record", fakeGit("4")],
    ["input that is not JSON", "nope", "record", fakeGit("4")],
    ["no working folder", JSON.stringify({ source: "startup" }), "record", fakeGit("4")],
    [
      "a folder outside git",
      input({}),
      "record",
      async () => {
        throw new Error("not a repository");
      },
    ],
  ] as const)("prints nothing for %s", async (_name, hookInput, mode, git) => {
    const output = await runSessionStartHook(hookInput, mode, {
      git,
      listWork: async () => [],
      now: () => now,
    });
    expect(output).toBe("");
  });

  it("prints nothing when the server refuses or cannot be reached", async () => {
    const output = await runSessionStartHook(input({}), "record", {
      git: fakeGit("4"),
      listWork: async () => {
        throw new Error("intake_disabled");
      },
      now: () => now,
    });
    expect(output).toBe("");
  });
});
