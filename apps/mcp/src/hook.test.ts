import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runStopHook, stopHookAdvice, turnNeedsAdvice } from "./hook.js";

const person = (text: string) => ({ type: "user", message: { content: text } });
const toolResult = { type: "user", message: { content: [{ type: "tool_result" }] } };
const bash = (command: string) => ({
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] },
});
const recordWork = {
  type: "assistant",
  message: { content: [{ type: "tool_use", name: "mcp__draftloop__record_work", input: {} }] },
};
const lines = (...entries: unknown[]) => entries.map((entry) => JSON.stringify(entry)).join("\n");

describe("turnNeedsAdvice", () => {
  it.each(["git push origin main", "gh pr merge 12 --squash", "git merge feature"])(
    "advises after %s",
    (command) => {
      expect(turnNeedsAdvice(lines(person("ship it"), bash(command)))).toBe(true);
    },
  );

  it("reads only the last turn the person typed, not tool results", () => {
    const earlier = lines(person("push it"), bash("git push"), person("now just run tests"));
    expect(turnNeedsAdvice(`${earlier}\n${lines(bash("pnpm test"))}`)).toBe(false);
    // A tool result is a user entry, but not the person: the push stays in the same turn.
    expect(turnNeedsAdvice(lines(person("push it"), bash("git push"), toolResult))).toBe(true);
  });

  it("treats a person's text block as a new turn", () => {
    const textTurn = { type: "user", message: { content: [{ type: "text", text: "hi" }] } };
    expect(turnNeedsAdvice(lines(bash("git push"), textTurn, bash("ls")))).toBe(false);
  });

  it("skips blank and malformed lines and odd entries", () => {
    const transcript = [
      "",
      "{not json",
      JSON.stringify(person("go")),
      JSON.stringify({ type: "assistant", message: { content: "plain text" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use" }] } }),
      JSON.stringify(bash("git push")),
    ].join("\n");
    expect(turnNeedsAdvice(transcript)).toBe(true);
  });

  it("does not match lookalike commands", () => {
    expect(turnNeedsAdvice(lines(person("go"), bash("git pushd; echo merged")))).toBe(false);
  });
});

describe("runStopHook", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draftloop-mcp-hook-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("prints the advice as a system message for a turn that shipped without recording", async () => {
    const transcriptPath = join(root, "transcript.jsonl");
    await writeFile(transcriptPath, lines(person("merge it"), bash("gh pr merge 3")));

    const output = await runStopHook(JSON.stringify({ transcript_path: transcriptPath }));

    expect(JSON.parse(output)).toEqual({ systemMessage: stopHookAdvice });
  });

  it("prints nothing when the turn recorded the work", async () => {
    const transcriptPath = join(root, "transcript.jsonl");
    await writeFile(transcriptPath, lines(person("merge"), bash("git push"), recordWork));
    expect(await runStopHook(JSON.stringify({ transcript_path: transcriptPath }))).toBe("");
  });

  it.each([
    ["input that is not JSON", "nope"],
    ["no transcript path", JSON.stringify({})],
    ["a hook already active", JSON.stringify({ transcript_path: "/x", stop_hook_active: true })],
    ["a missing transcript", JSON.stringify({ transcript_path: "/no/such/transcript.jsonl" })],
  ])("prints nothing for %s", async (_name, input) => {
    expect(await runStopHook(input)).toBe("");
  });
});
