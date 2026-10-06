import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCli } from "./index.js";
import {
  type ApplicationService,
  CliUserError,
  createApplicationService,
  createLocalApplicationDriver,
  createWorkspaceRetrievalModeService,
  type EmbeddingModelService,
  type EmbeddingModelStatus,
  type WorkspaceRetrievalModeRecord,
  type WorkspaceRetrievalModeService,
} from "./workflow.js";

const hint = (tier: string) =>
  `Run "draft-loop embeddings install --tier ${tier}" to install the local model; until then runs use lexical retrieval.`;

function statusFor(
  tier: "311m" | "97m",
  state: EmbeddingModelStatus["state"],
): EmbeddingModelStatus {
  return {
    tier,
    state,
    modelId: "example-org/fake-embedding-r2",
    revision: "0123456789abcdef0123456789abcdef01234567",
    license: "Apache-2.0",
    totalSizeBytes: 313_000_000,
    sourceUrl: "https://huggingface.co/example-org/fake-ONNX/tree/0123",
    modelDirectory: "/models/fake/0123",
  };
}

function fakeEmbeddingService(state: EmbeddingModelStatus["state"]) {
  return {
    status: vi.fn(async (tier) => statusFor(tier, state)),
    planInstall: vi.fn(() => {
      throw new Error("planInstall must not be called");
    }),
    install: vi.fn(async () => {
      throw new Error("install must not be called");
    }),
    remove: vi.fn(async () => {
      throw new Error("remove must not be called");
    }),
  } satisfies EmbeddingModelService;
}

function setup(modelState: EmbeddingModelStatus["state"] = "absent") {
  const lines: string[] = [];
  let saved: WorkspaceRetrievalModeRecord = { mode: "lexical", modelTier: "311m" };
  const service = {
    get: vi.fn(async () => saved),
    set: vi.fn(async ({ mode, modelTier }) => {
      saved = { mode, modelTier: modelTier ?? "311m", updatedAt: "2030-01-01T00:00:00.000Z" };
      return saved;
    }),
  } satisfies WorkspaceRetrievalModeService;
  const embedding = fakeEmbeddingService(modelState);
  const factory = vi.fn((_modelRoot: string) => embedding);
  const cli = createCli({
    service: {} as ApplicationService,
    retrievalModeService: service,
    embeddingModelServiceFactory: factory,
    io: { write: (line: string) => lines.push(line) },
  });
  cli.exitOverride();
  const run = (...args: string[]) => cli.parseAsync(["node", "draft-loop", "retrieval", ...args]);
  return { service, embedding, factory, lines, run };
}

describe("retrieval mode CLI", () => {
  it("shows the default mode and tier without checking the model", async () => {
    const { service, factory, lines, run } = setup();
    await run("mode", "ws");
    expect(service.get).toHaveBeenCalledWith({ root: resolve("ws") });
    expect(service.set).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
    expect(lines).toEqual([
      "retrieval mode: lexical",
      "  searches: keyword retrieval only",
      "  model tier: 311m",
      "  default: no setting saved",
    ]);
  });

  it("sets lexical without a model status or hint", async () => {
    const { service, factory, lines, run } = setup();
    await run("mode", "ws", "lexical");
    expect(service.set).toHaveBeenLastCalledWith({
      root: resolve("ws"),
      mode: "lexical",
      modelTier: "311m",
    });
    expect(factory).not.toHaveBeenCalled();
    expect(lines).toEqual([
      "retrieval mode: lexical (saved)",
      "  searches: keyword retrieval only",
      "  model tier: 311m",
    ]);
  });

  it("sets semantic and hybrid, with the install hint while the model is absent", async () => {
    const { service, embedding, lines, run } = setup("absent");
    await run("mode", "ws", "semantic");
    expect(service.set).toHaveBeenLastCalledWith({
      root: resolve("ws"),
      mode: "semantic",
      modelTier: "311m",
    });
    expect(embedding.status).toHaveBeenLastCalledWith("311m");
    expect(lines).toEqual([
      "retrieval mode: semantic (saved)",
      "  searches: retrieval by meaning with the local embedding model",
      "  model tier: 311m",
      "  local model 311m: absent",
      hint("311m"),
    ]);
    lines.length = 0;
    await run("mode", "ws", "hybrid");
    expect(service.set).toHaveBeenLastCalledWith({
      root: resolve("ws"),
      mode: "hybrid",
      modelTier: "311m",
    });
    expect(lines).toContain(hint("311m"));
  });

  it("omits the hint when the model is ready", async () => {
    const { lines, run } = setup("ready");
    await run("mode", "ws", "hybrid");
    expect(lines).toEqual([
      "retrieval mode: hybrid (saved)",
      "  searches: keyword and semantic retrieval fused",
      "  model tier: 311m",
      "  local model 311m: ready",
    ]);
  });

  it("saves the mode and hints for a corrupt model", async () => {
    const { service, lines, run } = setup("corrupt");
    await run("mode", "ws", "semantic");
    expect(service.set).toHaveBeenCalledTimes(1);
    expect(lines).toContain(hint("311m"));
  });

  it("uses --tier, checks that tier, and passes --model-dir to the factory", async () => {
    const { service, embedding, factory, lines, run } = setup("absent");
    await run("mode", "ws", "semantic", "--tier", "97m", "--model-dir", "/custom");
    expect(service.set).toHaveBeenLastCalledWith({
      root: resolve("ws"),
      mode: "semantic",
      modelTier: "97m",
    });
    expect(factory).toHaveBeenCalledWith("/custom");
    expect(embedding.status).toHaveBeenLastCalledWith("97m");
    expect(lines).toContain("  model tier: 97m");
    expect(lines).toContain(hint("97m"));
  });

  it("keeps the saved tier when --tier is omitted", async () => {
    const { service, run } = setup("ready");
    await run("mode", "ws", "semantic", "--tier", "97m");
    await run("mode", "ws", "hybrid");
    expect(service.set).toHaveBeenLastCalledWith({
      root: resolve("ws"),
      mode: "hybrid",
      modelTier: "97m",
    });
  });

  it("prints JSON for show, lexical, and non-lexical saves", async () => {
    const { lines, run } = setup("absent");
    await run("mode", "ws", "--json");
    expect(JSON.parse(lines[0] ?? "")).toEqual({ mode: "lexical", modelTier: "311m" });
    await run("mode", "ws", "lexical", "--json");
    expect(JSON.parse(lines[1] ?? "")).toEqual({
      mode: "lexical",
      modelTier: "311m",
      updatedAt: "2030-01-01T00:00:00.000Z",
    });
    await run("mode", "ws", "semantic", "--tier", "97m", "--json");
    expect(JSON.parse(lines[2] ?? "")).toEqual({
      mode: "semantic",
      modelTier: "97m",
      updatedAt: "2030-01-01T00:00:00.000Z",
      modelState: "absent",
    });
    expect(lines).toHaveLength(3);
  });

  it("rejects an unknown mode or tier before touching the workspace or model", async () => {
    const { service, factory, run } = setup();
    await expect(run("mode", "ws", "fuzzy")).rejects.toBeInstanceOf(CliUserError);
    await expect(run("mode", "ws", "semantic", "--tier", "1b")).rejects.toBeInstanceOf(
      CliUserError,
    );
    await expect(run("mode", "ws", "--tier", "97m")).rejects.toBeInstanceOf(CliUserError);
    expect(service.get).not.toHaveBeenCalled();
    expect(service.set).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("never calls install, remove, or the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { embedding, run } = setup("absent");
    await run("mode", "ws", "semantic");
    expect(embedding.install).not.toHaveBeenCalled();
    expect(embedding.remove).not.toHaveBeenCalled();
    expect(embedding.planInstall).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  describe("with a real workspace", () => {
    const roots: string[] = [];
    afterEach(async () => {
      await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
    });

    async function workspaceRoot(): Promise<string> {
      const root = await mkdtemp(join(tmpdir(), "draft-loop-retrieval-mode-cli-"));
      roots.push(root);
      await mkdir(join(root, "evidence"), { recursive: true });
      await writeFile(join(root, "job.md"), "Synthetic job.\n", "utf8");
      await writeFile(join(root, "evidence", "resume.md"), "Synthetic evidence.\n", "utf8");
      await createApplicationService(createLocalApplicationDriver()).initialize(
        { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
        { write: () => undefined },
      );
      return root;
    }

    function realCli(lines: string[]) {
      const cli = createCli({
        service: {} as ApplicationService,
        retrievalModeService: createWorkspaceRetrievalModeService(
          () => new Date("2030-02-03T04:05:06.000Z"),
        ),
        embeddingModelServiceFactory: () => fakeEmbeddingService("ready"),
        io: { write: (line: string) => lines.push(line) },
      });
      cli.exitOverride();
      return (...args: string[]) => cli.parseAsync(["node", "draft-loop", "retrieval", ...args]);
    }

    it("persists the mode and tier beside workspace.json and reads them back", async () => {
      const root = await workspaceRoot();
      const lines: string[] = [];
      const run = realCli(lines);
      await run("mode", root, "hybrid", "--tier", "97m");
      const saved = JSON.parse(
        await readFile(join(root, ".draft-loop", "retrieval-mode.json"), "utf8"),
      );
      expect(saved).toEqual({
        schemaVersion: 1,
        mode: "hybrid",
        modelTier: "97m",
        updatedAt: "2030-02-03T04:05:06.000Z",
      });
      lines.length = 0;
      await run("mode", root, "--json");
      expect(JSON.parse(lines[0] ?? "")).toEqual({
        mode: "hybrid",
        modelTier: "97m",
        updatedAt: "2030-02-03T04:05:06.000Z",
      });
    });

    it("refuses a directory that is not a workspace and a corrupt setting", async () => {
      const root = await workspaceRoot();
      const run = realCli([]);
      await expect(run("mode", join(root, "missing"), "semantic")).rejects.toBeInstanceOf(
        CliUserError,
      );
      await mkdir(join(root, ".draft-loop"), { recursive: true });
      await writeFile(join(root, ".draft-loop", "retrieval-mode.json"), "{", "utf8");
      await expect(run("mode", root)).rejects.toBeInstanceOf(CliUserError);
    });
  });
});
