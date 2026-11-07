import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configFromEnvironment } from "./client.js";
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
      expect.stringContaining("Accept notes from coding agents"),
    ]);
    const mcp = JSON.parse(await readFile(join(root, ".mcp.json"), "utf8"));
    expect(mcp.mcpServers.other).toEqual({ command: "other-server" });
    expect(mcp.mcpServers.draftloop).toEqual({
      command: "draftloop-mcp",
      args: [],
      env: {
        DRAFT_LOOP_SERVER_URL: "${DRAFT_LOOP_SERVER_URL:-http://127.0.0.1:8080}",
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
        'env_vars = ["DRAFT_LOOP_SERVER_URL", "XDG_CONFIG_HOME"]',
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
      token: true,
    });
  });
});

describe("draftloop-mcp init's agent token", () => {
  let root: string;
  let tokenPath: string;
  const ownerToken = "owner-token-for-tests-0123456789abcdef";
  const agentToken = `dlagent_${"a".repeat(43)}`;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draftloop-mcp-token-"));
    tokenPath = join(root, "config", "draftloop", "agent-token");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("issues one with the owner token and saves it outside the project's files", async () => {
    const requests: { url: string; authorization: string | null; body: unknown }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      requests.push({
        url,
        authorization: new Headers(init.headers).get("authorization"),
        body: JSON.parse(String(init.body)),
      });
      return new Response(JSON.stringify({ id: "dlat_fixture0001", token: agentToken }), {
        status: 201,
      });
    }) as typeof fetch;

    const lines = await runInit(root, claude, {
      environment: { DRAFT_LOOP_SERVER_TOKEN: ownerToken },
      tokenPath,
      fetch: fetcher,
    });

    expect(requests).toEqual([
      {
        url: "http://127.0.0.1:8080/v1/workspaces/owner/agent-tokens",
        authorization: `Bearer ${ownerToken}`,
        body: { label: expect.stringMatching(/^claude-code in draftloop-mcp-token-/u) },
      },
    ]);
    expect(lines).toContain(`issued: agent token dlat_fixture0001, saved to ${tokenPath}`);
    expect((await readFile(tokenPath, "utf8")).trim()).toBe(agentToken);
    for (const path of [".mcp.json", "CLAUDE.md", ".claude/settings.json"]) {
      const written = await readFile(join(root, path), "utf8");
      expect(written).not.toContain(agentToken);
      expect(written).not.toContain(ownerToken);
    }

    // The MCP server then sends the agent token, even with the owner token still exported.
    const config = configFromEnvironment({ DRAFT_LOOP_SERVER_TOKEN: ownerToken }, tokenPath);
    expect(await config.token()).toBe(agentToken);
  });

  it.each([
    [true, false],
    [false, true],
  ])("with intake on=%s, names the intake switch: %s", async (enabled, named) => {
    const fetcher = (async (url: string) =>
      url.endsWith("/work-journal/intake")
        ? new Response(JSON.stringify({ enabled }), { status: 200 })
        : new Response(JSON.stringify({ id: "dlat_fixture0001", token: agentToken }), {
            status: 201,
          })) as typeof fetch;

    const lines = await runInit(root, claude, {
      environment: { DRAFT_LOOP_SERVER_TOKEN: ownerToken },
      tokenPath,
      fetch: fetcher,
    });

    expect(lines.some((line) => line.includes("Accept notes from coding agents"))).toBe(named);
  });

  it("keeps an older setup on the owner token working, and says how to issue one", async () => {
    const lines = await runInit(root, claude, { environment: {}, tokenPath });
    expect(lines).toContainEqual(expect.stringMatching(/^No agent token issued: set/u));

    const agentInEnvironment = await runInit(root, claude, {
      environment: { DRAFT_LOOP_SERVER_TOKEN: agentToken },
      tokenPath,
    });
    expect(agentInEnvironment).toContainEqual(expect.stringContaining("holds an agent token"));

    const config = configFromEnvironment({ DRAFT_LOOP_SERVER_TOKEN: ownerToken }, tokenPath);
    expect(await config.token()).toBe(ownerToken);
  });

  it("reports a server that issues no agent tokens, and skips with --no-token", async () => {
    const old = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    const lines = await runInit(root, claude, {
      environment: { DRAFT_LOOP_SERVER_TOKEN: ownerToken },
      tokenPath,
      fetch: old,
    });
    expect(lines).toContainEqual(expect.stringContaining("server-v0.15.0"));

    let called = false;
    const skipped = await runInit(
      root,
      { ...claude, token: false },
      {
        environment: { DRAFT_LOOP_SERVER_TOKEN: ownerToken },
        tokenPath,
        fetch: (async () => {
          called = true;
          return new Response("{}");
        }) as typeof fetch,
      },
    );
    expect(called).toBe(false);
    expect(skipped.some((entry) => entry.includes("agent token"))).toBe(false);
    expect(parseInitArguments(["--host", "codex", "--no-token"])).toMatchObject({ token: false });
  });

  it("asks for the scopes given with --scope, and refuses an unknown one", () => {
    expect(
      parseInitArguments([
        "--host",
        "claude-code",
        "--scope",
        "applications:read",
        "--scope",
        "jobs:write",
        "--scope",
        "jobs:write",
      ]),
    ).toMatchObject({ scopes: ["applications:read", "jobs:write"] });
    expect(parseInitArguments(["--host", "codex"])).not.toHaveProperty("scopes");
    expect(parseInitArguments(["--host", "codex", "--scope", "runs"])).toHaveProperty("problem");
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
