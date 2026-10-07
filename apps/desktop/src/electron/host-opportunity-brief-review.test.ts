import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ApplicationService,
  createApplicationService,
  createLocalApplicationDriver,
  opportunityBriefVersionStaleErrorMessage,
} from "@draft-loop/application";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { opportunityVersionConflictMessage } from "../opportunity-brief-review-model.js";
import { createNativeHost } from "./host.js";
import { hostFailureMessage } from "./host-failure-message.js";

let parent: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-brief-review-"));
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

async function openWorkspace(overrides: Partial<ApplicationService>) {
  const real = createApplicationService(createLocalApplicationDriver({}));
  const host = createNativeHost({
    applicationService: { ...real, ...overrides },
    dialogs: { chooseDirectory: async () => parent, chooseFiles: async () => [] },
  });
  const created = await host.invoke({
    type: "workspace.create",
    input: { name: "workspace", mode: "real" },
  });
  if (!created.ok) throw new Error(`Expected workspace creation: ${JSON.stringify(created)}`);
  return { host, workspaceId: (created.value as { workspace: { id: string } }).workspace.id };
}

const patch = {
  requirements: [{ id: "requirement-1", text: "Edited", priority: "high", sourceIds: ["job-1"] }],
} as const;

describe("opportunity edit and review failures", () => {
  it("turns a stale version into the fixed conflict sentence, for edit and review", () => {
    const stale = new Error(opportunityBriefVersionStaleErrorMessage);
    for (const command of [
      {
        type: "opportunity.edit",
        input: { workspaceId: "w", briefId: "b", expectedVersion: 1, patch },
      },
      { type: "opportunity.review", input: { workspaceId: "w", briefId: "b", expectedVersion: 1 } },
    ] as const) {
      expect(hostFailureMessage(command, stale)).toBe(opportunityVersionConflictMessage);
    }
  });

  it("keeps other opportunity failures generic so no content crosses the bridge", () => {
    const command = {
      type: "opportunity.edit",
      input: { workspaceId: "w", briefId: "b", expectedVersion: 1, patch },
    } as const;
    const message = hostFailureMessage(command, new Error("private text from /home/me/job.md"));
    expect(message).toBe("The opportunity action failed with an unexpected error.");
    expect(
      hostFailureMessage(
        { type: "opportunity.get", input: { workspaceId: "w", briefId: "b" } },
        new Error(opportunityBriefVersionStaleErrorMessage),
      ),
    ).toBe("The opportunity action failed with an unexpected error.");
  });

  it("sends the real requirements patch to the service and returns the conflict to the renderer", async () => {
    const editOpportunity = vi.fn<ApplicationService["editOpportunity"]>(async () => {
      throw new Error(opportunityBriefVersionStaleErrorMessage);
    });
    const reviewOpportunity = vi.fn<ApplicationService["reviewOpportunity"]>(async () => {
      throw new Error(opportunityBriefVersionStaleErrorMessage);
    });
    const { host, workspaceId } = await openWorkspace({ editOpportunity, reviewOpportunity });

    const edited = await host.invoke({
      type: "opportunity.edit",
      input: { workspaceId, briefId: "brief-1", expectedVersion: 2, patch },
    });
    expect(edited).toMatchObject({
      ok: false,
      error: { code: "operation-failed", message: opportunityVersionConflictMessage },
    });
    expect(editOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({ briefId: "brief-1", expectedVersion: 2, patch }),
    );

    const reviewed = await host.invoke({
      type: "opportunity.review",
      input: { workspaceId, briefId: "brief-1", expectedVersion: 2 },
    });
    expect(reviewed).toMatchObject({
      ok: false,
      error: { code: "operation-failed", message: opportunityVersionConflictMessage },
    });
  });

  it("projects verified excerpts to the renderer and drops any other fact field", async () => {
    const entry = (id: string, extra: Record<string, unknown>) => ({
      id,
      text: `Fact ${id}`,
      sourceIds: ["job-1"],
      ...extra,
    });
    const editOpportunity = vi.fn<ApplicationService["editOpportunity"]>(
      async () =>
        ({
          checksum: "c".repeat(64),
          brief: {
            id: "brief-1",
            version: 3,
            priorVersion: 2,
            status: "draft",
            createdAt: "2026-10-07T10:00:00.000Z",
            reviewedAt: null,
            sources: [],
            role: null,
            employer: null,
            responsibilities: [entry("resp-1", { excerpt: "You will run it.", hidden: "x" })],
            requirements: [
              entry("req-1", { priority: "high", excerpt: "Needs TypeScript." }),
              entry("req-2", { priority: "low" }),
            ],
            priorities: [entry("prio-1", { excerpt: "not projected" })],
            candidateInstructions: {
              tone: null,
              applicationGoal: null,
              forbiddenLanguage: [],
              focusAreas: [],
            },
            issues: [],
          },
        }) as unknown as Awaited<ReturnType<ApplicationService["editOpportunity"]>>,
    );
    const { host, workspaceId } = await openWorkspace({ editOpportunity });

    const edited = await host.invoke({
      type: "opportunity.edit",
      input: { workspaceId, briefId: "brief-1", expectedVersion: 2, patch },
    });
    if (!edited.ok) throw new Error(`Expected an edited brief: ${JSON.stringify(edited)}`);
    const value = edited.value as {
      responsibilities: object[];
      requirements: object[];
      priorities: object[];
    };
    expect(value.responsibilities[0]).toEqual({
      id: "resp-1",
      text: "Fact resp-1",
      sourceIds: ["job-1"],
      excerpt: "You will run it.",
    });
    expect(value.requirements[0]).toMatchObject({ excerpt: "Needs TypeScript." });
    expect(value.requirements[1]).not.toHaveProperty("excerpt");
    expect(value.priorities[0]).not.toHaveProperty("excerpt");
  });
});
