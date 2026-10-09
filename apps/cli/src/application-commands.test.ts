import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCli } from "./index.js";
import {
  type ApplicationService,
  CliUserError,
  createApplicationService,
  createLocalApplicationDriver,
} from "./workflow.js";

describe("application CLI", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function setup() {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-application-cli-"));
    directories.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(
      join(root, "job.md"),
      "# Synthetic Platform Engineer\n\nBuild tools.\n",
      "utf8",
    );
    await writeFile(
      join(root, "evidence", "resume.md"),
      "Built local-first TypeScript tools with deterministic testing.\n",
      "utf8",
    );
    const service = createApplicationService(createLocalApplicationDriver());
    await service.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      { write: () => undefined },
    );
    const lines: string[] = [];
    const cli = createCli({ service, io: { write: (line: string) => lines.push(line) } });
    cli.exitOverride();
    const run = (...args: string[]) => cli.parseAsync(["node", "draft-loop", ...args]);
    return { root, service, lines, run };
  }

  it("lists the default application of a legacy workspace", async () => {
    const { root, lines, run } = await setup();

    await run("application", "list", root);

    expect(lines).toEqual([
      "applications: 1",
      "default  Synthetic Platform Engineer  [drafting]  runs=0 briefs=0 exports=0",
    ]);
  });

  it("creates an application from pasted text and then from a job file", async () => {
    const { root, lines, run } = await setup();
    const jobFile = join(root, "acme.md");
    await writeFile(jobFile, "Acme needs a staff engineer.\n", "utf8");

    await run(
      "application",
      "create",
      root,
      "--name",
      " Beta — Designer ",
      "--job-text",
      "A designer role.",
    );
    await run(
      "application",
      "create",
      root,
      "--name",
      "Acme — Engineer",
      "--job-file",
      jobFile,
      "--json",
    );

    expect(lines[0]).toBe("application created:");
    expect(lines[1]).toMatch(/^app-[0-9a-f]{12} {2}Beta — Designer {2}\[drafting\] {2}runs=0/u);
    expect(lines[2]).toMatch(/^Start a run with: draft-loop start .+ --application app-/u);
    const json = JSON.parse(lines[3] ?? "");
    expect(json).toMatchObject({
      name: "Acme — Engineer",
      jobSource: { kind: "local-file", path: resolve(jobFile) },
    });

    lines.length = 0;
    await run("application", "list", root, "--json");
    expect(JSON.parse(lines[0] ?? "").map((item: { name: string }) => item.name)).toEqual([
      "Synthetic Platform Engineer",
      "Beta — Designer",
      "Acme — Engineer",
    ]);
  });

  it("requires exactly one job source and a valid name", async () => {
    const { root, run } = await setup();

    await expect(run("application", "create", root, "--name", "A")).rejects.toBeInstanceOf(
      CliUserError,
    );
    await expect(
      run("application", "create", root, "--name", "A", "--job-text", "x", "--job-file", "y"),
    ).rejects.toBeInstanceOf(CliUserError);
    await expect(
      run("application", "create", root, "--name", "  ", "--job-text", "x"),
    ).rejects.toBeInstanceOf(CliUserError);
  });

  it("starts a run for an application and binds it", async () => {
    const { root, lines, run } = await setup();
    await run("application", "create", root, "--name", "Beta", "--job-text", "Design interfaces.");
    const id = /^app-[0-9a-f]{12}/u.exec(lines[1] ?? "")?.[0] ?? "";

    await run("start", root, "--application", id);

    lines.length = 0;
    await run("application", "list", root, "--json");
    const [defaultApplication, application] = JSON.parse(lines[0] ?? "");
    expect(defaultApplication.runs).toHaveLength(0);
    expect(application).toMatchObject({ id, status: "in-review" });
    expect(application.runs).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(root, ".draft-loop", "workspace.json"), "utf8"))
        .jobDescriptionPath,
    ).toBe("job.md");
  });

  it("archives, restores and deletes an application", async () => {
    const { root, lines, run } = await setup();
    await run("application", "create", root, "--name", "Beta", "--job-text", "Design interfaces.");
    const id = /^app-[0-9a-f]{12}/u.exec(lines[1] ?? "")?.[0] ?? "";

    lines.length = 0;
    await run("application", "archive", id, root);
    await run("application", "list", root);
    expect(lines[0]).toBe("application archived:");
    expect(lines[1]).toMatch(/ {2}\(archived\)$/u);
    expect(lines.at(-1)).toMatch(/^app-.+ {2}\(archived\)$/u);

    lines.length = 0;
    await run("application", "restore", id, root);
    expect(lines[0]).toBe("application restored:");
    expect(lines[1]).not.toContain("(archived)");

    lines.length = 0;
    await run("application", "delete", id, root);
    await run("application", "list", root);
    expect(lines).toEqual([
      `application deleted: ${id}`,
      "applications: 1",
      "default  Synthetic Platform Engineer  [drafting]  runs=0 briefs=0 exports=0",
    ]);
    await expect(run("application", "delete", "default", root)).rejects.toBeInstanceOf(
      CliUserError,
    );
  });

  it("passes --application to the service and omits it by default", async () => {
    const start = vi.fn(async (_command: Record<string, unknown>) => ({}) as never);
    const cli = createCli({
      service: { start } as unknown as ApplicationService,
      io: { write: () => undefined },
    });
    cli.exitOverride();

    await cli.parseAsync(["node", "draft-loop", "start", "ws", "--application", "app-1"]);
    await cli.parseAsync(["node", "draft-loop", "start", "ws"]);

    expect(start).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ root: resolve("ws"), applicationId: "app-1" }),
    );
    expect(start.mock.calls[1]?.[0]).not.toHaveProperty("applicationId");
  });

  it("creates an opportunity brief bound to an application", async () => {
    const { root, lines, run } = await setup();
    await run("application", "create", root, "--name", "Beta", "--job-text", "Design interfaces.");
    const id = /^app-[0-9a-f]{12}/u.exec(lines[1] ?? "")?.[0] ?? "";
    const input = join(root, "opportunity.json");
    await writeFile(
      input,
      JSON.stringify({
        id: "beta-brief",
        sources: [
          {
            id: "guidance",
            kind: "candidate-input",
            classification: "candidate-instruction",
            content: "Use a direct tone.",
          },
        ],
      }),
      "utf8",
    );

    await run("opportunity", "create", root, "--input", input, "--application", id);

    lines.length = 0;
    await run("application", "list", root, "--json");
    const [defaultApplication, application] = JSON.parse(lines[0] ?? "");
    expect(defaultApplication.briefs).toHaveLength(0);
    expect(application.briefs).toHaveLength(1);
    expect(application.briefs[0]).toMatchObject({ briefId: "beta-brief" });
  });

  it("passes --application to opportunity create and omits it by default", async () => {
    const createOpportunity = vi.fn(async (_command: Record<string, unknown>) => ({}) as never);
    const root = await mkdtemp(join(tmpdir(), "draft-loop-application-cli-"));
    directories.push(root);
    const input = join(root, "opportunity.json");
    await writeFile(input, JSON.stringify({ id: "brief-1", sources: [] }), "utf8");
    const cli = createCli({
      service: { createOpportunity } as unknown as ApplicationService,
      io: { write: () => undefined },
    });
    cli.exitOverride();

    await cli.parseAsync(["node", "dl", "opportunity", "create", "ws", "--input", input]);
    await cli.parseAsync([
      "node",
      "dl",
      "opportunity",
      "create",
      "ws",
      "--input",
      input,
      "--application",
      "app-1",
    ]);

    expect(createOpportunity.mock.calls[0]?.[0]).not.toHaveProperty("applicationId");
    expect(createOpportunity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "brief-1", applicationId: "app-1" }),
    );
  });

  it("imports another workspace as an application and refuses it twice", async () => {
    const target = await setup();
    const source = await setup();
    await source.service.start(
      { root: source.root, allowProviderData: false },
      { write: () => undefined },
    );
    const before = await readFile(join(source.root, ".draft-loop", "history.sqlite"));

    await target.run("application", "import", target.root, "--from", source.root);

    expect(target.lines[0]).toBe("application imported:");
    expect(target.lines[1]).toMatch(
      /^imported-[0-9a-f]{12} {2}Synthetic Platform Engineer {2}\[in-review\] {2}runs=1 briefs=0 exports=0/u,
    );
    expect(target.lines[2]).toBe(
      "Copied 1 runs, 0 brief versions and 0 exports; the source workspace was not changed.",
    );
    expect(await readFile(join(source.root, ".draft-loop", "history.sqlite"))).toEqual(before);

    await expect(
      target.run("application", "import", target.root, "--from", source.root),
    ).rejects.toThrow(/already imported/u);
    await expect(
      target.run("application", "import", target.root, "--from", target.root),
    ).rejects.toThrow(/cannot be imported into itself/u);
  });

  it("imports with a custom name and prints JSON", async () => {
    const target = await setup();
    const source = await setup();

    await target.run(
      "application",
      "import",
      target.root,
      "--from",
      source.root,
      "--name",
      "Hc4 — Platform",
      "--json",
    );

    expect(JSON.parse(target.lines[0] ?? "")).toMatchObject({
      application: { name: "Hc4 — Platform", status: "drafting" },
      counts: { runs: 0, briefs: 0, briefVersions: 0, exports: 0, skippedExports: 0 },
    });
  });
});
