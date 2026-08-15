import { describe, expect, it, vi } from "vitest";

import { type ApplicationDriver, createApplicationService } from "./index.js";

function driver(): ApplicationDriver {
  const snapshot = { runId: "run-1" } as never;
  return {
    initialize: vi.fn(async (command) => ({
      id: "workspace-1",
      root: command.root,
      jobDescriptionPath: command.jobDescription,
      sourceDirectory: command.sources,
      language: "en",
      outputFormat: "markdown" as const,
      requiredSections: ["Summary"],
      maxRounds: 3,
      author: { company: "anthropic", model: "author" },
      critic: { company: "openai", model: "critic" },
      fixtureMode: true,
    })),
    readWorkspace: vi.fn(async (root) => ({
      id: "workspace-1",
      root,
      jobDescriptionPath: "job.md",
      sourceDirectory: "evidence",
      language: "en",
      outputFormat: "markdown" as const,
      requiredSections: ["Summary"],
      maxRounds: 3,
      author: { company: "anthropic", model: "author" },
      critic: { company: "openai", model: "critic" },
      fixtureMode: true,
    })),
    begin: vi.fn(async () => snapshot),
    start: vi.fn(async () => snapshot),
    resume: vi.fn(async () => snapshot),
    lifecycle: vi.fn(async () => snapshot),
    status: vi.fn(async () => snapshot),
    export: vi.fn(async () => "exports/run-1.md"),
    latestExportPath: vi.fn(async () => null),
    queryEvidence: vi.fn(async () => []),
    recordReviewDecision: vi.fn(async () => undefined),
  };
}

describe("application service contract", () => {
  it("normalizes the shared root and supplies a safe no-op IO adapter", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.start({ root: "workspace" });

    expect(underlying.start).toHaveBeenCalledWith(
      { root: "workspace" },
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });

  it("forwards durable run creation without starting provider execution", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.begin({ root: "workspace", allowProviderData: true });

    expect(underlying.begin).toHaveBeenCalledWith(
      { root: "workspace", allowProviderData: true },
      expect.objectContaining({ write: expect.any(Function) }),
    );
    expect(underlying.start).not.toHaveBeenCalled();
  });

  it("forwards queryEvidence with normalized root", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.queryEvidence({ root: "workspace", query: "typescript" });

    expect(underlying.queryEvidence).toHaveBeenCalledWith(
      { root: "workspace", query: "typescript" },
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });

  it("forwards the durable latest export path query with normalized root", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.latestExportPath({ root: "workspace", runId: "run-1", format: "markdown" });

    expect(underlying.latestExportPath).toHaveBeenCalledWith({
      root: "workspace",
      runId: "run-1",
      format: "markdown",
    });
  });

  it("rejects empty roots before an adapter can access the filesystem", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await expect(service.status({ root: "   " })).rejects.toThrow("workspace root is required");
    expect(underlying.status).not.toHaveBeenCalled();
  });

  it("forwards desktop review decisions through the application boundary", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.recordReviewDecision({
      root: "workspace",
      runId: "run-1",
      kind: "finding",
      targetId: "finding-1",
      decision: "accepted",
    });

    expect(underlying.recordReviewDecision).toHaveBeenCalledWith(
      expect.objectContaining({ root: "workspace", targetId: "finding-1" }),
    );
  });

  it("forwards provider recovery through the provider-independent lifecycle boundary", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await service.lifecycle({ root: "workspace", runId: "run-1", action: "recover-review" });

    expect(underlying.lifecycle).toHaveBeenCalledWith(
      { root: "workspace", runId: "run-1", action: "recover-review" },
      expect.objectContaining({ write: expect.any(Function) }),
    );
  });
});
