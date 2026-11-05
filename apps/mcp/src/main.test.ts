import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { stopHookAdvice } from "./hook.js";

const bin = fileURLToPath(new URL("../bin/draftloop-mcp.mjs", import.meta.url));

interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the real command, as a host would start it. */
function run(args: string[], options: { cwd?: string; input?: string } = {}): Promise<Outcome> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [bin, ...args],
      {
        cwd: options.cwd,
        // No token and no server: the commands under test must not need either.
        env: { PATH: process.env.PATH ?? "", XDG_CONFIG_HOME: options.cwd ?? tmpdir() },
        timeout: 20_000,
      },
      (error, stdout, stderr) => {
        resolve({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
      },
    );
    child.stdin?.end(options.input ?? "");
  });
}

describe("the draftloop-mcp command", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draftloop-mcp-main-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prints its usage and exits 2 for an unknown command", async () => {
    const outcome = await run(["serve-http"], { cwd: root });
    expect(outcome.code).toBe(2);
    expect(outcome.stdout).toBe("");
    expect(outcome.stderr).toContain("draftloop-mcp init --host claude-code|codex|generic");
  });

  it("refuses init without a valid host and exits 2", async () => {
    const outcome = await run(["init", "--host", "unknown-agent"], { cwd: root });
    expect(outcome.code).toBe(2);
    expect(outcome.stderr).not.toBe("");
  });

  it("runs init in the current folder without a token", async () => {
    const outcome = await run(["init", "--host", "generic", "--no-token"], { cwd: root });
    expect(outcome.code).toBe(0);
    expect(outcome.stdout).toContain("created: AGENTS.md");
  });

  it("prints the stop hook's advice from standard input, and nothing for bad input", async () => {
    const transcriptPath = join(root, "transcript.jsonl");
    await writeFile(
      transcriptPath,
      [
        { type: "user", message: { content: "merge it" } },
        {
          type: "assistant",
          message: {
            content: [{ type: "tool_use", name: "Bash", input: { command: "git push" } }],
          },
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n"),
    );

    const advised = await run(["hook", "stop"], {
      cwd: root,
      input: JSON.stringify({ transcript_path: transcriptPath }),
    });
    expect(advised.code).toBe(0);
    expect(JSON.parse(advised.stdout)).toEqual({ systemMessage: stopHookAdvice });

    const quiet = await run(["hook", "stop"], { cwd: root, input: "not json" });
    expect(quiet).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});
