import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCli } from "./index.js";
import {
  type ApplicationIo,
  type ApplicationService,
  createApplicationService,
  createLocalApplicationDriver,
  createWorkspaceModelProfileSelectionService,
  type WorkspaceModelProfileSelectionService,
} from "./workflow.js";

const pair = {
  author: { id: "legacy-anthropic-author", version: 1 },
  critic: { id: "legacy-openai-critic", version: 1 },
};

function harness(overrides: Partial<WorkspaceModelProfileSelectionService> = {}) {
  const lines: string[] = [];
  const io: ApplicationIo = { write: (line) => lines.push(line) };
  const start = vi.fn(async () => ({}) as Awaited<ReturnType<ApplicationService["start"]>>);
  const selection: WorkspaceModelProfileSelectionService = {
    get: vi.fn(async () => undefined),
    save: vi.fn(async ({ modelProfiles }) => ({
      modelProfiles,
      appliedAt: "2026-01-02T03:04:05.000Z",
    })),
    clear: vi.fn(async () => true),
    ...overrides,
  };
  const invoke = (...args: readonly string[]) =>
    createCli({
      service: { start } as unknown as ApplicationService,
      modelProfileSelectionService: selection,
      io,
    }).parseAsync(["node", "draft-loop", ...args]);
  return { invoke, lines, selection, start };
}

describe("model-profiles applied, apply and clear", () => {
  it("shows that no pair is applied and what that means", async () => {
    const h = harness();
    await h.invoke("model-profiles", "applied", "workspace");
    expect(h.lines).toEqual([
      "model profiles: none applied (new runs use the legacy path: provider-default runtime controls, unknown context windows)",
    ]);
  });

  it("shows the applied pair as text and JSON", async () => {
    const applied = { modelProfiles: pair, appliedAt: "2026-01-02T03:04:05.000Z" };
    const h = harness({ get: vi.fn(async () => applied) });
    await h.invoke("model-profiles", "applied", "workspace");
    expect(h.lines).toEqual([
      "model profiles: author legacy-anthropic-author@1; critic legacy-openai-critic@1",
      "  applied: 2026-01-02T03:04:05.000Z",
      "  used by: new runs that name no profiles of their own",
    ]);
    h.lines.length = 0;
    await h.invoke("model-profiles", "applied", "workspace", "--json");
    expect(JSON.parse(h.lines[0] ?? "")).toEqual(applied);
  });

  it("saves exact profile references", async () => {
    const h = harness();
    await h.invoke(
      "model-profiles",
      "apply",
      "workspace",
      "--author-profile",
      "legacy-anthropic-author@1",
      "--critic-profile",
      "legacy-openai-critic@1",
    );
    expect(h.selection.save).toHaveBeenCalledWith({
      root: expect.stringContaining("workspace"),
      modelProfiles: pair,
    });
    expect(h.lines[0]).toBe(
      "model profiles: author legacy-anthropic-author@1; critic legacy-openai-critic@1 (saved)",
    );
    expect(h.start).not.toHaveBeenCalled();
  });

  it("saves a preset's exact references", async () => {
    const h = harness();
    await h.invoke("model-profiles", "apply", "workspace", "--model-preset", "standard");
    expect(h.selection.save).toHaveBeenCalledWith({
      root: expect.stringContaining("workspace"),
      modelProfiles: {
        author: { id: "standard-anthropic-author", version: 1 },
        critic: { id: "standard-openai-critic", version: 2 },
      },
    });
  });

  it.each([
    [["apply", "workspace"]],
    [["apply", "workspace", "--author-profile", "legacy-anthropic-author@1"]],
    [["apply", "workspace", "--model-preset", "standard", "--author-profile", "a@1"]],
    [["apply", "workspace", "--author-profile", "nope", "--critic-profile", "x@1"]],
  ])("rejects an incomplete or invalid selection %j without saving", async (args) => {
    const h = harness();
    await expect(h.invoke("model-profiles", ...args)).rejects.toThrow();
    expect(h.selection.save).not.toHaveBeenCalled();
  });

  it("clears the applied pair", async () => {
    const h = harness();
    await h.invoke("model-profiles", "clear", "workspace");
    expect(h.selection.clear).toHaveBeenCalledWith({ root: expect.stringContaining("workspace") });
    expect(h.lines[0]).toMatch(/^model profiles: cleared/u);
    const none = harness({ clear: vi.fn(async () => false) });
    await none.invoke("model-profiles", "clear", "workspace");
    expect(none.lines).toEqual(["model profiles: none were applied"]);
  });

  it("keeps `model-profiles` itself printing the content-free catalog", async () => {
    const h = harness();
    await h.invoke("model-profiles");
    expect(JSON.parse(h.lines[0] ?? "null")).toHaveProperty("profiles");
    expect(h.selection.get).not.toHaveBeenCalled();
  });

  it("start with explicit profile flags still forwards only those flags", async () => {
    const h = harness();
    await h.invoke(
      "start",
      "workspace",
      "--author-profile",
      "legacy-anthropic-author@1",
      "--critic-profile",
      "legacy-openai-critic@1",
    );
    expect(h.start).toHaveBeenCalledWith(
      expect.objectContaining({ modelProfiles: pair, allowProviderData: false }),
    );
  });
});

describe("model-profiles against a real workspace", () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  it("applies, shows and clears a pair that matches, and refuses one that does not", async () => {
    root = await mkdtemp(join(tmpdir(), "draft-loop-cli-profile-selection-"));
    await mkdir(join(root, "evidence"));
    await writeFile(join(root, "job.md"), "Build TypeScript tools.\n", "utf8");
    await writeFile(join(root, "evidence", "resume.md"), "Built TypeScript tools.\n", "utf8");
    await createApplicationService(createLocalApplicationDriver()).initialize(
      {
        root,
        jobDescription: "job.md",
        sources: "evidence",
        fixtureMode: true,
        authorModel: "claude-sonnet-4-5",
        criticModel: "gpt-5.6-luna",
      },
      { write: () => undefined },
    );
    const lines: string[] = [];
    const run = (...args: readonly string[]) =>
      createCli({
        modelProfileSelectionService: createWorkspaceModelProfileSelectionService(),
        io: { write: (line) => lines.push(line) },
      }).parseAsync(["node", "draft-loop", "model-profiles", ...args]);

    await run(
      "apply",
      root,
      "--author-profile",
      "legacy-anthropic-author@1",
      "--critic-profile",
      "legacy-openai-critic@1",
    );
    await run("applied", root, "--json");
    expect(JSON.parse(lines.at(-1) ?? "")).toMatchObject({ modelProfiles: pair });
    await expect(run("apply", root, "--model-preset", "standard")).rejects.toThrow(
      /were not applied/u,
    );
    await run("clear", root);
    await run("applied", root, "--json");
    expect(lines.at(-1)).toBe("null");
  });
});
