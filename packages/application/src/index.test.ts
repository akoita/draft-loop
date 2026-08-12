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
    start: vi.fn(async () => snapshot),
    resume: vi.fn(async () => snapshot),
    lifecycle: vi.fn(async () => snapshot),
    status: vi.fn(async () => snapshot),
    export: vi.fn(async () => "exports/run-1.md"),
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

  it("rejects empty roots before an adapter can access the filesystem", async () => {
    const underlying = driver();
    const service = createApplicationService(underlying);

    await expect(service.status({ root: "   " })).rejects.toThrow("workspace root is required");
    expect(underlying.status).not.toHaveBeenCalled();
  });
});
