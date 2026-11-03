import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createCli } from "./index.js";
import {
  createApplicationService,
  createCandidateKnowledgeStoreService,
  createLocalApplicationDriver,
} from "./workflow.js";

/**
 * Set by `pnpm self-hosted:test` once the installed stack is up; skipped otherwise. The smoke
 * imports a fictional desktop workspace and career evidence backup through the CLI, as a person
 * would, then reads the result back through the API.
 */
const apiUrl = process.env.DRAFT_LOOP_TEST_API_URL;
const token = process.env.DRAFT_LOOP_TEST_API_OWNER_TOKEN ?? "";
const silent = { write: () => undefined };

describe.runIf(apiUrl !== undefined)("desktop import into the self-hosted stack", () => {
  const suffix = randomUUID().slice(0, 8);
  const serverWorkspace = `import-${suffix}`;
  const directories: string[] = [];

  afterAll(async () => {
    await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  });

  const request = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  /** A fictional desktop workspace with a fixture run, and a backup of fictional career evidence. */
  async function desktop(): Promise<{ root: string; backup: string; runId: string }> {
    const parent = await mkdtemp(join(tmpdir(), "draft-loop-import-smoke-"));
    directories.push(parent);
    const root = join(parent, "workspace");
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "# Fictional Engineer\n\nBuild services.\n", "utf8");
    await writeFile(
      join(root, "evidence", "resume.md"),
      "Built fictional TypeScript services with deterministic testing.\n",
      "utf8",
    );
    const service = createApplicationService(createLocalApplicationDriver());
    await service.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    const started = await service.start({ root, allowProviderData: false }, silent);

    const knowledge = createCandidateKnowledgeStoreService();
    const storeRoot = join(parent, "candidate-knowledge");
    const store = await knowledge.initializeStore({ storeRoot });
    const cv = join(parent, "cv.md");
    await writeFile(cv, `# Experience ${suffix}\n\nRan a fictional data team.\n`, "utf8");
    await knowledge.importKnowledgeSourceFile({
      storeRoot,
      knowledgeBaseId: store.knowledgeBases[0]?.id ?? "",
      sourcePath: cv,
    });
    const backup = join(parent, "backup");
    await knowledge.exportCandidateKnowledgeStore({
      storeRoot,
      destination: backup,
      approved: true,
    });
    return { root, backup, runId: started.runId };
  }

  it("imports the evidence and the application, and the imported run opens for review", async () => {
    const { root, backup, runId } = await desktop();
    expect(
      (
        await request(`/v1/workspaces/${serverWorkspace}`, {
          method: "PUT",
          body: JSON.stringify({ fixtureMode: true }),
        })
      ).status,
    ).toBe(201);

    const lines: string[] = [];
    const cli = createCli({
      io: { write: (line: string) => lines.push(line) },
      serverImport: { environment: { DRAFT_LOOP_SERVER_TOKEN: token } },
    });
    cli.exitOverride();
    await cli.parseAsync([
      "node",
      "draft-loop",
      "server",
      "import",
      backup,
      "--workspace",
      root,
      "--server",
      apiUrl ?? "",
      "--server-workspace",
      serverWorkspace,
      "--approve",
      "--json",
    ]);

    expect(JSON.parse(lines.join("\n"))).toMatchObject({
      status: "imported",
      evidence: { sources: 1 },
      applications: { applications: 1, runs: 1 },
    });
    const applications = await request(`/v1/workspaces/${serverWorkspace}/applications`);
    const imported = (applications.body.applications as { runs: { id: string }[] }[]).find(
      (application) => application.runs.some((run) => run.id === runId),
    );
    expect(imported).toBeDefined();
    expect((await request(`/v1/workspaces/${serverWorkspace}/runs/${runId}/review`)).status).toBe(
      200,
    );
    const bases = await request("/v1/knowledge-bases");
    expect(JSON.stringify(bases.body)).toContain("Imported from the desktop app");
  });
});
