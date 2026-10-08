import { describe, expect, it } from "vitest";

import type { ApplicationSummaryView } from "./application-contract.js";
import { createCapabilityPort, type NativeBridge, validateBridgeCommand } from "./bridge.js";
import { bridgeCapabilities } from "./bridge-capabilities.js";
import { createFixtureReviewState } from "./model.js";

/*
 * Drift proof: real payloads go through the real validators and normalizers, so a field added to
 * an interface but not to the runtime allowlist fails here instead of in the app.
 */

const application: ApplicationSummaryView = {
  id: "app-1a2b3c",
  name: "Acme — Staff Engineer",
  jobSourceKind: "pasted-text",
  status: "in-review",
  isDefault: false,
  createdAt: "2026-10-08T10:00:00.000Z",
  updatedAt: "2026-10-08T12:30:00.000Z",
  runCount: 2,
  briefCount: 1,
  exportCount: 0,
  latestRunId: "run-2",
};

function portReturning(value: unknown) {
  const bridge: NativeBridge = {
    capabilities: [...bridgeCapabilities],
    invoke: async () => ({ ok: true, value }) as never,
  };
  return createCapabilityPort(bridge);
}

describe("application bridge commands", () => {
  it("advertises the three commands", () => {
    for (const name of ["application.list", "application.get", "application.create"]) {
      expect(bridgeCapabilities).toContain(name);
    }
  });

  it("accepts exactly the documented inputs", () => {
    expect(
      validateBridgeCommand({ type: "application.list", input: { workspaceId: "workspace-1" } }),
    ).toEqual({ type: "application.list", input: { workspaceId: "workspace-1" } });
    expect(
      validateBridgeCommand({
        type: "application.get",
        input: { workspaceId: "workspace-1", applicationId: "app-1" },
      }),
    ).toEqual({
      type: "application.get",
      input: { workspaceId: "workspace-1", applicationId: "app-1" },
    });
    const create = {
      type: "application.create",
      input: { workspaceId: "workspace-1", name: "Acme", jobText: "Line one\n\nLine two" },
    };
    expect(validateBridgeCommand(create)).toEqual(create);
  });

  it("rejects extra keys, missing keys and paths", () => {
    const bad = [
      { type: "application.list", input: {} },
      { type: "application.list", input: { workspaceId: "w", path: "/private" } },
      { type: "application.get", input: { workspaceId: "w" } },
      { type: "application.get", input: { workspaceId: "w", applicationId: "../x" } },
      { type: "application.create", input: { workspaceId: "w", name: "Acme" } },
      {
        type: "application.create",
        input: { workspaceId: "w", name: "Acme", jobText: "x", jobPath: "/private/job.md" },
      },
      { type: "application.create", input: { workspaceId: "w", name: "", jobText: "x" } },
      { type: "application.create", input: { workspaceId: "w", name: "Acme", jobText: "  " } },
      {
        type: "application.create",
        input: { workspaceId: "w", name: "Acme", jobText: "x".repeat(200_001) },
      },
      {
        type: "application.create",
        input: { workspaceId: "w", name: "bad\nname", jobText: "x" },
      },
    ];
    for (const command of bad) {
      expect(() => validateBridgeCommand(command)).toThrow();
    }
  });

  it("accepts a real list, get and create payload unchanged", async () => {
    const list = { workspaceId: "workspace-1", applications: [application] };
    await expect(
      portReturning(list).execute({
        type: "application.list",
        input: { workspaceId: "workspace-1" },
      }),
    ).resolves.toEqual({ ok: true, value: list });
    const record = { workspaceId: "workspace-1", application };
    await expect(
      portReturning(record).execute({
        type: "application.get",
        input: { workspaceId: "workspace-1", applicationId: application.id },
      }),
    ).resolves.toEqual({ ok: true, value: record });
    await expect(
      portReturning(record).execute({
        type: "application.create",
        input: { workspaceId: "workspace-1", name: "Acme", jobText: "x" },
      }),
    ).resolves.toEqual({ ok: true, value: record });
  });

  it("rejects a host answer with an extra, missing or path-bearing field", async () => {
    const command = { type: "application.list", input: { workspaceId: "workspace-1" } } as const;
    const wrap = (summary: unknown) => ({ workspaceId: "workspace-1", applications: [summary] });
    const { latestRunId: _omitted, ...withoutRun } = application;
    for (const summary of [
      { ...application, jobPath: "/home/me/job.md" },
      { ...application, storedPath: ".draft-loop/applications/app-1/job.md" },
      withoutRun,
      { ...application, status: "unknown" },
      { ...application, jobSourceKind: "clipboard" },
      { ...application, runCount: -1 },
      { ...application, createdAt: "yesterday" },
    ]) {
      await expect(portReturning(wrap(summary)).execute(command)).resolves.toMatchObject({
        ok: false,
      });
    }
    await expect(
      portReturning({ workspaceId: "workspace-1", applications: [], extra: true }).execute(command),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("application scope on existing commands", () => {
  it("lets review.load, review.dispatch and run.start carry an application id", () => {
    expect(
      validateBridgeCommand({ type: "review.load", input: { applicationId: "app-1" } }),
    ).toEqual({ type: "review.load", input: { applicationId: "app-1" } });
    expect(
      validateBridgeCommand({
        type: "run.start",
        input: { workspaceId: "workspace-1", applicationId: "app-1" },
      }),
    ).toEqual({
      type: "run.start",
      input: { workspaceId: "workspace-1", applicationId: "app-1" },
    });
    const dispatch = {
      type: "review.dispatch",
      input: {
        workspaceId: "workspace-1",
        runId: createFixtureReviewState().runId,
        action: { type: "start" },
        applicationId: "app-1",
      },
    };
    expect(validateBridgeCommand(dispatch)).toEqual(dispatch);
    expect(() =>
      validateBridgeCommand({ type: "review.load", input: { applicationId: "../x" } }),
    ).toThrow();
  });
});

describe("application-scoped opportunity commands", () => {
  const source = {
    id: "workspace-job-description",
    kind: "workspace-job-description",
    classification: "job-posting",
  };
  const commands = [
    {
      type: "opportunity.create",
      input: {
        workspaceId: "w",
        sources: [source],
        providerTransmissionApproved: true,
        applicationId: "app-1",
      },
    },
    { type: "opportunity.latest", input: { workspaceId: "w", applicationId: "app-1" } },
    {
      type: "opportunity.edit",
      input: {
        workspaceId: "w",
        briefId: "brief-1",
        expectedVersion: 1,
        patch: { issues: [] },
        applicationId: "app-1",
      },
    },
    {
      type: "opportunity.review",
      input: { workspaceId: "w", briefId: "brief-1", expectedVersion: 1, applicationId: "app-1" },
    },
  ] as const;

  it("accepts an application id on create, latest, edit and review unchanged", () => {
    for (const command of commands) {
      expect(validateBridgeCommand(command)).toEqual(command);
    }
  });

  it("still accepts the same commands without an application id", () => {
    for (const { type, input } of commands) {
      const { applicationId: _omitted, ...workspaceLevel } = input;
      expect(validateBridgeCommand({ type, input: workspaceLevel })).toEqual({
        type,
        input: workspaceLevel,
      });
    }
  });

  it("rejects an unsafe application id", () => {
    for (const { type, input } of commands) {
      expect(() =>
        validateBridgeCommand({ type, input: { ...input, applicationId: "../escape" } }),
      ).toThrow();
    }
  });
});

describe("application.create job source", () => {
  const base = { workspaceId: "w", name: "Acme" };

  it("accepts an approved URL in place of pasted text", () => {
    const create = {
      type: "application.create",
      input: { ...base, jobUrl: "https://jobs.example.test/1", jobUrlApproved: true },
    };
    expect(validateBridgeCommand(create)).toEqual(create);
  });

  it("requires approval and exactly one job source", () => {
    for (const input of [
      { ...base, jobUrl: "https://jobs.example.test/1" },
      { ...base, jobUrl: "https://jobs.example.test/1", jobUrlApproved: false },
      { ...base, jobUrl: "https://jobs.example.test/1", jobUrlApproved: true, jobText: "x" },
      { ...base, jobText: "x", jobUrlApproved: true },
      { ...base, jobUrl: "javascript:alert(1)", jobUrlApproved: true },
      base,
    ]) {
      expect(() => validateBridgeCommand({ type: "application.create", input })).toThrow();
    }
  });
});

describe("application.import", () => {
  const counts = { runs: 1, briefs: 1, briefVersions: 3, exports: 1, skippedExports: 0 };
  const result = { workspaceId: "workspace-1", application, imported: counts };

  it("is advertised and accepts only the workspace id and the native-dialog selection", () => {
    expect(bridgeCapabilities).toContain("application.import");
    for (const input of [
      { workspaceId: "workspace-1" },
      { workspaceId: "workspace-1", selection: "native-dialog" },
    ]) {
      expect(validateBridgeCommand({ type: "application.import", input })).toEqual({
        type: "application.import",
        input,
      });
    }
  });

  it("never accepts a path from the renderer", () => {
    for (const input of [
      {},
      { workspaceId: "w", path: "/home/me/other-workspace" },
      { workspaceId: "w", sourceRoot: "/home/me/other-workspace" },
      { workspaceId: "w", selection: "/home/me/other-workspace" },
      { workspaceId: "../x" },
    ]) {
      expect(() => validateBridgeCommand({ type: "application.import", input })).toThrow();
    }
  });

  it("accepts a real result unchanged and rejects extra, missing or malformed fields", async () => {
    const command = {
      type: "application.import",
      input: { workspaceId: "workspace-1", selection: "native-dialog" },
    } as const;
    await expect(portReturning(result).execute(command)).resolves.toEqual({
      ok: true,
      value: result,
    });
    const { skippedExports: _omitted, ...withoutSkipped } = counts;
    for (const bad of [
      { ...result, sourcePath: "/home/me/other-workspace" },
      { ...result, imported: { ...counts, path: "/x" } },
      { ...result, imported: withoutSkipped },
      { ...result, imported: { ...counts, runs: -1 } },
      { ...result, application: { ...application, jobPath: "/home/me/job.md" } },
      { workspaceId: "workspace-1", application },
    ]) {
      await expect(portReturning(bad).execute(command)).resolves.toMatchObject({ ok: false });
    }
  });
});
