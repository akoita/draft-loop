import { describe, expect, it, vi } from "vitest";

import {
  bridgeCapabilities,
  createCapabilityPort,
  type NativeBridge,
  unavailableResult,
  validateBridgeCommand,
} from "./bridge.js";
import { createFixtureReviewState } from "./model.js";
import {
  createBridgeReviewPort,
  createBrowserCapabilityPort,
  createBrowserNativeBridge,
} from "./native.js";

function bridge(
  invoke: NativeBridge["invoke"],
  capabilities: NativeBridge["capabilities"] = bridgeCapabilities,
): NativeBridge {
  return { capabilities, invoke };
}

describe("desktop capability bridge", () => {
  it("accepts allowlisted commands and rejects unknown or extra fields", () => {
    expect(
      validateBridgeCommand({
        type: "file.select",
        input: {
          workspaceId: "workspace-1",
          extensions: [".pdf"],
          multiple: true,
          target: "evidence",
        },
      }),
    ).toEqual({
      type: "file.select",
      input: {
        workspaceId: "workspace-1",
        extensions: [".pdf"],
        multiple: true,
        target: "evidence",
      },
    });

    expect(() => validateBridgeCommand({ type: "shell.exec", input: {} })).toThrow("not supported");
    expect(() =>
      validateBridgeCommand({
        type: "workspace.create",
        input: { name: "candidate", path: "/tmp/escape" },
      }),
    ).toThrow("invalid");

    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "run-1",
          action: { type: "approve" },
        },
      }),
    ).toMatchObject({ type: "review.dispatch", input: { action: { type: "approve" } } });

    expect(
      validateBridgeCommand({
        type: "workspace.create",
        input: { name: "candidate", mode: "real" },
      }),
    ).toEqual({ type: "workspace.create", input: { name: "candidate", mode: "real" } });

    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "start" },
        },
      }),
    ).toMatchObject({ type: "review.dispatch", input: { action: { type: "start" } } });

    const fingerprint = "a".repeat(64);
    expect(
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "acknowledge-provider-transmission", fingerprint },
        },
      }),
    ).toMatchObject({
      type: "review.dispatch",
      input: { action: { type: "acknowledge-provider-transmission", fingerprint } },
    });
    expect(() =>
      validateBridgeCommand({
        type: "review.dispatch",
        input: {
          workspaceId: "workspace-1",
          runId: "pending",
          action: { type: "acknowledge-provider-transmission", fingerprint: "stale" },
        },
      }),
    ).toThrow("invalid");
  });

  it("rejects traversal and unbounded export paths before invoking the host", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>();
    const port = createCapabilityPort(bridge(invoke));

    const result = await port.execute({
      type: "export.write",
      input: {
        workspaceId: "workspace-1",
        runId: "run-1",
        format: "pdf",
        relativePath: "../outside.pdf",
      },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("rejects workspace names that resolve outside the selected parent", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>();
    const port = createCapabilityPort(bridge(invoke, ["workspace.create"]));

    const result = await port.execute({
      type: "workspace.create",
      input: { name: ".." },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("validates and carries in-app credential operations through the bridge", async () => {
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => {
      if (command.type === "credential.set") {
        return { ok: true, value: { provider: "openai", configured: true, source: "app" } };
      }
      return { ok: true, value: { provider: "openai", configured: true, source: "env" } };
    });
    const port = createCapabilityPort(bridge(invoke, ["credential.set", "credential.status"]));

    const setResult = await port.execute({
      type: "credential.set",
      input: { provider: "openai", apiKey: "sk-proj-test123" },
    });

    expect(setResult).toEqual({
      ok: true,
      value: { provider: "openai", configured: true, source: "app" },
    });
    expect(invoke).toHaveBeenCalledWith({
      type: "credential.set",
      input: { provider: "openai", apiKey: "sk-proj-test123" },
    });

    const statusResult = await port.execute({
      type: "credential.status",
      input: { provider: "openai" },
    });

    expect(statusResult).toEqual({
      ok: true,
      value: { provider: "openai", configured: true, source: "env" },
    });
  });

  it("reports unavailable browser capabilities without filesystem access", async () => {
    const result = await createBrowserCapabilityPort().execute({
      type: "file.select",
      input: { workspaceId: "workspace-1", multiple: true },
    });

    expect(result).toEqual(unavailableResult("file.select"));
    expect(createBrowserNativeBridge().capabilities).toEqual([]);
  });

  it("normalizes host failures into stable, content-free errors", async () => {
    const port = createCapabilityPort(
      bridge(async () => {
        throw new Error("private candidate content and secret");
      }, ["run.status"]),
    );

    const result = await port.execute({
      type: "run.status",
      input: { workspaceId: "workspace-1" },
    });

    expect(result).toMatchObject({ ok: false, error: { code: "operation-failed" } });
    expect(JSON.stringify(result)).not.toContain("private candidate");
  });

  it("adapts host-backed review load and dispatch into the desktop review port", async () => {
    const state = createFixtureReviewState();
    const invoke = vi.fn<NativeBridge["invoke"]>(async (command) => ({
      ok: true,
      value: command.type === "review.load" ? state : { ...state, state: "approved" },
    }));
    const port = createBridgeReviewPort(
      createCapabilityPort(bridge(invoke, ["review.load", "review.dispatch"])),
    );

    await expect(port.load()).resolves.toEqual(state);
    await expect(port.dispatch(state, { type: "approve" })).resolves.toMatchObject({
      state: "approved",
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
