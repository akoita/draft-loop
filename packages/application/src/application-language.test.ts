import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteStorage } from "@draft-loop/storage";
import { afterEach, describe, expect, it } from "vitest";
import { CliUserError } from "./cli-user-error.js";
import { type ApplicationService, createApplicationService } from "./index.js";
import { createLocalApplicationDriver } from "./local.js";

type Service = ApplicationService & Required<Pick<ApplicationService, "setApplicationLanguage">>;

const silent = { write: () => undefined };

describe("application document language", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function workspace(): Promise<{ root: string; service: Service }> {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-application-language-"));
    directories.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "# Synthetic Platform Engineer\n\nBuild tools.\n");
    await writeFile(
      join(root, "evidence", "resume.md"),
      "Built local-first TypeScript tools with deterministic testing.\n",
    );
    const service = createApplicationService(createLocalApplicationDriver()) as Service;
    await service.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      silent,
    );
    return { root, service };
  }

  async function languageOfRun(root: string, runId: string): Promise<string> {
    const storage = openSqliteStorage(join(root, ".draft-loop", "history.sqlite"));
    try {
      const run = await storage.getRun(runId);
      const context = await storage.getContextSnapshot(run?.contextSnapshotId ?? "");
      return String((context?.payload as { language?: unknown } | undefined)?.language);
    } finally {
      await storage.close();
    }
  }

  it("writes an application's runs in its own language and the others in the workspace's", async () => {
    const { root, service } = await workspace();
    const french = await service.createApplication({
      root,
      name: "Synthétique — Ingénieure plateforme",
      jobSource: { kind: "pasted-text", text: "Concevoir des outils internes en TypeScript." },
      language: "fr",
    });
    const english = await service.createApplication({
      root,
      name: "Synthetic — Platform Engineer",
      jobSource: { kind: "pasted-text", text: "Build internal tools in TypeScript." },
    });
    expect(french.language).toBe("fr");
    expect(english.language).toBeNull();

    const frenchRun = await service.begin({ root, applicationId: french.id }, silent);
    const englishRun = await service.begin({ root, applicationId: english.id }, silent);
    const defaultRun = await service.begin({ root }, silent);
    expect(await languageOfRun(root, frenchRun.runId)).toBe("fr");
    expect(await languageOfRun(root, englishRun.runId)).toBe("en");
    expect(await languageOfRun(root, defaultRun.runId)).toBe("en");

    const listed = await service.listApplications({ root });
    expect(listed.map((item) => item.language)).toEqual([null, "fr", null]);
    expect(
      JSON.parse(await readFile(join(root, ".draft-loop", "application-languages.json"), "utf8")),
    ).toEqual({ schemaVersion: 1, languages: { [french.id]: "fr" } });
  });

  it("changes and clears an application's language", async () => {
    const { root, service } = await workspace();
    const created = await service.createApplication({
      root,
      name: "Synthetic — Designer",
      jobSource: { kind: "pasted-text", text: "Design accessible interfaces." },
    });
    const changed = await service.setApplicationLanguage({
      root,
      applicationId: created.id,
      language: "de",
    });
    expect(changed.language).toBe("de");
    const cleared = await service.setApplicationLanguage({
      root,
      applicationId: created.id,
      language: null,
    });
    expect(cleared.language).toBeNull();
  });

  it("refuses the default application, an unknown application or a language not offered", async () => {
    const { root, service } = await workspace();
    await expect(
      service.setApplicationLanguage({ root, applicationId: "default", language: "fr" }),
    ).rejects.toThrow(CliUserError);
    await expect(
      service.setApplicationLanguage({ root, applicationId: "app-missing", language: "fr" }),
    ).rejects.toThrow("was not found");
    await expect(
      service.createApplication({
        root,
        name: "Synthetic — Writer",
        jobSource: { kind: "pasted-text", text: "Write." },
        language: "xx",
      }),
    ).rejects.toThrow("not a language");
  });
});
