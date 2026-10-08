import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApplicationService, createLocalApplicationDriver } from "@draft-loop/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApplicationImportResult } from "../application-contract.js";
import { createNativeHost } from "./host.js";

let parent: string;
let picked: string | undefined;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-import-host-"));
  picked = undefined;
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

async function legacyWorkspace(name: string, job: string): Promise<string> {
  const root = join(parent, name);
  await mkdir(join(root, "evidence"), { recursive: true });
  await writeFile(join(root, "job.md"), job, "utf8");
  await writeFile(join(root, "evidence", "resume.md"), "Built local tools.\n", "utf8");
  await createApplicationService(createLocalApplicationDriver({})).initialize(
    { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
    { write: () => undefined },
  );
  return root;
}

async function openHost() {
  const host = createNativeHost({
    applicationService: createApplicationService(createLocalApplicationDriver({})),
    dialogs: {
      chooseDirectory: async (mode) => (mode === "create" ? parent : picked),
      chooseFiles: async () => [],
    },
  });
  const created = await host.invoke({
    type: "workspace.create",
    input: { name: "target", mode: "real" },
  });
  if (!created.ok) throw new Error(`Expected workspace creation: ${JSON.stringify(created)}`);
  const workspaceId = (created.value as { workspace: { id: string } }).workspace.id;
  return { host, workspaceId };
}

describe("application.import in the native host", () => {
  it("imports the folder the person picks and returns a path-free summary", async () => {
    const { host, workspaceId } = await openHost();
    picked = await legacyWorkspace("hc4", "# Hc4 Platform Engineer\n\nBuild tools.\n");

    const result = await host.invoke({
      type: "application.import",
      input: { workspaceId, selection: "native-dialog" },
    });

    expect(result.ok).toBe(true);
    const value = (result as { value: ApplicationImportResult }).value;
    expect(value).toMatchObject({
      workspaceId,
      application: { name: "Hc4 Platform Engineer", isDefault: false, status: "drafting" },
      imported: { runs: 0, briefs: 0, briefVersions: 0, exports: 0, skippedExports: 0 },
    });
    expect(JSON.stringify(result)).not.toContain(parent);

    const listed = await host.invoke({ type: "application.list", input: { workspaceId } });
    const names = (
      listed as { value: { applications: { name: string }[] } }
    ).value.applications.map((item) => item.name);
    expect(names).toContain("Hc4 Platform Engineer");
  });

  it("says why a folder was refused, without naming it, and when the picker is closed", async () => {
    const { host, workspaceId } = await openHost();
    const input = { workspaceId, selection: "native-dialog" } as const;

    picked = undefined;
    await expect(host.invoke({ type: "application.import", input })).resolves.toMatchObject({
      ok: false,
      error: { code: "permission-denied" },
    });

    picked = join(parent, "not-a-workspace");
    await mkdir(picked, { recursive: true });
    const notWorkspace = await host.invoke({ type: "application.import", input });
    expect(notWorkspace).toMatchObject({
      ok: false,
      error: { message: "The selected folder is not a DraftLoop workspace." },
    });
    expect(JSON.stringify(notWorkspace)).not.toContain(parent);

    picked = await legacyWorkspace("hc5", "# Hc5 Job\n\nWork.\n");
    await expect(host.invoke({ type: "application.import", input })).resolves.toMatchObject({
      ok: true,
    });
    const again = await host.invoke({ type: "application.import", input });
    expect(again).toMatchObject({
      ok: false,
      error: { message: expect.stringMatching(/already imported as the application "Hc5 Job"/u) },
    });
    expect(JSON.stringify(again)).not.toContain(parent);
  });
});
