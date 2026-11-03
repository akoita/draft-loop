import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stopHookAdvice, turnNeedsAdvice } from "./hook.js";
import {
  instructionsSnippet,
  logWorkSkill,
  parseInitArguments,
  planInit,
  runInit,
} from "./init.js";

const claude = {
  host: "claude-code",
  command: "draftloop-mcp",
  hook: true,
  dryRun: false,
} as const;

describe("draftloop-mcp init", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draftloop-mcp-init-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("sets up Claude Code with the server, snippet, skill and opt-in hook", async () => {
    await writeFile(
      join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "other-server" } } }),
    );
    await writeFile(join(root, "CLAUDE.md"), "# Fernhill bookings\n\nUse pnpm.\n");

    expect(await runInit(root, claude)).toEqual([
      "updated: .mcp.json",
      "updated: CLAUDE.md",
      "created: .claude/skills/log-work/SKILL.md",
      "created: .claude/settings.json",
      expect.stringContaining("DRAFT_LOOP_SERVER_TOKEN"),
    ]);
    const mcp = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.other).toEqual({ command: "other-server" });
    expect(mcp.mcpServers.draftloop).toEqual({
      command: "draftloop-mcp",
      args: [],
      env: {
        DRAFT_LOOP_SERVER_URL: "${DRAFT_LOOP_SERVER_URL:-http://127.0.0.1:8080}",
        DRAFT_LOOP_SERVER_TOKEN: "${DRAFT_LOOP_SERVER_TOKEN:-}",
      },
    });
    const instructions = await readFile(join(root, "CLAUDE.md"), "utf8");
    expect(instructions).toBe(`# Fernhill bookings\n\nUse pnpm.\n\n${instructionsSnippet}\n`);
    const settings = JSON.parse(await readFile(join(root, ".claude/settings.json"), "utf8"));
    expect(settings.hooks.Stop).toEqual([
      { hooks: [{ type: "command", command: "draftloop-mcp hook stop" }] },
    ]);

    // A second run changes nothing and adds no second snippet or hook.
    const again = await runInit(root, claude);
    expect(again.slice(0, 4).every((line) => line.startsWith("unchanged:"))).toBe(true);
  });

  it("sets up Codex with a marked config block and the skill under .agents", () => {
    const files = planInit({ host: "codex", command: "draftloop-mcp", hook: false }, (path) =>
      path === ".codex/config.toml" ? 'model = "fixture"\n' : undefined,
    );
    expect(files.map((file) => file.path)).toEqual([
      ".codex/config.toml",
      "AGENTS.md",
      ".agents/skills/log-work/SKILL.md",
    ]);
    expect(files[0]?.content).toBe(
      [
        'model = "fixture"',
        "",
        "# draftloop:work-journal",
        "[mcp_servers.draftloop]",
        'command = "draftloop-mcp"',
        "args = []",
        'env_vars = ["DRAFT_LOOP_SERVER_URL", "DRAFT_LOOP_SERVER_TOKEN"]',
        "# /draftloop:work-journal",
        "",
      ].join("\n"),
    );
  });

  it("writes no secret and no path of this machine", () => {
    const files = planInit({ ...claude }, () => undefined);
    const written = files.map((file) => file.content).join("\n");
    expect(written).not.toMatch(/\/home\/|\/Users\/|[A-Z]:\\|Bearer|-----BEGIN/u);
    expect(logWorkSkill).toContain("list_work");
    expect(instructionsSnippet.split("\n")).toHaveLength(8);
  });

  it("refuses an unknown host and a hook outside Claude Code", () => {
    expect(parseInitArguments(["--host", "editor"])).toHaveProperty("problem");
    expect(parseInitArguments(["--host", "codex", "--hook"])).toEqual({
      problem: "--hook is for Claude Code only; other hosts get the skill and snippet.",
    });
    expect(parseInitArguments(["--host", "generic", "--dry-run"])).toEqual({
      host: "generic",
      command: "draftloop-mcp",
      hook: false,
      dryRun: true,
    });
  });
});

function line(entry: unknown): string {
  return JSON.stringify(entry);
}

const person = line({ type: "user", message: { content: "Merge the checkout pull request." } });
const merge = line({
  type: "assistant",
  message: {
    content: [{ type: "tool_use", name: "Bash", input: { command: "gh pr merge 42 --squash" } }],
  },
});
const recorded = line({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "mcp__draftloop__record_work", input: {} }] },
});
const result = line({ type: "user", message: { content: [{ type: "tool_result" }] } });

describe("the Stop hook", () => {
  it("advises once when the turn merged without recording", () => {
    expect(turnNeedsAdvice([person, merge, result].join("\n"))).toBe(true);
    expect(stopHookAdvice).toContain("/log-work");
  });

  it("stays quiet when the turn recorded the work, or shipped nothing", () => {
    expect(turnNeedsAdvice([person, merge, result, recorded, result].join("\n"))).toBe(false);
    expect(turnNeedsAdvice([merge, result, person].join("\n"))).toBe(false);
  });
});
