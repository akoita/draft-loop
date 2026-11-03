import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCli } from "./index.js";
import { createApplicationService, createLocalApplicationDriver } from "./workflow.js";

const silent = { write: () => undefined };

/** A fake server with a workspace route and the application import route. */
function stubServer(options: { readonly workspaceExists: boolean }) {
  const imported = new Map<string, { runs: unknown[]; name: string }>();
  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    const url = new URL(input);
    if (url.pathname === "/v1/workspaces/owner" && init.method === "GET") {
      return options.workspaceExists
        ? Response.json({ id: "owner" })
        : Response.json({ error: { code: "not_found", message: "No." } }, { status: 404 });
    }
    if (url.pathname === "/v1/workspaces/owner/application-imports" && init.method === "POST") {
      const bundle = JSON.parse(String(init.body)) as {
        sourceWorkspaceId: string;
        sourceApplicationId: string;
        name: string;
        runs: unknown[];
      };
      const key = `${bundle.sourceWorkspaceId}:${bundle.sourceApplicationId}`;
      const status = imported.has(key) ? "already-imported" : "imported";
      imported.set(key, { runs: bundle.runs, name: bundle.name });
      return Response.json({ status }, { status: status === "imported" ? 201 : 200 });
    }
    return Response.json({ error: { code: "not_found", message: "No route." } }, { status: 404 });
  };
  return { imported, fetch };
}

describe("server import of desktop workspaces", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  /** A fictional desktop workspace with one created application and one fixture run in it. */
  async function desktopWorkspace(): Promise<string> {
    const service = createApplicationService(createLocalApplicationDriver());
    const root = await mkdtemp(join(tmpdir(), "draft-loop-server-import-workspace-"));
    directories.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "# Fictional Analyst\n\nAnalyse data.\n", "utf8");
    await writeFile(
      join(root, "evidence", "resume.md"),
      "Analysed fictional datasets with reproducible notebooks.\n",
      "utf8",
    );
    await service.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    await service.createApplication({
      root,
      name: "Fictional Data Lead",
      jobSource: { kind: "pasted-text", text: "# Data Lead\n\nLead a fictional data team." },
    });
    await service.start({ root, allowProviderData: false }, silent);
    return root;
  }

  function cli(server: ReturnType<typeof stubServer>) {
    const lines: string[] = [];
    const program = createCli({
      io: { write: (line: string) => lines.push(line) },
      serverImport: { fetch: server.fetch, environment: { DRAFT_LOOP_SERVER_TOKEN: "token" } },
    });
    program.exitOverride();
    const run = (...args: string[]) => program.parseAsync(["node", "draft-loop", ...args]);
    return { lines, run };
  }

  it("previews, sends each application once, and answers a rerun as already imported", async () => {
    const root = await desktopWorkspace();
    const server = stubServer({ workspaceExists: true });

    const preview = cli(server);
    await preview.run("server", "import", "--workspace", root);
    expect(preview.lines.join("\n")).toContain(
      "2 applications with 1 run and 0 job briefs from 1 workspace to import.",
    );
    expect(server.imported.size).toBe(0);

    const first = cli(server);
    await first.run("server", "import", "--workspace", root, "--approve");
    expect(server.imported.size).toBe(2);
    expect([...server.imported.values()].map(({ name }) => name).sort()).toEqual([
      "Fictional Analyst",
      "Fictional Data Lead",
    ]);
    expect(first.lines.join("\n")).toContain("2 applications with 1 run");

    const second = cli(server);
    await second.run("server", "import", "--workspace", root, "--approve", "--json");
    expect(JSON.parse(second.lines.join("\n"))).toMatchObject({
      status: "imported",
      applications: { applications: 2, alreadyOnServer: 2 },
    });
  });

  it("asks for the server's setup when its workspace does not exist yet", async () => {
    const root = await desktopWorkspace();

    await expect(
      cli(stubServer({ workspaceExists: false })).run(
        "server",
        "import",
        "--workspace",
        root,
        "--approve",
      ),
    ).rejects.toThrow(/finish its setup/u);
  });

  it("needs a backup or a workspace", async () => {
    await expect(
      cli(stubServer({ workspaceExists: true })).run("server", "import"),
    ).rejects.toThrow(/Name a backup folder/u);
  });
});
