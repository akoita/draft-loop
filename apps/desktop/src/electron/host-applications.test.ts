import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ApplicationService,
  createApplicationService,
  createLocalApplicationDriver,
} from "@draft-loop/application";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplicationSummaryView } from "../application-contract.js";
import type { DesktopReviewState } from "../model.js";
import { createNativeHost } from "./host.js";

let parent: string;

beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "draft-loop-applications-host-"));
});

afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});

const jobText = "# Staff Platform Engineer\n\nSecret-job-marker: Kubernetes and Go.\n";

async function openHost(overrides: Partial<ApplicationService> = {}) {
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
  const workspaceId = (created.value as { workspace: { id: string } }).workspace.id;
  return { host, workspaceId, root: join(parent, "workspace") };
}

type Host = Awaited<ReturnType<typeof openHost>>["host"];

async function listed(host: Host, workspaceId: string) {
  const result = await host.invoke({ type: "application.list", input: { workspaceId } });
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return result.value as { workspaceId: string; applications: ApplicationSummaryView[] };
}

async function createApplication(host: Host, workspaceId: string, name: string) {
  const result = await host.invoke({
    type: "application.create",
    input: { workspaceId, name, jobText },
  });
  if (!result.ok) throw new Error(`Expected success: ${JSON.stringify(result)}`);
  return (result.value as { application: ApplicationSummaryView }).application;
}

describe("application commands in the native host", () => {
  it("lists a fresh workspace as its one default application", async () => {
    const { host, workspaceId } = await openHost();
    const { applications } = await listed(host, workspaceId);
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({
      id: "default",
      isDefault: true,
      status: "drafting",
      runCount: 0,
      briefCount: 0,
      exportCount: 0,
      latestRunId: null,
    });
  });

  it("creates, lists and gets an application with path-free summaries", async () => {
    const { host, workspaceId } = await openHost();
    const created = await createApplication(host, workspaceId, "  Acme — Staff Engineer ");
    expect(created).toMatchObject({
      name: "Acme — Staff Engineer",
      jobSourceKind: "pasted-text",
      status: "drafting",
      isDefault: false,
      runCount: 0,
    });
    const list = await listed(host, workspaceId);
    expect(list.applications.map((application) => application.id)).toEqual(["default", created.id]);
    const got = await host.invoke({
      type: "application.get",
      input: { workspaceId, applicationId: created.id },
    });
    expect(got).toMatchObject({ ok: true, value: { application: { id: created.id } } });
    for (const payload of [list, got, created]) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain(parent);
      expect(text).not.toContain("Secret-job-marker");
      expect(text).not.toContain("storedPath");
      expect(text).not.toContain("job.md");
    }
  });

  it("answers not-found for an unknown application and refuses a blank name", async () => {
    const { host, workspaceId } = await openHost();
    expect(
      await host.invoke({
        type: "application.get",
        input: { workspaceId, applicationId: "app-missing" },
      }),
    ).toMatchObject({ ok: false, error: { code: "not-found" } });
    const blank = await host.invoke({
      type: "application.create",
      input: { workspaceId, name: "   ", jobText },
    });
    expect(blank).toMatchObject({ ok: false });
    const empty = await host.invoke({
      type: "application.create",
      input: { workspaceId, name: "Acme", jobText: "   \n" },
    });
    expect(empty).toMatchObject({ ok: false });
    expect((await listed(host, workspaceId)).applications).toHaveLength(1);
  });

  it("scopes review.load to an application and treats a created one as ready on its own job", async () => {
    const { host, workspaceId } = await openHost();
    const created = await createApplication(host, workspaceId, "Acme");
    const scoped = await host.invoke({
      type: "review.load",
      input: { workspaceId, applicationId: created.id },
    });
    expect(scoped.ok).toBe(true);
    const state = (scoped as { value: DesktopReviewState }).value;
    expect(state.setup.jobDescriptionReady).toBe(true);
    expect(state.setup.reviewedOpportunity).toBeNull();
    expect(state.runId).not.toBe("");
    expect(
      await host.invoke({
        type: "review.load",
        input: { workspaceId, applicationId: "app-missing" },
      }),
    ).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("passes the application to a review start and ignores the workspace's reviewed brief", async () => {
    const begin = vi.fn<ApplicationService["begin"]>(async () => {
      throw new Error("stop after recording");
    });
    const { host, workspaceId } = await openHost({ begin });
    const created = await createApplication(host, workspaceId, "Acme");
    const loaded = await host.invoke({
      type: "review.load",
      input: { workspaceId, applicationId: created.id },
    });
    const preflight = (loaded as { value: DesktopReviewState }).value.providerTransmissionPreflight;
    if (preflight.required) {
      await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId,
          runId: "pending",
          action: {
            type: "acknowledge-provider-transmission",
            fingerprint: preflight.fingerprint,
          },
          applicationId: created.id,
        },
      });
    }
    const started = await host.invoke({
      type: "review.dispatch",
      input: {
        workspaceId,
        runId: "pending",
        action: { type: "start" },
        applicationId: created.id,
      },
    });
    expect(JSON.stringify(started)).not.toContain("not-found");
    expect(begin).toHaveBeenCalledTimes(1);
    const command = begin.mock.calls[0]?.[0];
    expect(command).toMatchObject({ applicationId: created.id });
    expect(command).not.toHaveProperty("opportunityBrief");
  });

  it("passes the application to run.start", async () => {
    const start = vi.fn<ApplicationService["start"]>(async () => {
      throw new Error("stop after recording");
    });
    const { host, workspaceId } = await openHost({ start });
    const created = await createApplication(host, workspaceId, "Acme");
    await host.invoke({
      type: "run.start",
      input: { workspaceId, applicationId: created.id },
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.calls[0]?.[0]).toMatchObject({ applicationId: created.id });
    await host.invoke({ type: "run.start", input: { workspaceId } });
    expect(start.mock.calls[1]?.[0]).not.toHaveProperty("applicationId");
  });

  it("sets an application's own model pair and runs, consents and reports with it", async () => {
    const begin = vi.fn<ApplicationService["begin"]>(async () => {
      throw new Error("stop after recording");
    });
    const { host, workspaceId } = await openHost({ begin });
    const created = await createApplication(host, workspaceId, "Acme");
    expect(created.modelProfiles).toBeNull();
    const premium = {
      author: { id: "premium-anthropic-author", version: 1 },
      critic: { id: "premium-openai-critic", version: 1 },
    };

    const set = await host.invoke({
      type: "application.set-models",
      input: { workspaceId, applicationId: created.id, modelProfiles: premium },
    });
    expect(set).toMatchObject({ ok: true, value: { application: { modelProfiles: premium } } });
    const listedApplication = (await listed(host, workspaceId)).applications.find(
      (application) => application.id === created.id,
    );
    expect(listedApplication?.modelProfiles).toEqual(premium);

    const load = async (applicationId?: string) => {
      const loaded = await host.invoke({
        type: "review.load",
        input: { workspaceId, ...(applicationId === undefined ? {} : { applicationId }) },
      });
      if (!loaded.ok) throw new Error(`Expected a review state: ${JSON.stringify(loaded)}`);
      return (loaded.value as DesktopReviewState).providerTransmissionPreflight;
    };
    const workspacePreflight = await load();
    const applicationPreflight = await load(created.id);
    expect(applicationPreflight.author).toMatchObject({
      company: "anthropic",
      model: "claude-fable-5-1",
    });
    expect(applicationPreflight.critic).toMatchObject({ company: "openai", model: "gpt-6-astra" });
    expect(workspacePreflight.author.model).not.toBe("claude-fable-5-1");
    expect(applicationPreflight.fingerprint).not.toBe(workspacePreflight.fingerprint);

    if (applicationPreflight.required) {
      const acknowledged = await host.invoke({
        type: "review.dispatch",
        input: {
          workspaceId,
          runId: "pending",
          action: {
            type: "acknowledge-provider-transmission",
            fingerprint: applicationPreflight.fingerprint,
          },
          applicationId: created.id,
        },
      });
      expect(acknowledged.ok).toBe(true);
      expect((await load(created.id)).acknowledged).toBe(true);
    }
    // The workspace's applied pair named by the renderer does not replace the application's.
    await host.invoke({
      type: "review.dispatch",
      input: {
        workspaceId,
        runId: "pending",
        action: {
          type: "start",
          modelProfiles: {
            author: { id: "standard-anthropic-author", version: 1 },
            critic: { id: "standard-openai-critic", version: 1 },
          },
        },
        applicationId: created.id,
      },
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin.mock.calls[0]?.[0]).toMatchObject({
      applicationId: created.id,
      modelProfiles: premium,
    });

    const cleared = await host.invoke({
      type: "application.set-models",
      input: { workspaceId, applicationId: created.id, modelProfiles: null },
    });
    expect(cleared).toMatchObject({ ok: true, value: { application: { modelProfiles: null } } });
    expect((await load(created.id)).fingerprint).toBe(workspacePreflight.fingerprint);
  });

  it("refuses a malformed pair at the bridge and a pair for the default application", async () => {
    const { host, workspaceId } = await openHost();
    const created = await createApplication(host, workspaceId, "Acme");
    expect(
      await host.invoke({
        type: "application.set-models",
        input: {
          workspaceId,
          applicationId: created.id,
          modelProfiles: { author: { id: "premium-anthropic-author", version: 0 } },
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(
      await host.invoke({
        type: "application.set-models",
        input: {
          workspaceId,
          applicationId: "default",
          modelProfiles: {
            author: { id: "premium-anthropic-author", version: 1 },
            critic: { id: "premium-openai-critic", version: 1 },
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("workspace's models") },
    });
  });
});
