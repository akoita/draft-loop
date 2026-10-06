import { describe, expect, it, vi } from "vitest";

import {
  type BridgeCommand,
  bridgeCapabilities,
  createCapabilityPort,
  type NativeBridge,
  validateBridgeCommand,
} from "./bridge.js";
import { createBridgeReviewPort } from "./native.js";

const tierCommands = [
  "embedding-model.status",
  "embedding-model.plan-install",
  "embedding-model.progress",
  "embedding-model.cancel",
  "embedding-model.remove",
] as const;

const allCommands = [
  ...tierCommands,
  "embedding-model.install",
  "workspace.retrieval-mode.get",
  "workspace.retrieval-mode.set",
] as const;

function bridge(invoke: NativeBridge["invoke"]): NativeBridge {
  return { capabilities: bridgeCapabilities, invoke };
}

const statusResult = {
  tier: "311m",
  state: "absent",
  modelId: "ibm-granite/granite-embedding-311m-multilingual-r2",
  revision: "8f039f21d4181327268271bea4b11ddcc7eef88d",
  license: "Apache-2.0",
  totalSizeBytes: 346_000_000,
  sourceUrl: "https://huggingface.co/onnx-community/granite-embedding-311m-multilingual-r2-ONNX",
};

const planResult = {
  tier: "311m",
  modelId: statusResult.modelId,
  revision: statusResult.revision,
  license: "Apache-2.0",
  sourceUrl: statusResult.sourceUrl,
  files: [
    { path: "onnx/model_int8.onnx", sizeBytes: 312_556_945 },
    { path: "tokenizer.json", sizeBytes: 33_384_821 },
  ],
  totalSizeBytes: 346_000_000,
};

async function respond(command: BridgeCommand, value: unknown) {
  return createCapabilityPort(bridge(async () => ({ ok: true, value }))).execute(command);
}

describe("semantic retrieval bridge commands", () => {
  it("advertises every command as a capability", () => {
    expect(bridgeCapabilities).toEqual(expect.arrayContaining([...allCommands]));
  });

  it("accepts the real payload of every embedding-model command", () => {
    for (const type of tierCommands) {
      expect(validateBridgeCommand({ type, input: { tier: "97m" } })).toEqual({
        type,
        input: { tier: "97m" },
      });
    }
    const install = {
      type: "embedding-model.install",
      input: { tier: "311m", approved: true },
    };
    expect(validateBridgeCommand(install)).toEqual(install);
  });

  it("accepts the real payload of the retrieval-mode commands", () => {
    const get = { type: "workspace.retrieval-mode.get", input: { workspaceId: "workspace-1" } };
    expect(validateBridgeCommand(get)).toEqual(get);
    for (const mode of ["lexical", "semantic", "hybrid"]) {
      const set = {
        type: "workspace.retrieval-mode.set",
        input: { workspaceId: "workspace-1", mode, modelTier: "97m" },
      };
      expect(validateBridgeCommand(set)).toEqual(set);
    }
  });

  it("rejects an extra key, an unknown tier, or a missing field on every tier command", () => {
    for (const type of tierCommands) {
      for (const input of [
        { tier: "311m", root: "/private/models" },
        { tier: "311m", approved: true },
        { tier: "1b" },
        {},
        "311m",
      ]) {
        expect(() => validateBridgeCommand({ type, input })).toThrow("invalid");
      }
    }
  });

  it("requires the install approval to be exactly true and nothing else", () => {
    for (const input of [
      { tier: "311m" },
      { tier: "311m", approved: false },
      { tier: "311m", approved: "true" },
      { tier: "311m", approved: true, from: "/private/model" },
      { tier: "311m", approved: true, modelDirectory: "/private/model" },
    ]) {
      expect(() => validateBridgeCommand({ type: "embedding-model.install", input })).toThrow(
        "invalid",
      );
    }
  });

  it("rejects malformed retrieval-mode payloads", () => {
    for (const input of [
      { workspaceId: "workspace-1", root: "/private" },
      { workspaceId: "workspace-1", mode: "lexical" },
      { workspaceId: "workspace-1", mode: "fuzzy", modelTier: "311m" },
      { workspaceId: "workspace-1", mode: "hybrid", modelTier: "1b" },
      { workspaceId: "workspace-1", mode: "hybrid", modelTier: "311m", extra: true },
      { mode: "hybrid", modelTier: "311m" },
    ]) {
      expect(() => validateBridgeCommand({ type: "workspace.retrieval-mode.set", input })).toThrow(
        "invalid",
      );
    }
    for (const input of [{}, { workspaceId: "workspace-1", mode: "lexical" }]) {
      expect(() => validateBridgeCommand({ type: "workspace.retrieval-mode.get", input })).toThrow(
        "invalid",
      );
    }
  });

  it("normalizes status and plan results and drops nothing it does not recognise", async () => {
    await expect(
      respond({ type: "embedding-model.status", input: { tier: "311m" } }, statusResult),
    ).resolves.toEqual({ ok: true, value: statusResult });
    await expect(
      respond({ type: "embedding-model.plan-install", input: { tier: "311m" } }, planResult),
    ).resolves.toEqual({ ok: true, value: planResult });
    for (const malformed of [
      { ...statusResult, modelDirectory: "/home/someone/models" },
      { ...statusResult, state: "broken" },
      { ...statusResult, sourceUrl: "file:///home/someone/models" },
      { ...statusResult, sourceUrl: "https://example.test/model" },
      { ...statusResult, totalSizeBytes: -1 },
    ]) {
      await expect(
        respond({ type: "embedding-model.status", input: { tier: "311m" } }, malformed),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
    for (const malformed of [
      { ...planResult, destination: "/home/someone/models" },
      { ...planResult, files: [] },
      { ...planResult, files: [{ path: "/home/someone/model.onnx", sizeBytes: 1 }] },
      { ...planResult, files: [{ path: "../model.onnx", sizeBytes: 1 }] },
      { ...planResult, files: [{ path: "a.onnx", sizeBytes: 1, url: "https://x.test" }] },
    ]) {
      await expect(
        respond({ type: "embedding-model.plan-install", input: { tier: "311m" } }, malformed),
      ).resolves.toMatchObject({ ok: false, error: { code: "operation-failed" } });
    }
  });

  it("normalizes progress, cancel, and retrieval-mode results", async () => {
    const progress = { type: "embedding-model.progress", input: { tier: "311m" } } as const;
    await expect(respond(progress, { active: false })).resolves.toEqual({
      ok: true,
      value: { active: false },
    });
    await expect(respond(progress, { active: true })).resolves.toEqual({
      ok: true,
      value: { active: true },
    });
    await expect(
      respond(progress, { active: true, receivedBytes: 10, totalBytes: 100 }),
    ).resolves.toEqual({ ok: true, value: { active: true, receivedBytes: 10, totalBytes: 100 } });
    for (const malformed of [
      { active: true, receivedBytes: 10 },
      { active: false, receivedBytes: 10, totalBytes: 100 },
      { active: true, receivedBytes: 101, totalBytes: 100 },
      { active: true, receivedBytes: 0, totalBytes: 0 },
      { active: true, receivedBytes: 1, totalBytes: 2, file: "/private/file" },
    ]) {
      await expect(respond(progress, malformed)).resolves.toMatchObject({ ok: false });
    }
    const cancel = { type: "embedding-model.cancel", input: { tier: "311m" } } as const;
    await expect(respond(cancel, { cancelled: true })).resolves.toEqual({
      ok: true,
      value: { cancelled: true },
    });
    await expect(respond(cancel, { cancelled: true, path: "/private" })).resolves.toMatchObject({
      ok: false,
    });

    const get = {
      type: "workspace.retrieval-mode.get",
      input: { workspaceId: "workspace-1" },
    } as const;
    const record = { workspaceId: "workspace-1", mode: "hybrid", modelTier: "97m" };
    await expect(respond(get, record)).resolves.toEqual({ ok: true, value: record });
    await expect(
      respond(get, { ...record, updatedAt: "2026-10-06T10:00:00.000Z" }),
    ).resolves.toMatchObject({ ok: true });
    for (const malformed of [
      { ...record, root: "/private/workspace" },
      { ...record, mode: "fuzzy" },
      { ...record, updatedAt: "yesterday" },
    ]) {
      await expect(respond(get, malformed)).resolves.toMatchObject({ ok: false });
    }
  });

  it("exposes the commands on the review port and sends the approval with an install", async () => {
    const invoke = vi.fn(async (command: BridgeCommand) => {
      if (command.type === "embedding-model.plan-install") return { ok: true, value: planResult };
      return { ok: true, value: statusResult };
    });
    const port = createBridgeReviewPort(createCapabilityPort(bridge(invoke as never)));
    await port.getEmbeddingModelStatus?.("311m");
    await port.planEmbeddingModelInstall?.("311m");
    await port.installEmbeddingModel?.("97m");
    await port.removeEmbeddingModel?.("97m");
    expect(invoke.mock.calls.map(([command]) => command)).toEqual([
      { type: "embedding-model.status", input: { tier: "311m" } },
      { type: "embedding-model.plan-install", input: { tier: "311m" } },
      { type: "embedding-model.install", input: { tier: "97m", approved: true } },
      { type: "embedding-model.remove", input: { tier: "97m" } },
    ]);
  });
});
