import { describe, expect, it, vi } from "vitest";

import type { ApplicationSummaryView } from "./application-contract.js";
import type { NativeBridge } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import { createFixtureReviewState } from "./model.js";
import { createBridgeReviewPort, createNativeCapabilityPort } from "./native.js";

const application: ApplicationSummaryView = {
  id: "app-1",
  name: "Acme",
  jobSourceKind: "pasted-text",
  status: "drafting",
  isDefault: false,
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T10:00:00.000Z",
  runCount: 0,
  briefCount: 0,
  exportCount: 0,
  latestRunId: null,
  archivedAt: null,
  modelProfiles: null,
};

function portWith(capabilities: readonly string[]) {
  const state = createFixtureReviewState();
  const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
    if (command.type === "review.load") return { ok: true, value: state };
    if (command.type === "review.dispatch") return { ok: true, value: state };
    if (command.type === "application.list") {
      return { ok: true, value: { workspaceId: state.workspaceId, applications: [application] } };
    }
    if (command.type === "application.create") {
      return { ok: true, value: { workspaceId: state.workspaceId, application } };
    }
    if (command.type === "application.import") {
      return {
        ok: true,
        value: {
          workspaceId: state.workspaceId,
          application,
          imported: { runs: 1, briefs: 0, briefVersions: 0, exports: 0, skippedExports: 0 },
        },
      };
    }
    if (command.type === "application.archive") {
      return {
        ok: true,
        value: {
          workspaceId: state.workspaceId,
          application: { ...application, archivedAt: "2026-10-09T10:00:00.000Z" },
        },
      };
    }
    if (command.type === "application.delete") {
      return {
        ok: true,
        value: { workspaceId: state.workspaceId, applicationId: "app-1", deleted: true },
      };
    }
    return { ok: false, error: { code: "capability-unavailable", message: command.type } };
  });
  const port = createBridgeReviewPort(
    createNativeCapabilityPort({ capabilities: capabilities as never, invoke }),
  );
  return { port, invoke, state };
}

describe("application scope in the desktop review port", () => {
  it("exposes application methods only when the host advertises them", () => {
    const without = portWith(["review.load"]).port;
    expect(without.listApplications).toBeUndefined();
    expect(without.createApplication).toBeUndefined();
    expect(without.importApplication).toBeUndefined();
    expect(without.archiveApplication).toBeUndefined();
    expect(without.deleteApplication).toBeUndefined();
    expect(without.selectApplication).toBeUndefined();
    const withApplications = portWith([...bridgeCapabilities]).port;
    expect(withApplications.listApplications).toBeDefined();
    expect(withApplications.createApplication).toBeDefined();
    expect(withApplications.selectApplication).toBeDefined();
  });

  it("lists and creates through the bridge commands", async () => {
    const { port, invoke, state } = portWith([...bridgeCapabilities]);
    await expect(port.listApplications?.(state.workspaceId)).resolves.toEqual([application]);
    await expect(port.createApplication?.(state.workspaceId, "Acme", "Job text")).resolves.toEqual(
      application,
    );
    expect(invoke).toHaveBeenCalledWith({
      type: "application.create",
      input: { workspaceId: state.workspaceId, name: "Acme", jobText: "Job text" },
    });
  });

  it("imports through the bridge with the native folder picker and sends no path", async () => {
    const { port, invoke, state } = portWith([...bridgeCapabilities]);
    await expect(port.importApplication?.(state.workspaceId)).resolves.toEqual({
      application,
      imported: { runs: 1, briefs: 0, briefVersions: 0, exports: 0, skippedExports: 0 },
    });
    expect(invoke).toHaveBeenCalledWith({
      type: "application.import",
      input: { workspaceId: state.workspaceId, selection: "native-dialog" },
    });
  });

  it("archives and deletes through the bridge commands", async () => {
    const { port, invoke, state } = portWith([...bridgeCapabilities]);
    await expect(port.archiveApplication?.(state.workspaceId, "app-1", true)).resolves.toEqual({
      ...application,
      archivedAt: "2026-10-09T10:00:00.000Z",
    });
    expect(invoke).toHaveBeenLastCalledWith({
      type: "application.archive",
      input: { workspaceId: state.workspaceId, applicationId: "app-1", archived: true },
    });
    await expect(port.deleteApplication?.(state.workspaceId, "app-1")).resolves.toBeUndefined();
    expect(invoke).toHaveBeenLastCalledWith({
      type: "application.delete",
      input: { workspaceId: state.workspaceId, applicationId: "app-1" },
    });
  });

  it("loads the workspace-wide review until an application is selected", async () => {
    const { port, invoke } = portWith([...bridgeCapabilities]);
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({ type: "review.load", input: {} });
    port.selectApplication?.("app-1");
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.load",
      input: { applicationId: "app-1" },
    });
    port.selectApplication?.(null);
    await port.load();
    expect(invoke).toHaveBeenLastCalledWith({ type: "review.load", input: {} });
  });

  it("starts runs in the opened application and not before it is opened", async () => {
    const { port, invoke, state } = portWith([...bridgeCapabilities]);
    await port.dispatch(state, { type: "start" });
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.dispatch",
      input: { workspaceId: state.workspaceId, runId: state.runId, action: { type: "start" } },
    });
    port.selectApplication?.("app-1");
    await port.dispatch(state, { type: "start" });
    expect(invoke).toHaveBeenLastCalledWith({
      type: "review.dispatch",
      input: {
        workspaceId: state.workspaceId,
        runId: state.runId,
        action: { type: "start" },
        applicationId: "app-1",
      },
    });
  });

  it("clears the scope when another workspace is opened", async () => {
    const { port, invoke, state } = portWith([...bridgeCapabilities]);
    invoke.mockImplementationOnce(async () => ({
      ok: true,
      value: { workspace: { id: state.workspaceId, name: "Other" } },
    }));
    port.selectApplication?.("app-1");
    await port.openRecentWorkspace?.("123e4567-e89b-12d3-a456-426614174000");
    expect(invoke).toHaveBeenLastCalledWith({ type: "review.load", input: {} });
  });

  it("creates an application from an approved URL", async () => {
    const { port, invoke, state } = portWith([...bridgeCapabilities]);
    await port.createApplication?.(state.workspaceId, "Acme", {
      url: "https://jobs.example.test/1",
    });
    expect(invoke).toHaveBeenCalledWith({
      type: "application.create",
      input: {
        workspaceId: state.workspaceId,
        name: "Acme",
        jobUrl: "https://jobs.example.test/1",
        jobUrlApproved: true,
      },
    });
  });

  it("scopes brief commands to the opened application", async () => {
    const { port, invoke, state } = portWith([...bridgeCapabilities]);
    const sources = [
      {
        id: "workspace-job-description",
        kind: "workspace-job-description",
        classification: "job-posting",
      },
    ] as const;
    const called = () => invoke.mock.calls.at(-1)?.[0];

    await port.createOpportunity?.({ sources }).catch(() => undefined);
    expect(called()?.input).not.toHaveProperty("applicationId");
    port.selectApplication?.("app-1");
    await port.createOpportunity?.({ sources }).catch(() => undefined);
    expect(called()).toMatchObject({
      type: "opportunity.create",
      input: { applicationId: "app-1" },
    });
    await port.getLatestOpportunity?.().catch(() => undefined);
    expect(called()).toMatchObject({
      type: "opportunity.latest",
      input: { applicationId: "app-1" },
    });
    await port
      .editOpportunity?.({ briefId: "brief-1", expectedVersion: 1, patch: {} })
      .catch(() => undefined);
    expect(called()).toMatchObject({ type: "opportunity.edit", input: { applicationId: "app-1" } });
    await port.reviewOpportunity?.("brief-1", 1).catch(() => undefined);
    expect(called()).toMatchObject({
      type: "opportunity.review",
      input: { applicationId: "app-1" },
    });
    port.selectApplication?.(null);
    await port.getLatestOpportunity?.().catch(() => undefined);
    expect(called()?.input).not.toHaveProperty("applicationId");
    expect(state.workspaceId).toBeTruthy();
  });
});
