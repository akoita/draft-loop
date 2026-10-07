import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ApplicationService,
  createApplicationService,
  createLocalApplicationDriver,
} from "@draft-loop/application";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNativeHost } from "./host.js";

let parent: string;
let root: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-job-extraction-"));
  root = join(parent, "workspace");
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

function draftRecord(sourceId: string): never {
  const capturedAt = "2026-10-07T10:00:00.000Z";
  return {
    workspaceId: "ignored",
    checksum: "d".repeat(64),
    brief: {
      schemaVersion: 1,
      id: "brief-job",
      version: 1,
      priorVersion: null,
      status: "draft",
      createdAt: capturedAt,
      reviewedAt: null,
      sources: [
        {
          id: sourceId,
          classification: "job-posting",
          status: "available",
          provenance: {
            kind: "local-file",
            displayName: "job.md",
            capturedAt,
            checksum: "b".repeat(64),
          },
        },
      ],
      role: { value: "Platform engineer", sourceIds: [sourceId] },
      employer: null,
      responsibilities: [],
      requirements: [
        { id: "requirement-1", text: "TypeScript", priority: "high", sourceIds: [sourceId] },
      ],
      priorities: [],
      candidateInstructions: {
        tone: null,
        applicationGoal: null,
        forbiddenLanguage: [],
        focusAreas: [],
      },
      issues: [],
    },
  } as never;
}

async function openWorkspace(
  createOpportunity: ApplicationService["createOpportunity"],
  jobText: string,
) {
  const real = createApplicationService(createLocalApplicationDriver({}));
  const host = createNativeHost({
    applicationService: { ...real, createOpportunity },
    dialogs: { chooseDirectory: async () => parent, chooseFiles: async () => [] },
  });
  const created = await host.invoke({
    type: "workspace.create",
    input: { name: "workspace", mode: "real" },
  });
  if (!created.ok) throw new Error(`Expected workspace creation: ${JSON.stringify(created)}`);
  await writeFile(join(root, "job.md"), jobText, "utf8");
  const workspaceId = (created.value as { workspace: { id: string } }).workspace.id;
  return { host, workspaceId };
}

const jobSource = {
  id: "workspace-job-description",
  kind: "workspace-job-description",
  classification: "job-posting",
} as const;

describe("opportunity.create from the workspace job description", () => {
  it("reads the configured job document host-side and returns no path", async () => {
    const createOpportunity = vi.fn<ApplicationService["createOpportunity"]>(async (command) => {
      const source = command.sources[0];
      return draftRecord(source?.id ?? "missing");
    });
    const { host, workspaceId } = await openWorkspace(
      createOpportunity,
      "- TypeScript systems engineer\n",
    );
    const result = await host.invoke({
      type: "opportunity.create",
      input: { workspaceId, providerTransmissionApproved: true, sources: [jobSource] },
    });
    expect(result).toMatchObject({ ok: true, value: { briefId: "brief-job", version: 1 } });
    expect(createOpportunity).toHaveBeenCalledTimes(1);
    const command = createOpportunity.mock.calls[0]?.[0];
    expect(command).toMatchObject({ allowProviderData: true });
    expect(command?.sources).toEqual([
      {
        id: "workspace-job-description",
        kind: "local-file",
        classification: "job-posting",
        path: join(root, "job.md"),
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(parent);
  });

  it("refuses without provider approval and never reaches the service", async () => {
    const createOpportunity = vi.fn<ApplicationService["createOpportunity"]>();
    const { host, workspaceId } = await openWorkspace(createOpportunity, "- TypeScript\n");
    for (const input of [
      { workspaceId, sources: [jobSource] },
      { workspaceId, providerTransmissionApproved: false, sources: [jobSource] },
    ]) {
      const result = await host.invoke({ type: "opportunity.create", input });
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "permission-denied",
          message:
            "Approve sending the job description to the writing model before extracting requirements.",
        },
      });
    }
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it("fails visibly when the job description is over the 64 KiB limit", async () => {
    const createOpportunity = vi.fn<ApplicationService["createOpportunity"]>();
    const { host, workspaceId } = await openWorkspace(
      createOpportunity,
      `- ${"requirement ".repeat(6_000)}\n`,
    );
    const result = await host.invoke({
      type: "opportunity.create",
      input: { workspaceId, providerTransmissionApproved: true, sources: [jobSource] },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "operation-failed",
        message: expect.stringContaining("larger than the 64 KiB extraction limit"),
      },
    });
    expect(JSON.stringify(result)).not.toContain(parent);
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it("fails visibly when the job description is empty", async () => {
    const createOpportunity = vi.fn<ApplicationService["createOpportunity"]>();
    const { host, workspaceId } = await openWorkspace(createOpportunity, "  \n");
    const result = await host.invoke({
      type: "opportunity.create",
      input: { workspaceId, providerTransmissionApproved: true, sources: [jobSource] },
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "not-found",
        message: "This workspace has no job description to extract requirements from.",
      },
    });
    expect(createOpportunity).not.toHaveBeenCalled();
  });

  it("maps an unexpected service failure to a path-free message", async () => {
    const createOpportunity = vi.fn<ApplicationService["createOpportunity"]>(async () => {
      throw new Error(`ENOENT: no such file ${join(root, "job.md")} in /private/store`);
    });
    const { host, workspaceId } = await openWorkspace(createOpportunity, "- TypeScript\n");
    const result = await host.invoke({
      type: "opportunity.create",
      input: { workspaceId, providerTransmissionApproved: true, sources: [jobSource] },
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(parent);
    expect(JSON.stringify(result)).not.toContain("/private/store");
  });
});
