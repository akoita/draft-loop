import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  agentTokenLabel,
  defaultAgentTokenPath,
  isAgentToken,
  issueAgentToken,
  readAgentTokenFile,
  readIntakeEnabled,
  saveAgentToken,
} from "./agent-token.js";

const input = {
  baseUrl: "http://127.0.0.1:8080/",
  workspaceId: "owner",
  ownerToken: "owner-token-for-tests-0123456789abcdef",
  label: "claude-code in fixture-project",
};

const answering = (response: Response | Error) =>
  (async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;

describe("the agent token's path", () => {
  it("prefers XDG_CONFIG_HOME, then APPDATA on Windows, then ~/.config", () => {
    expect(defaultAgentTokenPath({ XDG_CONFIG_HOME: "/cfg" }, "linux", "/home/fixture")).toBe(
      join("/cfg", "draftloop", "agent-token"),
    );
    expect(defaultAgentTokenPath({ APPDATA: "/appdata" }, "win32", "/home/fixture")).toBe(
      join("/appdata", "draftloop", "agent-token"),
    );
    expect(defaultAgentTokenPath({ APPDATA: "/appdata" }, "linux", "/home/fixture")).toBe(
      join("/home/fixture", ".config", "draftloop", "agent-token"),
    );
    expect(
      defaultAgentTokenPath({ XDG_CONFIG_HOME: "", APPDATA: "" }, "win32", "/home/fixture"),
    ).toBe(join("/home/fixture", ".config", "draftloop", "agent-token"));
  });
});

describe("the agent token file", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draftloop-agent-token-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("is saved readable by this user only and read back trimmed", async () => {
    const path = join(root, "config", "draftloop", "agent-token");
    const token = `dlagent_${"b".repeat(43)}`;
    await saveAgentToken(path, token);

    expect(await readFile(path, "utf8")).toBe(`${token}\n`);
    expect(await readAgentTokenFile(path)).toBe(token);
    if (process.platform !== "win32") {
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    }
  });

  it("reads as undefined when missing or blank", async () => {
    expect(await readAgentTokenFile(join(root, "missing"))).toBeUndefined();
    const blank = join(root, "blank");
    await saveAgentToken(blank, "   ");
    expect(await readAgentTokenFile(blank)).toBeUndefined();
  });

  it("recognises the agent token prefix", () => {
    expect(isAgentToken(`dlagent_${"c".repeat(43)}`)).toBe(true);
    expect(isAgentToken(input.ownerToken)).toBe(false);
  });

  it("is labelled with the host and the project folder, at most 120 characters", () => {
    expect(agentTokenLabel("codex", "/work/fixture-project")).toBe("codex in fixture-project");
    expect(agentTokenLabel("codex", "/")).toBe("codex in a project");
    expect(agentTokenLabel("generic", `/work/${"p".repeat(200)}`)).toHaveLength(120);
  });
});

describe("issuing an agent token", () => {
  it("posts the label with the owner token and returns the issued token", async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const issued = await issueAgentToken({
      ...input,
      fetch: (async (url: string, init: RequestInit) => {
        request = { url, init };
        return new Response(JSON.stringify({ id: "dlat_fixture0001", token: "dlagent_x" }), {
          status: 201,
        });
      }) as typeof fetch,
    });

    expect(issued).toEqual({ id: "dlat_fixture0001", token: "dlagent_x" });
    expect(request?.url).toBe("http://127.0.0.1:8080/v1/workspaces/owner/agent-tokens");
    expect(request?.init.method).toBe("POST");
    expect(JSON.parse(String(request?.init.body))).toEqual({ label: input.label });
  });

  it.each([
    [new TypeError("fetch failed"), "did not answer"],
    [new Response("{}", { status: 401 }), "refused the owner token"],
    [new Response("{}", { status: 404 }), "server-v0.15.0 or later"],
    [new Response("{}", { status: 500 }), "(HTTP 500)"],
    [new Response("not json", { status: 201 }), "(HTTP 201)"],
    [new Response(JSON.stringify({ id: 7, token: "dlagent_x" }), { status: 201 }), "(HTTP 201)"],
  ])("explains a failure: %s", async (response, sentence) => {
    await expect(issueAgentToken({ ...input, fetch: answering(response) })).rejects.toThrow(
      sentence,
    );
  });
});

describe("reading the intake switch", () => {
  it("returns the server's answer with the owner token", async () => {
    let authorization: string | null = null;
    const enabled = await readIntakeEnabled({
      ...input,
      fetch: (async (url: string, init: RequestInit) => {
        expect(url).toBe("http://127.0.0.1:8080/v1/workspaces/owner/work-journal/intake");
        authorization = new Headers(init.headers).get("authorization");
        return new Response(JSON.stringify({ enabled: false }));
      }) as typeof fetch,
    });

    expect(enabled).toBe(false);
    expect(authorization).toBe(`Bearer ${input.ownerToken}`);
  });

  it.each([
    ["a refusal", new Response("{}", { status: 403 })],
    ["a body without the switch", new Response(JSON.stringify({ enabled: "yes" }))],
    ["a body that is not JSON", new Response("<html>")],
    ["an unreachable server", new TypeError("fetch failed")],
  ])("is undefined for %s", async (_name, response) => {
    expect(await readIntakeEnabled({ ...input, fetch: answering(response) })).toBeUndefined();
  });
});
