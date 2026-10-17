import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApplicationView } from "@draft-loop/application";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { maximumApplicationJobTextLength } from "../application-job-contract.js";
import { readApplicationJob } from "./application-job.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "draft-loop-application-job-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function application(jobSource: ApplicationView["jobSource"]): ApplicationView {
  return { jobSource } as ApplicationView;
}

function read(app: ApplicationView | undefined, workspaceJobPath: string | undefined = "job.md") {
  return readApplicationJob({
    workspaceId: "workspace-1",
    root,
    workspaceJobPath,
    application: app,
  });
}

describe("readApplicationJob", () => {
  it("reads the workspace's own job file for the default application", async () => {
    await writeFile(join(root, "job.md"), "\n  Staff engineer\nTypeScript  \n");
    await expect(read(undefined)).resolves.toEqual({
      workspaceId: "workspace-1",
      origin: "workspace-file",
      text: "Staff engineer\nTypeScript",
      truncated: false,
      url: null,
    });
  });

  it("reads a created application's pasted text and chosen file", async () => {
    await writeFile(join(root, "pasted.md"), "Pasted job");
    const chosen = join(root, "chosen.txt");
    await writeFile(chosen, "Chosen job");
    await expect(
      read(application({ kind: "pasted-text", storedPath: "pasted.md" })),
    ).resolves.toMatchObject({ origin: "pasted-text", text: "Pasted job" });
    await expect(read(application({ kind: "local-file", path: chosen }))).resolves.toMatchObject({
      origin: "local-file",
      text: "Chosen job",
    });
  });

  it("answers a URL job with its approved address and no text", async () => {
    const url = "https://jobs.example.com/staff-engineer";
    await expect(read(application({ kind: "approved-url", url, approved: true }))).resolves.toEqual(
      {
        workspaceId: "workspace-1",
        origin: "url",
        text: null,
        truncated: false,
        url,
      },
    );
  });

  it("answers unavailable for a missing, empty or unconfigured job", async () => {
    const unavailable = { origin: "unavailable", text: null, truncated: false, url: null };
    await expect(read(undefined)).resolves.toMatchObject(unavailable);
    await expect(read(undefined, undefined)).resolves.toMatchObject(unavailable);
    await writeFile(join(root, "job.md"), "   \n");
    await expect(read(undefined)).resolves.toMatchObject(unavailable);
  });

  it("cuts an oversized job at the bridge limit and says so", async () => {
    await writeFile(join(root, "job.md"), "a".repeat(maximumApplicationJobTextLength + 10));
    const job = await read(undefined);
    expect(job.truncated).toBe(true);
    expect(job.text).toHaveLength(maximumApplicationJobTextLength);
  });
});
