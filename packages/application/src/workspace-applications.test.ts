import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { type ApplicationService, createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";

type Service = ApplicationService &
  Required<
    Pick<
      ApplicationService,
      "createApplication" | "listApplications" | "getApplication" | "setApplicationModels"
    >
  >;

const silent = { write: () => undefined };
const openRaw = createRequire(import.meta.url)("better-sqlite3") as new (
  path: string,
) => {
  readonly exec: (sql: string) => void;
  readonly close: () => void;
};

describe("workspace applications", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function workspace(): Promise<{ root: string; service: Service }> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-applications-"));
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
    const service = createApplicationService(createLocalApplicationDriver()) as Service;
    await service.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    return { root, service };
  }

  async function jobDescriptionOfRun(root: string, runId: string): Promise<string> {
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const run = await storage.getRun(runId);
      const context = await storage.getContextSnapshot(run?.contextSnapshotId ?? "");
      const payload = context?.payload as { jobDescription?: unknown } | undefined;
      return String(payload?.jobDescription);
    } finally {
      await storage.close();
    }
  }

  it("reads a legacy workspace as one default application holding its existing runs", async () => {
    const { root, service } = await workspace();
    const run = await service.start({ root, allowProviderData: false }, silent);

    // Reproduce a database written before applications existed: no application tables or
    // migration row, same runs.
    const legacy = new openRaw(join(root, ".draft-loop", "history.sqlite"));
    legacy.exec(`
      DROP TABLE application_run_bindings;
      DROP TABLE application_brief_bindings;
      DROP TABLE applications;
      DELETE FROM schema_migrations WHERE version = 30;
    `);
    legacy.close();

    const applications = await service.listApplications({ root });
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({
      id: "default",
      isDefault: true,
      name: "Synthetic Platform Engineer",
      jobSource: { kind: "local-file", path: "job.md" },
    });
    expect(applications[0]?.runs.map((item) => item.id)).toEqual([run.runId]);
    expect(applications[0]?.status).toBe("in-review");
    expect(await service.getApplication({ root, applicationId: "default" })).toMatchObject({
      id: "default",
    });
  });

  it("derives the default application on read without creating or changing anything", async () => {
    const { root, service } = await workspace();
    const configPath = join(root, ".draft-loop", "workspace.json");
    const before = await readFile(configPath, "utf8");

    const [only, ...rest] = await service.listApplications({ root });

    expect(rest).toEqual([]);
    expect(only).toMatchObject({ id: "default", status: "drafting", runs: [], briefs: [] });
    await expect(stat(join(root, ".draft-loop", "history.sqlite"))).rejects.toThrow();
    expect(await readFile(configPath, "utf8")).toBe(before);
  });

  it("names the default application generically when the job text has no heading", async () => {
    const { root, service } = await workspace();
    // A pasted careers page starts with navigation text rather than a heading.
    await writeFile(
      join(root, "job.md"),
      "Pricing Docs Sign in Products\nWe are hiring.\n",
      "utf8",
    );

    const [only] = await service.listApplications({ root });

    expect(only).toMatchObject({ id: "default", name: "Default application" });
  });

  it("creates, lists and gets applications from pasted text, a file and an approved URL", async () => {
    const { root, service } = await workspace();
    await writeFile(join(root, "acme.md"), "Acme needs a staff engineer.\n", "utf8");

    const pasted = await service.createApplication({
      root,
      name: "  Beta — Designer  ",
      jobSource: { kind: "pasted-text", text: "Beta needs a designer.\n" },
      createdAt: "2030-01-02T00:00:00.000Z",
    });
    const file = await service.createApplication({
      root,
      name: "Acme — Staff Engineer",
      jobSource: { kind: "local-file", path: "acme.md" },
      createdAt: "2030-01-03T00:00:00.000Z",
    });
    const url = await service.createApplication({
      root,
      name: "Gamma — Analyst",
      jobSource: { kind: "approved-url", url: "https://jobs.example.test/analyst", approved: true },
      createdAt: "2030-01-04T00:00:00.000Z",
    });

    expect(pasted).toMatchObject({ name: "Beta — Designer", status: "drafting", isDefault: false });
    expect(pasted.jobSource.kind).toBe("pasted-text");
    if (pasted.jobSource.kind !== "pasted-text") throw new Error("unexpected source");
    expect(await readFile(join(root, pasted.jobSource.storedPath), "utf8")).toBe(
      "Beta needs a designer.\n",
    );
    expect(file.jobSource).toEqual({ kind: "local-file", path: join(root, "acme.md") });
    expect(url.jobSource).toEqual({
      kind: "approved-url",
      url: "https://jobs.example.test/analyst",
      approved: true,
    });

    const listed = await service.listApplications({ root });
    expect(listed.map((item) => item.id)).toEqual(["default", pasted.id, file.id, url.id]);
    expect(await service.getApplication({ root, applicationId: file.id })).toMatchObject({
      name: "Acme — Staff Engineer",
    });
    expect(await service.getApplication({ root, applicationId: "missing" })).toBeUndefined();
  });

  it("refuses invalid names, unapproved URLs, empty or missing jobs and reserved ids", async () => {
    const { root, service } = await workspace();
    const text = { kind: "pasted-text" as const, text: "A job." };

    await expect(
      service.createApplication({ root, name: "   ", jobSource: text }),
    ).rejects.toBeInstanceOf(CliUserError);
    await expect(
      service.createApplication({ root, name: "x".repeat(121), jobSource: text }),
    ).rejects.toBeInstanceOf(CliUserError);
    await expect(
      service.createApplication({
        root,
        name: "Url",
        jobSource: { kind: "approved-url", url: "https://jobs.example.test/a", approved: false },
      }),
    ).rejects.toThrow(/approval/u);
    await expect(
      service.createApplication({
        root,
        name: "Url",
        jobSource: { kind: "approved-url", url: "file:///etc/passwd", approved: true },
      }),
    ).rejects.toThrow(/http/u);
    await expect(
      service.createApplication({
        root,
        name: "Empty",
        jobSource: { kind: "pasted-text", text: " \n" },
      }),
    ).rejects.toThrow(/empty/u);
    await expect(
      service.createApplication({
        root,
        name: "Missing",
        jobSource: { kind: "local-file", path: "nope.md" },
      }),
    ).rejects.toThrow(/does not exist/u);
    await expect(
      service.createApplication({ root, name: "Reserved", jobSource: text, id: "default" }),
    ).rejects.toBeInstanceOf(CliUserError);
    await service.createApplication({ root, name: "One", jobSource: text, id: "app-one" });
    await expect(
      service.createApplication({ root, name: "Two", jobSource: text, id: "app-one" }),
    ).rejects.toThrow(/already exists/u);
    expect(await service.listApplications({ root })).toHaveLength(2);
  });

  it("archives and restores applications, the default one included, without changing them", async () => {
    const { root, service } = await workspace();
    const created = await service.createApplication({
      root,
      name: "Acme — Engineer",
      jobSource: { kind: "pasted-text", text: "Acme needs an engineer.\n" },
    });
    expect(created.archivedAt).toBeNull();

    const archived = await service.archiveApplication?.({
      root,
      applicationId: created.id,
      archived: true,
    });
    const archivedDefault = await service.archiveApplication?.({
      root,
      applicationId: "default",
      archived: true,
    });

    expect(archived).toMatchObject({ id: created.id, name: created.name });
    expect(archived?.archivedAt).toEqual(expect.any(String));
    expect(archivedDefault?.archivedAt).toEqual(expect.any(String));
    expect(
      (await service.listApplications({ root })).map((item) => [item.id, item.archivedAt]),
    ).toEqual([
      ["default", archivedDefault?.archivedAt],
      [created.id, archived?.archivedAt],
    ]);

    const restored = await service.archiveApplication?.({
      root,
      applicationId: created.id,
      archived: false,
    });
    expect(restored?.archivedAt).toBeNull();
    await expect(
      service.archiveApplication?.({ root, applicationId: "missing", archived: true }),
    ).rejects.toThrow(CliUserError);
  });

  it("deletes an empty application with its stored job, and refuses the default or one with runs", async () => {
    const { root, service } = await workspace();
    const empty = await service.createApplication({
      root,
      name: "Empty",
      jobSource: { kind: "pasted-text", text: "Nothing yet.\n" },
    });
    const withRun = await service.createApplication({
      root,
      name: "With run",
      jobSource: { kind: "pasted-text", text: "Build tools.\n" },
    });
    await service.start({ root, applicationId: withRun.id }, silent);
    if (empty.jobSource.kind !== "pasted-text") throw new Error("unexpected source");
    const storedJob = join(root, empty.jobSource.storedPath);

    await service.deleteApplication?.({ root, applicationId: empty.id });

    expect(await service.getApplication({ root, applicationId: empty.id })).toBeUndefined();
    await expect(stat(storedJob)).rejects.toThrow();
    await expect(service.deleteApplication?.({ root, applicationId: withRun.id })).rejects.toThrow(
      /can only be archived/u,
    );
    await expect(service.deleteApplication?.({ root, applicationId: "default" })).rejects.toThrow(
      /Archive it instead/u,
    );
    await expect(service.deleteApplication?.({ root, applicationId: empty.id })).rejects.toThrow(
      CliUserError,
    );
    expect((await service.listApplications({ root })).map((item) => item.id)).toEqual([
      "default",
      withRun.id,
    ]);
  });

  async function modelConfigurationOfRun(
    root: string,
    runId: string,
  ): Promise<Record<"author" | "critic", Record<string, unknown>>> {
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const run = await storage.getRun(runId);
      const context = await storage.getContextSnapshot(run?.contextSnapshotId ?? "");
      const payload = context?.payload as
        | { modelConfiguration?: Record<"author" | "critic", Record<string, unknown>> }
        | undefined;
      if (payload?.modelConfiguration === undefined) throw new Error("No model configuration.");
      return payload.modelConfiguration;
    } finally {
      await storage.close();
    }
  }

  it("binds a run to its application and reads that application's job description", async () => {
    const { root, service } = await workspace();
    const created = await service.createApplication({
      root,
      name: "Beta — Designer",
      jobSource: { kind: "pasted-text", text: "Design accessible interfaces with TypeScript." },
    });

    const bound = await service.start({ root, applicationId: created.id }, silent);
    const unbound = await service.start({ root, allowProviderData: false }, silent);

    expect(await jobDescriptionOfRun(root, bound.runId)).toBe(
      "Design accessible interfaces with TypeScript.",
    );
    expect(await jobDescriptionOfRun(root, unbound.runId)).toContain("Build tools.");
    const [defaultApplication, application] = await service.listApplications({ root });
    expect(defaultApplication?.runs.map((item) => item.id)).toEqual([unbound.runId]);
    expect(application?.runs.map((item) => item.id)).toEqual([bound.runId]);
    expect(application?.status).toBe("in-review");
    expect(
      JSON.parse(await readFile(join(root, ".draft-loop", "workspace.json"), "utf8"))
        .jobDescriptionPath,
    ).toBe("job.md");
  });

  it("runs an application with its own model pair and records the pair on the run", async () => {
    const { root, service } = await workspace();
    const created = await service.createApplication({
      root,
      name: "Delta — Staff Engineer",
      jobSource: { kind: "pasted-text", text: "Lead platform work in TypeScript." },
    });
    expect(created.modelProfiles).toBeNull();
    const premium = {
      author: { id: "premium-anthropic-author", version: 1 },
      critic: { id: "premium-openai-critic", version: 1 },
    };

    const updated = await service.setApplicationModels({
      root,
      applicationId: created.id,
      modelProfiles: premium,
    });
    expect(updated.modelProfiles).toEqual(premium);
    expect(
      (await service.getApplication({ root, applicationId: created.id }))?.modelProfiles,
    ).toEqual(premium);

    // The application's pair wins over a pair the caller named, such as the workspace's.
    const bound = await service.begin(
      {
        root,
        applicationId: created.id,
        modelProfiles: {
          author: { id: "standard-anthropic-author", version: 1 },
          critic: { id: "standard-openai-critic", version: 1 },
        },
      },
      silent,
    );
    const unbound = await service.begin({ root }, silent);
    const recorded = await modelConfigurationOfRun(root, bound.runId);
    expect(recorded.author).toMatchObject({
      company: "anthropic",
      modelId: "claude-fable-5-1",
      profile: { id: "premium-anthropic-author", version: 1 },
    });
    expect(recorded.critic).toMatchObject({
      company: "openai",
      modelId: "gpt-6-astra",
      profile: { id: "premium-openai-critic", version: 1 },
    });
    expect((await modelConfigurationOfRun(root, unbound.runId)).author).not.toHaveProperty(
      "profile",
    );

    const cleared = await service.setApplicationModels({
      root,
      applicationId: created.id,
      modelProfiles: null,
    });
    expect(cleared.modelProfiles).toBeNull();
  });

  it("refuses a model pair for the default application, an unknown profile or one company", async () => {
    const { root, service } = await workspace();
    const created = await service.createApplication({
      root,
      name: "Epsilon — Engineer",
      jobSource: { kind: "pasted-text", text: "Build services." },
    });
    const premium = {
      author: { id: "premium-anthropic-author", version: 1 },
      critic: { id: "premium-openai-critic", version: 1 },
    };
    await expect(
      service.setApplicationModels({ root, applicationId: "default", modelProfiles: premium }),
    ).rejects.toThrow(/workspace's models/u);
    await expect(
      service.setApplicationModels({ root, applicationId: "missing", modelProfiles: premium }),
    ).rejects.toThrow(/was not found/u);
    await expect(
      service.setApplicationModels({
        root,
        applicationId: created.id,
        modelProfiles: { ...premium, critic: { id: "premium-anthropic-author", version: 1 } },
      }),
    ).rejects.toThrow(/not a registered critic profile/u);
    await expect(
      service.setApplicationModels({
        root,
        applicationId: created.id,
        modelProfiles: { ...premium, critic: { id: "economy-openai-critic", version: 99 } },
      }),
    ).rejects.toThrow(/not a registered critic profile/u);
    expect(
      (await service.getApplication({ root, applicationId: created.id }))?.modelProfiles,
    ).toBeNull();
  });

  it("refuses to start in an unknown application or a URL application without a brief", async () => {
    const { root, service } = await workspace();
    const url = await service.createApplication({
      root,
      name: "Gamma — Analyst",
      jobSource: { kind: "approved-url", url: "https://jobs.example.test/analyst", approved: true },
    });

    await expect(service.start({ root, applicationId: "missing" }, silent)).rejects.toThrow(
      /was not found/u,
    );
    await expect(service.start({ root, applicationId: url.id }, silent)).rejects.toThrow(
      /opportunity brief/u,
    );
    expect((await service.listApplications({ root }))[1]?.runs).toEqual([]);
  });

  it("creates an opportunity brief for an application and keeps it out of the others", async () => {
    const { root, service } = await workspace();
    const created = await service.createApplication({
      root,
      name: "Beta — Designer",
      jobSource: { kind: "pasted-text", text: "Design accessible interfaces." },
    });
    const sources = [
      {
        id: "source-1",
        kind: "pasted-content" as const,
        classification: "job-posting" as const,
        content: "Design accessible interfaces for a synthetic product.",
      },
    ];

    const forApplication = await service.createOpportunity({
      root,
      id: "brief-app",
      sources,
      applicationId: created.id,
    });
    await service.createOpportunity({ root, id: "brief-default", sources });

    const [defaultApplication, application] = await service.listApplications({ root });
    expect(application?.briefs.map((item) => item.briefId)).toEqual([forApplication.brief.id]);
    expect(defaultApplication?.briefs.map((item) => item.briefId)).toEqual(["brief-default"]);
    await expect(
      service.start({ root, opportunityBrief: { briefId: "brief-app", version: 1 } }, silent),
    ).rejects.toThrow(/different application/u);
    await expect(
      service.createOpportunity({ root, sources, applicationId: "missing" }),
    ).rejects.toThrow(/was not found/u);
  });
});
