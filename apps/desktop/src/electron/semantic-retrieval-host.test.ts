import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createApplicationService,
  createLocalApplicationDriver,
  EmbeddingModelInstallError,
  type EmbeddingModelInstallPlan,
  type EmbeddingModelService,
  type EmbeddingModelStatus,
} from "@draft-loop/application";
import { afterEach, describe, expect, it, vi } from "vitest";

import { embeddingModelInstallCancelledMessage } from "../semantic-retrieval-contract.js";
import { createNativeHost } from "./host.js";
import { createRecentWorkspaceStore } from "./recent-workspaces.js";
import { applyDesktopEmbeddingModelRoot } from "./semantic-retrieval-host.js";

const privateDirectory = "/home/someone/.local/share/draft-loop/models/granite";

function status(
  state: EmbeddingModelStatus["state"],
  tier: EmbeddingModelStatus["tier"] = "311m",
): EmbeddingModelStatus {
  return {
    tier,
    state,
    modelId: "ibm-granite/granite-embedding-311m-multilingual-r2",
    revision: "8f039f21d4181327268271bea4b11ddcc7eef88d",
    license: "Apache-2.0",
    totalSizeBytes: 345_941_766,
    sourceUrl: "https://huggingface.co/onnx-community/granite-embedding-311m-multilingual-r2-ONNX",
    modelDirectory: privateDirectory,
  };
}

const plan: EmbeddingModelInstallPlan = {
  tier: "311m",
  modelId: "ibm-granite/granite-embedding-311m-multilingual-r2",
  revision: "8f039f21d4181327268271bea4b11ddcc7eef88d",
  license: "Apache-2.0",
  sourceUrl: "https://huggingface.co/onnx-community/granite-embedding-311m-multilingual-r2-ONNX",
  files: [
    { path: "onnx/model_int8.onnx", sizeBytes: 300, url: "https://huggingface.co/x/model" },
    { path: "tokenizer.json", sizeBytes: 100, url: "https://huggingface.co/x/tokenizer" },
  ],
  totalSizeBytes: 400,
  destination: privateDirectory,
};

function fakeModels(overrides: Partial<EmbeddingModelService> = {}) {
  return {
    status: vi.fn<EmbeddingModelService["status"]>(async (tier) => status("absent", tier)),
    planInstall: vi.fn<EmbeddingModelService["planInstall"]>(() => plan),
    install: vi.fn<EmbeddingModelService["install"]>(async (tier) => status("ready", tier)),
    remove: vi.fn<EmbeddingModelService["remove"]>(async (tier) => status("absent", tier)),
    ...overrides,
  } satisfies EmbeddingModelService;
}

describe("semantic retrieval host commands", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  async function openHost(models: EmbeddingModelService = fakeModels()) {
    const root = await mkdtemp(join(tmpdir(), "draft-loop-desktop-semantic-"));
    directories.push(root);
    await mkdir(join(root, "evidence"), { recursive: true });
    await writeFile(join(root, "job.md"), "Synthetic job.\n", "utf8");
    await writeFile(join(root, "evidence", "resume.md"), "Synthetic evidence.\n", "utf8");
    const application = createApplicationService(createLocalApplicationDriver());
    await application.initialize(
      { root, jobDescription: "job.md", sources: "evidence", fixtureMode: true },
      { write: () => undefined },
    );
    const host = createNativeHost({
      applicationService: application,
      embeddingModelService: models,
      recentWorkspaces: createRecentWorkspaceStore({ filename: join(root, "recent.json") }),
      dialogs: { chooseDirectory: async () => root, chooseFiles: async () => [] },
    });
    const opened = await host.invoke({
      type: "workspace.open",
      input: { selection: "native-dialog" },
    });
    if (!opened.ok) throw new Error("The workspace did not open.");
    const workspaceId = (opened.value as { workspace: { id: string } }).workspace.id;
    return { host, root, workspaceId };
  }

  it("reports status without exposing the model directory", async () => {
    const models = fakeModels({
      status: vi.fn(async (tier) => status("corrupt", tier)),
    });
    const { host } = await openHost(models);
    const result = await host.invoke({ type: "embedding-model.status", input: { tier: "97m" } });
    expect(result).toMatchObject({ ok: true, value: { tier: "97m", state: "corrupt" } });
    expect(JSON.stringify(result)).not.toContain(privateDirectory);
    expect(models.status).toHaveBeenCalledWith("97m");
  });

  it("plans an install with source, sizes, and license but no destination path", async () => {
    const { host } = await openHost();
    const result = await host.invoke({
      type: "embedding-model.plan-install",
      input: { tier: "311m" },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        tier: "311m",
        modelId: plan.modelId,
        revision: plan.revision,
        license: "Apache-2.0",
        sourceUrl: plan.sourceUrl,
        files: [
          { path: "onnx/model_int8.onnx", sizeBytes: 300 },
          { path: "tokenizer.json", sizeBytes: 100 },
        ],
        totalSizeBytes: 400,
      },
    });
    expect(JSON.stringify(result)).not.toContain(privateDirectory);
  });

  it("installs only with the approval and reports aggregate progress while it runs", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const models = fakeModels({
      install: vi.fn(async (tier, options) => {
        options?.onProgress?.({
          file: "onnx/model_int8.onnx",
          receivedBytes: 100,
          totalBytes: 300,
        });
        await gate;
        options?.onProgress?.({ file: "tokenizer.json", receivedBytes: 100, totalBytes: 100 });
        return status("ready", tier);
      }),
    });
    const { host } = await openHost(models);
    await expect(
      host.invoke({ type: "embedding-model.install", input: { tier: "311m" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(models.install).not.toHaveBeenCalled();

    const progress = { type: "embedding-model.progress", input: { tier: "311m" } } as const;
    await expect(host.invoke(progress)).resolves.toEqual({ ok: true, value: { active: false } });

    const pending = host.invoke({
      type: "embedding-model.install",
      input: { tier: "311m", approved: true },
    });
    await expect(host.invoke(progress)).resolves.toEqual({
      ok: true,
      value: { active: true, receivedBytes: 100, totalBytes: 400 },
    });
    await expect(
      host.invoke({ type: "embedding-model.progress", input: { tier: "97m" } }),
    ).resolves.toEqual({ ok: true, value: { active: false } });
    await expect(
      host.invoke({ type: "embedding-model.install", input: { tier: "311m", approved: true } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    await expect(
      host.invoke({ type: "embedding-model.remove", input: { tier: "311m" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    expect(models.remove).not.toHaveBeenCalled();

    release();
    const result = await pending;
    expect(result).toMatchObject({ ok: true, value: { tier: "311m", state: "ready" } });
    expect(JSON.stringify(result)).not.toContain(privateDirectory);
    await expect(host.invoke(progress)).resolves.toEqual({ ok: true, value: { active: false } });
  });

  it("aborts a pending install on cancel and reports the fixed cancellation message", async () => {
    let observed: AbortSignal | undefined;
    const models = fakeModels({
      install: vi.fn(
        (_tier, options) =>
          new Promise<EmbeddingModelStatus>((_resolve, reject) => {
            observed = options?.signal;
            options?.signal?.addEventListener("abort", () =>
              reject(new Error(`aborted while writing ${privateDirectory}`)),
            );
          }),
      ),
    });
    const { host } = await openHost(models);
    const cancel = { type: "embedding-model.cancel", input: { tier: "311m" } } as const;
    await expect(host.invoke(cancel)).resolves.toEqual({ ok: true, value: { cancelled: false } });

    const pending = host.invoke({
      type: "embedding-model.install",
      input: { tier: "311m", approved: true },
    });
    await expect(host.invoke(cancel)).resolves.toEqual({ ok: true, value: { cancelled: true } });
    expect(observed?.aborted).toBe(true);
    await expect(host.invoke(cancel)).resolves.toEqual({ ok: true, value: { cancelled: false } });

    const result = await pending;
    expect(result).toMatchObject({
      ok: false,
      error: { code: "operation-failed", message: embeddingModelInstallCancelledMessage },
    });
    expect(JSON.stringify(result)).not.toContain(privateDirectory);
    await expect(
      host.invoke({ type: "embedding-model.progress", input: { tier: "311m" } }),
    ).resolves.toEqual({ ok: true, value: { active: false } });
  });

  it("maps install failures to their own message and hides unexpected ones", async () => {
    const failing = fakeModels({
      install: vi.fn(async () => {
        throw new EmbeddingModelInstallError(
          "checksum-mismatch",
          "The downloaded model failed verification. Nothing was installed.",
        );
      }),
    });
    const first = await openHost(failing);
    await expect(
      first.host.invoke({
        type: "embedding-model.install",
        input: { tier: "311m", approved: true },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "operation-failed",
        message: "The downloaded model failed verification. Nothing was installed.",
      },
    });

    const unexpected = fakeModels({
      install: vi.fn(async () => {
        throw new Error(`EACCES: permission denied, open '${privateDirectory}/model.onnx'`);
      }),
    });
    const second = await openHost(unexpected);
    const result = await second.host.invoke({
      type: "embedding-model.install",
      input: { tier: "311m", approved: true },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "operation-failed" } });
    expect(JSON.stringify(result)).not.toContain(privateDirectory);
    expect(JSON.stringify(result)).not.toContain("EACCES");
    expect(JSON.stringify(result)).toContain("Installing the local search model");
  });

  it("removes a model and reports the resulting status", async () => {
    const models = fakeModels();
    const { host } = await openHost(models);
    const result = await host.invoke({ type: "embedding-model.remove", input: { tier: "97m" } });
    expect(result).toMatchObject({ ok: true, value: { tier: "97m", state: "absent" } });
    expect(models.remove).toHaveBeenCalledWith("97m");
  });

  it("persists the retrieval mode per workspace and reads it back", async () => {
    const { host, root, workspaceId } = await openHost();
    await expect(
      host.invoke({ type: "workspace.retrieval-mode.get", input: { workspaceId } }),
    ).resolves.toEqual({
      ok: true,
      value: { workspaceId, mode: "lexical", modelTier: "311m" },
    });

    const saved = await host.invoke({
      type: "workspace.retrieval-mode.set",
      input: { workspaceId, mode: "hybrid", modelTier: "97m" },
    });
    expect(saved).toMatchObject({
      ok: true,
      value: { workspaceId, mode: "hybrid", modelTier: "97m" },
    });
    const onDisk = JSON.parse(
      await readFile(join(root, ".draft-loop", "retrieval-mode.json"), "utf8"),
    );
    expect(onDisk).toMatchObject({ mode: "hybrid", modelTier: "97m" });
    expect(JSON.stringify(saved)).not.toContain(root);

    await expect(
      host.invoke({ type: "workspace.retrieval-mode.get", input: { workspaceId } }),
    ).resolves.toMatchObject({ ok: true, value: { mode: "hybrid", modelTier: "97m" } });
  });

  it("rejects retrieval-mode commands for a workspace that is not open", async () => {
    const { host } = await openHost();
    await expect(
      host.invoke({ type: "workspace.retrieval-mode.get", input: { workspaceId: "other" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
    await expect(
      host.invoke({
        type: "workspace.retrieval-mode.set",
        input: { workspaceId: "other", mode: "semantic", modelTier: "311m" },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("surfaces an unreadable retrieval-mode file with its own path-free message", async () => {
    const { host, root, workspaceId } = await openHost();
    await mkdir(join(root, ".draft-loop"), { recursive: true });
    await writeFile(join(root, ".draft-loop", "retrieval-mode.json"), "{", "utf8");
    const result = await host.invoke({
      type: "workspace.retrieval-mode.get",
      input: { workspaceId },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("retrieval mode file is invalid") },
    });
    expect(JSON.stringify(result)).not.toContain(root);
  });
});

describe("desktop embedding model root", () => {
  it("points runs at userData/models when the environment names no root", () => {
    const env: Record<string, string | undefined> = {};
    applyDesktopEmbeddingModelRoot(env, "/data/DraftLoop");
    expect(env.DRAFT_LOOP_EMBEDDING_MODEL_ROOT).toBe(join("/data/DraftLoop", "models"));

    const empty: Record<string, string | undefined> = { DRAFT_LOOP_EMBEDDING_MODEL_ROOT: "" };
    applyDesktopEmbeddingModelRoot(empty, "/data/DraftLoop");
    expect(empty.DRAFT_LOOP_EMBEDDING_MODEL_ROOT).toBe(join("/data/DraftLoop", "models"));
  });

  it("preserves a root the person already chose", () => {
    const env: Record<string, string | undefined> = {
      DRAFT_LOOP_EMBEDDING_MODEL_ROOT: "/mnt/models",
    };
    applyDesktopEmbeddingModelRoot(env, "/data/DraftLoop");
    expect(env.DRAFT_LOOP_EMBEDDING_MODEL_ROOT).toBe("/mnt/models");
  });
});
