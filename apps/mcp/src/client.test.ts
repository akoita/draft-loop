import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  configFromEnvironment,
  createWorkJournalApi,
  defaultServerUrl,
  defaultServerWorkspace,
  WorkJournalApiError,
} from "./client.js";

describe("configFromEnvironment", () => {
  let root: string;
  let agentTokenPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "draftloop-mcp-client-"));
    agentTokenPath = join(root, "agent-token");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("defaults to the local server and the owner workspace", async () => {
    const config = configFromEnvironment({}, agentTokenPath);
    expect(config.baseUrl).toBe(defaultServerUrl);
    expect(config.workspaceId).toBe(defaultServerWorkspace);
    expect(await config.token()).toBeUndefined();
  });

  it("reads the address and workspace from the environment", () => {
    const config = configFromEnvironment(
      { DRAFT_LOOP_SERVER_URL: "https://draftloop.example", DRAFT_LOOP_SERVER_WORKSPACE: "w-1" },
      agentTokenPath,
    );
    expect(config).toMatchObject({ baseUrl: "https://draftloop.example", workspaceId: "w-1" });
  });

  it("prefers the token file, re-read on each call, over every other source", async () => {
    const tokenFile = join(root, "token-file");
    await writeFile(tokenFile, " first-token \n");
    await writeFile(agentTokenPath, "dlagent_saved\n");
    const config = configFromEnvironment(
      { DRAFT_LOOP_SERVER_TOKEN_FILE: tokenFile, DRAFT_LOOP_SERVER_TOKEN: "env-token" },
      agentTokenPath,
    );

    expect(await config.token()).toBe("first-token");
    await writeFile(tokenFile, "renewed-token\n");
    expect(await config.token()).toBe("renewed-token");
    await writeFile(tokenFile, "\n");
    expect(await config.token()).toBeUndefined();
  });

  it("is signed out when the token file is missing, without falling back", async () => {
    await writeFile(agentTokenPath, "dlagent_saved\n");
    const config = configFromEnvironment(
      { DRAFT_LOOP_SERVER_TOKEN_FILE: join(root, "missing"), DRAFT_LOOP_SERVER_TOKEN: "env" },
      agentTokenPath,
    );
    expect(await config.token()).toBeUndefined();
  });

  it("falls back from the saved agent token to the token in the environment", async () => {
    const environment = { DRAFT_LOOP_SERVER_TOKEN_FILE: "", DRAFT_LOOP_SERVER_TOKEN: " env " };
    expect(await configFromEnvironment(environment, agentTokenPath).token()).toBe("env");
    await writeFile(agentTokenPath, "dlagent_saved\n");
    expect(await configFromEnvironment(environment, agentTokenPath).token()).toBe("dlagent_saved");
    expect(
      await configFromEnvironment({ DRAFT_LOOP_SERVER_TOKEN: "  " }, join(root, "none")).token(),
    ).toBeUndefined();
  });
});

describe("createWorkJournalApi", () => {
  const requests: string[] = [];
  const api = (response: () => Response) =>
    createWorkJournalApi({
      baseUrl: "http://127.0.0.1:8080//",
      workspaceId: "team space",
      token: async () => "fixture-token",
      fetch: async (url) => {
        requests.push(String(url));
        return response();
      },
    });

  beforeEach(() => {
    requests.length = 0;
  });

  it("lists with only the filters that are set, and an encoded workspace", async () => {
    const notes = [{ note_id: "n1", title: "Fixture note", status: "pending" }];
    const client = api(() => new Response(JSON.stringify({ notes })));

    expect(await client.list({ project: "fixture", status: "pending", since: undefined })).toEqual(
      notes,
    );
    await client.list({});
    expect(requests).toEqual([
      "http://127.0.0.1:8080/v1/workspaces/team%20space/work-journal/notes?project=fixture&status=pending",
      "http://127.0.0.1:8080/v1/workspaces/team%20space/work-journal/notes",
    ]);
  });

  it("reads a list body without notes as empty", async () => {
    expect(await api(() => new Response("{}")).list({ limit: 1 })).toEqual([]);
  });

  it("names the HTTP status when a refusal has no readable body", async () => {
    const refusal = api(() => new Response("<html>", { status: 503 })).list({});
    await expect(refusal).rejects.toBeInstanceOf(WorkJournalApiError);
    await expect(api(() => new Response("<html>", { status: 503 })).list({})).rejects.toMatchObject(
      { code: "http_503", message: "The DraftLoop server refused the call.", fields: [] },
    );
  });

  it("keeps only string issue paths from a refusal", async () => {
    const body = {
      error: {
        code: "invalid_note",
        message: "Fix the note.",
        issues: [{ path: 3 }, {}, { path: "title" }],
      },
    };
    await expect(
      api(() => new Response(JSON.stringify(body), { status: 422 })).record({}),
    ).rejects.toMatchObject({ code: "invalid_note", fields: ["title"] });
  });

  it("sends no idempotency key when none is given", async () => {
    let headers: HeadersInit | undefined;
    const client = createWorkJournalApi({
      baseUrl: "http://127.0.0.1:8080",
      workspaceId: "owner",
      token: async () => "fixture-token",
      fetch: async (_url, init) => {
        headers = init?.headers;
        return new Response(JSON.stringify({ status: "pending", possible_duplicate_of: [] }));
      },
    });
    await client.record({ title: "x" });
    expect(headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer fixture-token",
    });
  });
});
