import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCli } from "./index.js";
import { uploadName } from "./server-import-commands.js";
import { createCandidateKnowledgeStoreService } from "./workflow.js";

interface StubSource {
  readonly name: string;
  readonly mediaType: string;
  readonly checksum: string;
}

/** A fake DraftLoop API with the three knowledge routes the import calls. */
function stubServer(token: string) {
  const bases: { id: string; displayName: string; description: string; workspaceId?: string }[] =
    [];
  const sources = new Map<string, StubSource[]>();
  const requests: string[] = [];
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    requests.push(`${init.method} ${url.pathname}`);
    const headers = init.headers as Record<string, string>;
    if (headers.authorization !== `Bearer ${token}`) {
      return Response.json({ error: { code: "unauthorized", message: "No." } }, { status: 401 });
    }
    if (url.pathname === "/v1/knowledge-bases" && init.method === "GET") {
      return Response.json({ knowledgeBases: bases });
    }
    if (url.pathname === "/v1/knowledge-bases" && init.method === "POST") {
      const body = JSON.parse(String(init.body)) as (typeof bases)[number];
      const base = { ...body, id: `kb-${bases.length + 1}` };
      bases.push(base);
      return Response.json(base, { status: 201 });
    }
    const match = /^\/v1\/knowledge-bases\/([^/]+)\/sources$/u.exec(url.pathname);
    if (match !== null && init.method === "POST") {
      const bytes = new Uint8Array(await (init.body as Blob).arrayBuffer());
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const list = sources.get(match[1] ?? "") ?? [];
      sources.set(match[1] ?? "", list);
      const existing = list.find((source) => source.checksum === checksum);
      if (existing !== undefined) return Response.json({ id: existing.name }, { status: 200 });
      const name = url.searchParams.get("name") ?? "";
      list.push({ name, mediaType: headers["content-type"] ?? "", checksum });
      const verdict = name.includes("flag") ? "flagged" : "clear";
      return Response.json(
        { id: name, screening: { resultId: "r", verdict, signals: [] } },
        { status: 201 },
      );
    }
    return Response.json({ error: { code: "not_found", message: "No route." } }, { status: 404 });
  };
  return { bases, sources, requests, fetch };
}

describe("server import", () => {
  let parent: string;

  beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), "draft-loop-server-import-cli-"));
  });

  afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
  });

  async function fictionalBackup(): Promise<string> {
    const service = createCandidateKnowledgeStoreService();
    const storeRoot = join(parent, "store");
    const store = await service.initializeStore({ storeRoot });
    const knowledgeBaseId = store.knowledgeBases[0]?.id ?? "";
    for (const [name, text] of [
      ["cv.md", "# Sam Sample\n\nRan a fictional data team at Example Co.\n"],
      ["flag-notes.txt", "Fictional notes the stub flags.\n"],
    ] as const) {
      const sourcePath = join(parent, name);
      await writeFile(sourcePath, text);
      await service.importKnowledgeSourceFile({ storeRoot, knowledgeBaseId, sourcePath });
    }
    const destination = join(parent, "backup");
    await service.exportCandidateKnowledgeStore({ storeRoot, destination, approved: true });
    return destination;
  }

  function cli(server: ReturnType<typeof stubServer>, environment: Record<string, string> = {}) {
    const lines: string[] = [];
    const program = createCli({
      io: { write: (line: string) => lines.push(line) },
      serverImport: { fetch: server.fetch, environment },
    });
    program.exitOverride();
    const run = (...args: string[]) => program.parseAsync(["node", "draft-loop", ...args]);
    return { lines, run };
  }

  it("prints the counts and sends nothing without --approve", async () => {
    const backup = await fictionalBackup();
    const server = stubServer("owner-token");
    const { lines, run } = cli(server);

    await run("server", "import", backup);

    expect(lines.join("\n")).toContain("2 sources in 1 knowledge base to import.");
    expect(lines.join("\n")).toContain("Nothing was sent");
    expect(server.requests).toEqual([]);
  });

  it("uploads each source through the upload route and resumes on a rerun", async () => {
    const backup = await fictionalBackup();
    const server = stubServer("owner-token");
    const tokenFile = join(parent, "token");
    await writeFile(tokenFile, "owner-token\n");

    const first = cli(server);
    await first.run(
      "server",
      "import",
      backup,
      "--approve",
      "--token-file",
      tokenFile,
      "--server",
      "http://127.0.0.1:58090",
    );

    expect(server.bases).toHaveLength(1);
    expect(server.bases[0]?.displayName).toBe("Career evidence");
    const uploaded = server.sources.get("kb-1") ?? [];
    expect(uploaded.map(({ name, mediaType }) => ({ name, mediaType }))).toEqual(
      expect.arrayContaining([
        { name: "cv.md", mediaType: "text/markdown" },
        { name: "flag-notes.txt", mediaType: "text/plain" },
      ]),
    );
    expect(first.lines.join("\n")).toContain("2 sources in 1 knowledge base imported.");
    expect(first.lines.join("\n")).toContain("1 were quarantined by screening");

    const second = cli(server, { DRAFT_LOOP_SERVER_TOKEN: "owner-token" });
    await second.run("server", "import", backup, "--approve", "--json");

    expect(server.bases).toHaveLength(1);
    expect(server.sources.get("kb-1")).toHaveLength(2);
    expect(JSON.parse(second.lines.join("\n"))).toMatchObject({
      status: "imported",
      evidence: { sources: 2, alreadyOnServer: 2 },
    });
  });

  it("asks for a token before sending and reports a refused one", async () => {
    const backup = await fictionalBackup();
    const server = stubServer("owner-token");

    await expect(cli(server).run("server", "import", backup, "--approve")).rejects.toThrow(
      /No server token/u,
    );
    await expect(
      cli(server, { DRAFT_LOOP_SERVER_TOKEN: "wrong" }).run(
        "server",
        "import",
        backup,
        "--approve",
      ),
    ).rejects.toThrow(/refused the token \(401\)/u);
  });

  it("reports a server it cannot reach", async () => {
    const backup = await fictionalBackup();
    const { run } = cli(
      {
        ...stubServer("owner-token"),
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
      { DRAFT_LOOP_SERVER_TOKEN: "owner-token" },
    );

    await expect(run("server", "import", backup, "--approve")).rejects.toThrow(
      /could not be reached/u,
    );
  });

  it("turns a source name into a file name the upload route takes", () => {
    expect(uploadName("notes/2024\\talks.md")).toBe("notes-2024-talks.md");
    expect(uploadName("   ")).toBe("source");
  });
});
