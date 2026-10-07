import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  parent = await mkdtemp(join(tmpdir(), "draft-loop-start-from-brief-"));
  root = join(parent, "workspace");
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

/** A stored brief version; the requirement texts are private and must never reach the summary. */
function briefRecord(
  version: number,
  status: "draft" | "reviewed",
  priorities: readonly ("critical" | "high" | "medium")[] = ["critical", "high", "critical"],
): never {
  const capturedAt = "2026-10-07T10:00:00.000Z";
  return {
    workspaceId: "ignored",
    checksum: "d".repeat(64),
    brief: {
      schemaVersion: 1,
      id: "target-role",
      version,
      priorVersion: version === 1 ? null : version - 1,
      status,
      createdAt: capturedAt,
      reviewedAt: status === "reviewed" ? capturedAt : null,
      sources: [
        {
          id: "job-1",
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
      role: { value: "Platform engineer", sourceIds: ["job-1"] },
      employer: null,
      responsibilities: [],
      requirements: priorities.map((priority, index) => ({
        id: `requirement-${index + 1}`,
        text: `Private requirement text ${index + 1}`,
        priority,
        sourceIds: ["job-1"],
      })),
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

const words = (count: number) => Array.from({ length: count }, (_, i) => `skill${i}`).join(" ");
const longJobPage = `Acme builds widgets for logistics teams. ${words(80)}\n`;

interface Harness {
  readonly host: ReturnType<typeof createNativeHost>;
  readonly workspaceId: string;
  readonly begin: ReturnType<typeof vi.fn>;
  readonly getOpportunity: ReturnType<typeof vi.fn>;
}

function hostFor(overrides: Partial<ApplicationService>) {
  const real = createApplicationService(createLocalApplicationDriver({}));
  const begin = vi.fn(async () => {
    throw new Error("begin is observed, not run");
  });
  const getOpportunity = vi.fn(async () => undefined);
  const host = createNativeHost({
    applicationService: { ...real, begin, getOpportunity, ...overrides } as ApplicationService,
    dialogs: {
      chooseDirectory: async (purpose?: string) => (purpose === "create" ? parent : root),
      chooseFiles: async () => [],
    },
  });
  return { host, begin, getOpportunity };
}

async function createWorkspace(jobText: string, overrides: Partial<ApplicationService> = {}) {
  const built = hostFor(overrides);
  const created = await built.host.invoke({
    type: "workspace.create",
    input: { name: "workspace", mode: "demo" },
  });
  if (!created.ok) throw new Error(`Expected workspace creation: ${JSON.stringify(created)}`);
  await writeFile(join(root, "job.md"), jobText, "utf8");
  const workspaceId = (created.value as { workspace: { id: string } }).workspace.id;
  return { ...built, workspaceId } satisfies Harness;
}

async function reopen(overrides: Partial<ApplicationService>) {
  const built = hostFor(overrides);
  const opened = await built.host.invoke({
    type: "workspace.open",
    input: { selection: "native-dialog" },
  });
  if (!opened.ok) throw new Error(`Expected workspace open: ${JSON.stringify(opened)}`);
  return built;
}

describe("latest opportunity brief discovery", () => {
  it("reports no brief for a workspace that never made one", async () => {
    const { host, workspaceId } = await createWorkspace("- TypeScript\n");
    await expect(
      host.invoke({ type: "opportunity.latest", input: { workspaceId } }),
    ).resolves.toEqual({ ok: true, value: null });
  });

  it("rediscovers an unreviewed draft after the app restarts, without requirement text", async () => {
    const draft = briefRecord(1, "draft");
    const first = await createWorkspace("- TypeScript\n", {
      createOpportunity: vi.fn(async () => draft),
      getOpportunity: vi.fn(async () => draft),
    });
    const created = await first.host.invoke({
      type: "opportunity.create",
      input: {
        workspaceId: first.workspaceId,
        sources: [
          {
            id: "workspace-job-description",
            kind: "workspace-job-description",
            classification: "job-posting",
          },
        ],
        providerTransmissionApproved: true,
      },
    });
    expect(created.ok).toBe(true);

    const restarted = await reopen({ getOpportunity: vi.fn(async () => draft) });
    const latest = await restarted.host.invoke({
      type: "opportunity.latest",
      input: { workspaceId: first.workspaceId },
    });

    expect(latest).toEqual({
      ok: true,
      value: {
        workspaceId: first.workspaceId,
        briefId: "target-role",
        version: 1,
        status: "draft",
        requirementCount: 3,
        criticalCount: 2,
      },
    });
    expect(JSON.stringify(latest)).not.toContain("Private requirement text");
  });

  it("reports the latest version after a review, and a draft newer than a reviewed one", async () => {
    const stored = { current: briefRecord(1, "draft") };
    const first = await createWorkspace("- TypeScript\n", {
      createOpportunity: vi.fn(async () => stored.current),
      getOpportunity: vi.fn(async () => stored.current),
      reviewOpportunity: vi.fn(async () => {
        stored.current = briefRecord(2, "reviewed");
        return stored.current;
      }),
      editOpportunity: vi.fn(async () => {
        stored.current = briefRecord(3, "draft", ["high"]);
        return stored.current;
      }),
    });
    const { host, workspaceId } = first;
    await host.invoke({
      type: "opportunity.create",
      input: {
        workspaceId,
        sources: [
          {
            id: "workspace-job-description",
            kind: "workspace-job-description",
            classification: "job-posting",
          },
        ],
        providerTransmissionApproved: true,
      },
    });
    await host.invoke({
      type: "opportunity.review",
      input: { workspaceId, briefId: "target-role", expectedVersion: 1 },
    });
    await expect(
      host.invoke({ type: "opportunity.latest", input: { workspaceId } }),
    ).resolves.toMatchObject({ ok: true, value: { version: 2, status: "reviewed" } });

    await host.invoke({
      type: "opportunity.edit",
      input: { workspaceId, briefId: "target-role", expectedVersion: 2, patch: {} },
    });
    await expect(
      host.invoke({ type: "opportunity.latest", input: { workspaceId } }),
    ).resolves.toMatchObject({
      ok: true,
      value: { version: 3, status: "draft", requirementCount: 1, criticalCount: 0 },
    });
  });

  it("persists only a brief id as the pointer", async () => {
    const draft = briefRecord(1, "draft");
    const { host, workspaceId } = await createWorkspace("- TypeScript\n", {
      createOpportunity: vi.fn(async () => draft),
    });
    await host.invoke({
      type: "opportunity.create",
      input: {
        workspaceId,
        sources: [
          {
            id: "workspace-job-description",
            kind: "workspace-job-description",
            classification: "job-posting",
          },
        ],
        providerTransmissionApproved: true,
      },
    });
    const stored = JSON.parse(
      await readFile(join(root, ".draft-loop", "review-overrides.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(stored.latestOpportunityBriefId).toBe("target-role");
    expect(JSON.stringify(stored)).not.toContain("Private requirement text");
  });
});

describe("starting from the reviewed brief", () => {
  async function withReviewedBrief(jobText: string) {
    const reviewed = briefRecord(2, "reviewed");
    const created = await createWorkspace(jobText, {
      createOpportunity: vi.fn(async () => briefRecord(1, "draft")),
      reviewOpportunity: vi.fn(async () => reviewed),
      getOpportunity: vi.fn(async () => reviewed),
    });
    await created.host.invoke({
      type: "opportunity.create",
      input: {
        workspaceId: created.workspaceId,
        sources: [
          {
            id: "workspace-job-description",
            kind: "workspace-job-description",
            classification: "job-posting",
          },
        ],
        providerTransmissionApproved: true,
      },
    });
    await created.host.invoke({
      type: "opportunity.review",
      input: { workspaceId: created.workspaceId, briefId: "target-role", expectedVersion: 1 },
    });
    return created;
  }

  const startAction = (workspaceId: string, action: Record<string, unknown>) => ({
    type: "review.dispatch" as const,
    input: { workspaceId, runId: "pending", action: { type: "start", ...action } },
  });

  it("binds the exact reviewed version into the run start", async () => {
    const { host, workspaceId, begin } = await withReviewedBrief("- TypeScript\n");
    await host.invoke(startAction(workspaceId, {}) as never);
    expect(begin).toHaveBeenCalledWith(
      expect.objectContaining({ opportunityBrief: { briefId: "target-role", version: 2 } }),
      expect.anything(),
    );
  });

  it("starts from the raw job description when the person switches to it", async () => {
    const { host, workspaceId, begin } = await withReviewedBrief("- TypeScript\n");
    await host.invoke(startAction(workspaceId, { requirementsSource: "job-description" }) as never);
    expect(begin).toHaveBeenCalledTimes(1);
    const command = (begin.mock.calls as unknown as readonly [Record<string, unknown>][])[0]?.[0];
    expect(command).not.toHaveProperty("opportunityBrief");
  });

  it("starts without a brief when none was reviewed", async () => {
    const { host, workspaceId, begin } = await createWorkspace("- TypeScript\n");
    await host.invoke(startAction(workspaceId, {}) as never);
    const command = (begin.mock.calls as unknown as readonly [Record<string, unknown>][])[0]?.[0];
    expect(command).not.toHaveProperty("opportunityBrief");
  });

  it("does not let the raw job refusal block a start that uses the reviewed brief", async () => {
    const { host, workspaceId } = await withReviewedBrief(longJobPage);
    const loaded = await host.invoke({ type: "review.load", input: { workspaceId } });
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        setup: {
          reviewedOpportunity: { briefId: "target-role", version: 2 },
          nextSteps: expect.not.arrayContaining([expect.stringContaining("words, too long")]),
        },
      },
    });
    // The refusal is still reported, so choosing the raw job description can block on it.
    const setup = (loaded as { value: { setup: { jobRequirementProblem: string } } }).value.setup;
    expect(setup.jobRequirementProblem).toMatch(/too long to match against individual CV lines/u);
    expect(setup.jobRequirementProblem).not.toContain("draft-loop opportunity create");
  });

  it("blocks setup on the refusal when there is no reviewed brief", async () => {
    const { host, workspaceId } = await createWorkspace(longJobPage);
    const loaded = await host.invoke({ type: "review.load", input: { workspaceId } });
    const setup = (
      loaded as { value: { setup: { jobRequirementProblem: string; nextSteps: string[] } } }
    ).value.setup;
    expect(setup.nextSteps).toContain(setup.jobRequirementProblem);
  });
});
